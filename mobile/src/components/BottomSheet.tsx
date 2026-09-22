/**
 * A picker that rises from the bottom of the screen.
 *
 * Used wherever a choice is long enough that inlining it would bury the rest of the form —
 * a product catalogue, a breed list. A sheet keeps the form visible behind it, so a Mait can
 * see what they were filling in while they pick.
 *
 * Anchored to the bottom on purpose: it is where the thumb already is on a phone held one-
 * handed, which is how this app is used while the other hand holds a flask.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import Glyph, { GlyphName } from './glyph';
import { useKeyboardOverlap } from './keyboard';

/**
 * The colour a picker wears when it is picking one kind of thing — blue for straws, green for
 * consumables, yolk for equipment, as they are drawn everywhere else. A picker given no tone
 * stays the plain list it always was.
 */
export type SheetTone = 'info' | 'good' | 'warm' | 'danger';

const SOLID: Record<SheetTone, string> = {
  info: colors.info,
  good: colors.primary,
  warm: yolk[500],
  danger: colors.error,
};

/** A word on a wash: yolk and green read darker than their solids. */
const INK: Record<SheetTone, string> = {
  info: colors.info,
  good: colors.primaryDark,
  warm: yolk[800],
  danger: colors.error,
};

const WASH: Record<SheetTone, string> = {
  info: colors.infoWash,
  good: colors.primaryWash,
  warm: colors.secondaryWash,
  danger: colors.errorWash,
};

const EDGE: Record<SheetTone, string> = {
  info: colors.info,
  good: green[300],
  warm: yolk[300],
  danger: colors.error,
};

/** White on a solid chip, except on yolk, which fails contrast under white. */
function onSolid(tone: SheetTone): string {
  return tone === 'warm' ? colors.ink : colors.surface;
}

export interface SheetOption {
  value: string;
  label: string;
  /** One line under the label — a unit, a count already held. */
  meta?: string;
  /** A short qualifier on the right, e.g. "6 in hand". */
  badge?: string;
  /** The badge's colour: green for plenty, yolk for low, red for none. Grey when unset. */
  badgeTone?: SheetTone;
  disabled?: boolean;
}

export interface SheetSection {
  title: string;
  options: SheetOption[];
}

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned below the scrolling content — a confirm button, usually. */
  footer?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  /**
   * A sheet with a field in it has to clear the keyboard, and it is anchored to the very edge
   * the keyboard comes up over. Nothing else can do this for it: the sheet sits in a modal
   * over the layout, so there is no parent for `KeyboardAvoidingView` to shrink. The whole
   * sheet moves up by the overlap instead, which keeps the field, its label and the button
   * under it together — a sheet that scrolled internally would put the button out of reach at
   * the very moment it is wanted.
   */
  const overlap = useKeyboardOverlap();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Without this the modal's window stops at the status bar on Android, and the sheet
      // is measured against a screen that is shorter than the one behind it.
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.root}>
        {/* Untinted, and behind the sheet rather than stacked above it. Tapping here closes
            the sheet; on Android the hardware back button does too. */}
        <Pressable style={styles.scrim} onPress={onClose} testID="sheet-scrim" />

        <View
          // The surface itself, named apart from the modal around it: this is the thing that
          // moves when the keyboard opens.
          testID={testID ? `${testID}-surface` : undefined}
          style={[
            styles.sheet,
            // The inset is the system's own gap, and it is only owed when the keyboard is not
            // already standing in it.
            { paddingBottom: overlap ? spacing[4] : insets.bottom + spacing[4] },
            !!overlap && { marginBottom: overlap },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.close}
              testID="sheet-close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {children}
          </ScrollView>

          {footer}
        </View>
      </View>
    </Modal>
  );
}

export default function BottomSheet({
  visible,
  title,
  subtitle,
  sections,
  selected,
  onSelect,
  onClose,
  tone,
  icon,
  tabbed = false,
  testID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  sections: SheetSection[];
  selected?: string | null;
  /** Tints the sheet and every option in one kind's colour. */
  tone?: SheetTone;
  /** The kind's glyph, on a solid chip beside the title and on every option. */
  icon?: GlyphName;
  /**
   * Shows the sections as a switch at the top, one at a time, rather than one long list —
   * for a choice made in two steps, Cow or Buffalo first and then the breed.
   */
  tabbed?: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState(0);
  const switchTone = tone ?? 'good';

  // Opens on the section holding what is already chosen — reopening a Murrah line lands on
  // Buffalo, not on Cow with the answer hidden behind a tap.
  useEffect(() => {
    if (visible) {
      const index = sections.findIndex(section =>
        section.options.some(option => option.value === selected),
      );
      setTab(Math.max(0, index));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const shown = tabbed ? sections.slice(tab, tab + 1) : sections;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Without this the modal's window stops at the status bar on Android, and the sheet
      // is measured against a screen that is shorter than the one behind it.
      statusBarTranslucent
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.root}>
        {/* Untinted, and behind the sheet rather than stacked above it. Tapping here closes
            the sheet; on Android the hardware back button does too, via onRequestClose — a
            sheet with no way out is a trapped Mait. */}
        <Pressable style={styles.scrim} onPress={onClose} testID="sheet-scrim" />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            {!!tone && !!icon && (
              <View style={[styles.chip, { backgroundColor: SOLID[tone] }]} testID="sheet-icon">
                <Glyph name={icon} size={20} color={onSolid(tone)} />
              </View>
            )}
            <View style={styles.headText}>
              <Text style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.close}
              testID="sheet-close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {tabbed && sections.length > 0 && (
            <View style={styles.tabs} accessibilityRole="tablist">
              {sections.map((section, index) => {
                const active = index === tab;
                return (
                  <Pressable
                    key={section.title}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    onPress={() => setTab(index)}
                    style={[
                      styles.tab,
                      { borderColor: SOLID[switchTone] },
                      active && { backgroundColor: SOLID[switchTone] },
                    ]}
                    testID={`sheet-tab-${index}`}
                  >
                    <Text
                      style={[
                        styles.tabLabel,
                        { color: active ? onSolid(switchTone) : INK[switchTone] },
                      ]}
                      numberOfLines={1}
                    >
                      {section.title}
                    </Text>
                    <View
                      style={[
                        styles.tabCount,
                        {
                          backgroundColor: active ? colors.surface : SOLID[switchTone],
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionCountLabel,
                          { color: active ? INK[switchTone] : onSolid(switchTone) },
                        ]}
                      >
                        {section.options.length}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {shown.map(section => (
              <View key={section.title}>
                {tabbed ? null : tone ? (
                  <View style={styles.sectionRow}>
                    <View
                      style={[
                        styles.sectionPill,
                        { backgroundColor: WASH[tone], borderColor: EDGE[tone] },
                      ]}
                    >
                      <Text style={[styles.sectionPillLabel, { color: INK[tone] }]}>
                        {section.title}
                      </Text>
                    </View>
                    <View style={[styles.sectionCount, { backgroundColor: SOLID[tone] }]}>
                      <Text style={[styles.sectionCountLabel, { color: onSolid(tone) }]}>
                        {section.options.length}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.section}>{section.title}</Text>
                )}
                {section.options.map(option => {
                  const isSelected = option.value === selected;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected, disabled: option.disabled }}
                      onPress={() => {
                        onSelect(option.value);
                        onClose();
                      }}
                      disabled={option.disabled}
                      style={({ pressed }) => [
                        styles.option,
                        !!tone && { backgroundColor: WASH[tone], borderColor: EDGE[tone] },
                        isSelected &&
                          (tone
                            ? { borderColor: SOLID[tone], borderWidth: 2 }
                            : styles.optionSelected),
                        option.disabled && styles.optionDisabled,
                        pressed && !option.disabled && styles.optionPressed,
                      ]}
                      testID={`sheet-option-${option.value}`}
                    >
                      {!!tone && !!icon && (
                        <View style={[styles.chipSmall, { backgroundColor: SOLID[tone] }]}>
                          <Glyph name={icon} size={16} color={onSolid(tone)} />
                        </View>
                      )}
                      <View style={styles.optionBody}>
                        <Text style={styles.optionLabel}>{option.label}</Text>
                        {!!option.meta && <Text style={styles.optionMeta}>{option.meta}</Text>}
                      </View>
                      {!!option.badge && (
                        <View
                          style={[
                            styles.badge,
                            !!option.badgeTone && { backgroundColor: SOLID[option.badgeTone] },
                          ]}
                          testID={`sheet-badge-${option.value}`}
                        >
                          <Text
                            style={[
                              styles.badgeLabel,
                              !!option.badgeTone && {
                                color: onSolid(option.badgeTone),
                                fontFamily: typography.label.fontFamily,
                              },
                            ]}
                          >
                            {option.badge}
                          </Text>
                        </View>
                      )}
                      {isSelected &&
                        (tone ? (
                          <View style={[styles.tick, { backgroundColor: SOLID[tone] }]}>
                            <Ionicons name="checkmark" size={14} color={onSolid(tone)} />
                          </View>
                        ) : (
                          <Ionicons name="checkmark" size={18} color={colors.primaryDark} />
                        ))}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  /* The sheet is placed by this container rather than by flexing against the scrim.
     As siblings the scrim was a filled rectangle ending exactly at the sheet's top edge, so
     its straight bottom ran on behind the sheet's rounded corners and drew the square
     shoulder that made the sheet look like it had a second, flat card behind it. */
  root: { flex: 1, justifyContent: 'flex-end' },

  /* No tint. The sheet is separated from the page by its own white and its rounded top, and
     a wash over everything else only made the screen look like it had gone wrong. It still
     fills the screen, because it is what a tap outside the sheet lands on. */
  scrim: { ...StyleSheet.absoluteFillObject },

  // Rounded top corners and nothing else behind them. Both an elevation shadow and a
  // partial border get drawn from a rectangular outline on Android, and either one squares
  // off the curve into what looks like a second card sitting behind the sheet — so the
  // elevation is pinned at zero rather than merely left unset.
  sheet: {
    maxHeight: '78%',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    elevation: 0,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing[3],
  },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  headText: { flex: 1 },
  title: { ...typography.h2, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },

  list: { marginTop: spacing[4] },
  listContent: { paddingBottom: spacing[3] },
  section: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  optionPressed: { backgroundColor: colors.background },
  optionDisabled: { opacity: 0.5 },
  optionBody: { flex: 1 },
  optionLabel: { ...typography.bodyStrong, color: colors.ink },
  optionMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  badge: {
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  badgeLabel: { ...typography.caption, color: colors.textMuted },

  // -- tabbed -----------------------------------------------------------------------------
  tabs: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[4] },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  tabLabel: { ...typography.bodyStrong, flexShrink: 1 },
  tabCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // -- toned ------------------------------------------------------------------------------
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSmall: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },
  sectionPill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sectionPillLabel: { ...typography.label },
  sectionCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
});
