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

import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      {/* Barely tinted rather than dimmed. A dark scrim reads as the screen having gone
          wrong, and the sheet is already separated by its rounded top and its shadow.
          Tapping here closes it; on Android the hardware back button does too. */}
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
          {children}
        </ScrollView>

        {footer}
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
      onRequestClose={onClose}
      testID={testID}
    >
      {/* Barely tinted rather than dimmed. A dark scrim reads as the screen having gone
          wrong, and the sheet is already separated by its rounded top and its shadow.
          Tapping here closes it; on Android the hardware back button does too, via
          onRequestClose — a sheet with no way out is a trapped Mait. */}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(37,61,78,0.08)' },

  sheet: {
    maxHeight: '78%',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
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
