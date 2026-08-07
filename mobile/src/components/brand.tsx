/**
 * Brand and hero pieces shared by the splash and login screens.
 *
 * Kept apart from the generic primitives in `index.tsx` because these carry brand decisions
 * — the mark, the capability chips, the green field — rather than being neutral building
 * blocks.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Brand mark
// --------------------------------------------------------------------------------------
/**
 * The white "MAIT AI / FIELD CAPTURE" pill.
 *
 * Both lines stay in English at every language setting. A product name that changes script
 * between sessions stops being recognisable, which is the one thing a mark has to do.
 */
export function BrandMark({ size = 'large' }: { size?: 'large' | 'small' }) {
  const { t } = useTranslation();
  const small = size === 'small';

  return (
    <View style={[styles.markCard, small && styles.markCardSmall]}>
      <Text style={[styles.markName, small && styles.markNameSmall]}>{t('brand.name')}</Text>
      <Text style={[styles.markTagline, small && styles.markTaglineSmall]}>
        {t('brand.tagline')}
      </Text>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Capability chips
// --------------------------------------------------------------------------------------
const CAPABILITIES = [
  { key: 'worksOffline', icon: 'cloud-offline-outline' },
  { key: 'cameraCapture', icon: 'camera-outline' },
  { key: 'strawStock', icon: 'layers-outline' },
] as const;

/**
 * The three promises, shown before sign-in.
 *
 * They answer the question a Mait actually has standing in a field with one bar of signal:
 * will this work out here. Stated up front rather than discovered.
 */
export function CapabilityChips({ style }: { style?: ViewStyle }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.chipRow, style]}>
      {CAPABILITIES.map(({ key, icon }) => (
        <View key={key} style={styles.chip}>
          <View style={styles.chipIcon}>
            <Ionicons name={icon} size={16} color={colors.surface} />
          </View>
          <Text style={styles.chipLabel} numberOfLines={2}>
            {t(`capability.${key}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Language toggle
// --------------------------------------------------------------------------------------
/**
 * EN / हिं switch.
 *
 * Lives in the green hero on both screens that carry it — sign-in and Settings. The styling
 * is white-on-green and only legible there: on a white card the unselected option and the
 * track both vanish into the background, leaving the language already in use as the only
 * one that can be seen, which is the one option nobody needs to tap.
 */
export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith('hi') ? 'hi' : 'en';

  return (
    <View style={styles.toggle}>
      {(['en', 'hi'] as const).map(code => {
        const active = current === code;
        return (
          <Pressable
            key={code}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={code === 'en' ? 'English' : 'हिन्दी'}
            onPress={() => i18n.changeLanguage(code)}
            style={[styles.toggleOption, active && styles.toggleOptionActive]}
            testID={`language-${code}`}
          >
            <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>
              {code === 'en' ? 'EN' : 'हिं'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Decorative green field
// --------------------------------------------------------------------------------------
/**
 * The soft lighter disc in the top-right of the green areas.
 *
 * `pointerEvents="none"` so it never intercepts a tap meant for the toggle sitting on top
 * of it.
 */
export function HeroDecoration({ size = 260, top = -90, right = -70 }) {
  return (
    <View
      pointerEvents="none"
      style={[styles.decoration, { width: size, height: size, borderRadius: size / 2, top, right }]}
    />
  );
}

const styles = StyleSheet.create({
  markCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    alignItems: 'center',
    alignSelf: 'center',
  },
  markCardSmall: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    alignSelf: 'flex-start',
  },
  markName: {
    ...typography.h1,
    color: colors.ink,
    letterSpacing: 0.5,
  },
  markNameSmall: { ...typography.h3, color: colors.ink, letterSpacing: 0.4 },
  markTagline: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 2.4,
    marginTop: 2,
  },
  markTaglineSmall: {
    ...typography.caption,
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
    letterSpacing: 1.6,
  },

  chipRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    alignItems: 'center',
    gap: spacing[2],
  },
  chipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: {
    ...typography.caption,
    color: colors.surface,
    textAlign: 'center',
  },

  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.pill,
    padding: 3,
  },
  toggleOption: {
    minWidth: 40,
    minHeight: MIN_TOUCH_TARGET - 16,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOptionActive: { backgroundColor: colors.surface },
  toggleLabel: { ...typography.label, color: colors.surface },
  toggleLabelActive: { color: colors.ink },

  decoration: {
    position: 'absolute',
    backgroundColor: green[400],
    opacity: 0.55,
  },
});
