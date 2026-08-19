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

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { useKeyboardOverlap } from './keyboard';

export interface SheetOption {
  value: string;
  label: string;
  /** One line under the label — a unit, a count already held. */
  meta?: string;
  /** A short qualifier on the right, e.g. "6 in hand". */
  badge?: string;
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
  testID,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  sections: SheetSection[];
  selected?: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

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
            {sections.map(section => (
              <View key={section.title}>
                <Text style={styles.section}>{section.title}</Text>
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
                        isSelected && styles.optionSelected,
                        option.disabled && styles.optionDisabled,
                        pressed && !option.disabled && styles.optionPressed,
                      ]}
                      testID={`sheet-option-${option.value}`}
                    >
                      <View style={styles.optionBody}>
                        <Text style={styles.optionLabel}>{option.label}</Text>
                        {!!option.meta && <Text style={styles.optionMeta}>{option.meta}</Text>}
                      </View>
                      {!!option.badge && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeLabel}>{option.badge}</Text>
                        </View>
                      )}
                      {isSelected && (
                        <Ionicons name="checkmark" size={18} color={colors.primaryDark} />
                      )}
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
});
