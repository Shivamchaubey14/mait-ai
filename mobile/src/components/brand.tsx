/**
 * Brand and hero pieces shared by the splash and login screens.
 *
 * Kept apart from the generic primitives in `index.tsx` because these carry brand decisions
 * — the mark, the capability chips, the green field — rather than being neutral building
 * blocks.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, fonts, green, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

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

/**
 * The bare white wordmark, for dark surfaces.
 *
 * The splash and the sign-in hero are the two places the mark is not on a white card: it sits
 * directly on Ink, where a card would be a box drawn around the only thing in the room. The
 * `FIELD CAPTURE` line goes with it — both screens spend their second line on a sentence that
 * says more than a sub-label would.
 *
 * Same rule as `BrandMark`: English at every language setting.
 */
export function BrandWordmark({ size = 'large' }: { size?: 'large' | 'small' }) {
  const { t } = useTranslation();
  return (
    <Text style={size === 'small' ? styles.wordmarkSmall : styles.wordmark}>{t('brand.name')}</Text>
  );
}

// --------------------------------------------------------------------------------------
// Language toggle
// --------------------------------------------------------------------------------------
/**
 * Language switch.
 *
 * Lives in the dark hero on the screens that carry it — sign-in and Settings. The styling is
 * white-on-dark and only legible there: on a white card the unselected option and the track
 * both vanish into the background, leaving the language already in use as the only one that
 * can be seen, which is the one option nobody needs to tap.
 *
 * Two shapes of the same control. `segmented` fills the selected option, for the tight
 * headers where the labels have to shrink to `EN` / `हिं`. `inline` spells both languages out
 * and separates the selected one by weight and opacity alone — it is the first control on the
 * sign-in screen, where a user who cannot read the interface has to find their own language
 * written in their own script, not a two-letter abbreviation of it.
 */
export function LanguageToggle({
  variant = 'segmented',
}: {
  variant?: 'segmented' | 'inline' | 'compact' | 'light';
}) {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith('hi') ? 'hi' : 'en';
  const inline = variant === 'inline';

  // One pill showing the language in use, for the headers that also carry an avatar and have
  // no room for both options. The label names the language being switched *to*, so a screen
  // reader announces the action rather than the state.
  if (variant === 'compact') {
    const next = current === 'en' ? 'hi' : 'en';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={next === 'en' ? 'English' : 'हिन्दी'}
        onPress={() => i18n.changeLanguage(next)}
        style={({ pressed }) => [styles.compact, pressed && styles.compactPressed]}
        testID="language-compact"
      >
        <Text style={styles.toggleLabel}>{current === 'en' ? 'EN' : 'हिं'}</Text>
      </Pressable>
    );
  }

  // The same control for a white card, where the dark-surface one is invisible: its track is
  // a white wash and its labels are white, so on Profile the unselected language and the
  // track both disappeared and the only readable option was the one already in use.
  //
  // Green fills the selected half here rather than white, because on white there is nothing
  // else that reads as "this one". It is the only place in the app where green is not an
  // action — and a language switch is close enough to one that it does not fight the rule.
  if (variant === 'light') {
    return (
      <View style={styles.toggleLight}>
        {(['en', 'hi'] as const).map(code => {
          const active = current === code;
          return (
            <Pressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={code === 'en' ? 'English' : 'हिन्दी'}
              onPress={() => i18n.changeLanguage(code)}
              style={[styles.toggleOption, active && styles.toggleOptionLight]}
              testID={`language-${code}`}
            >
              <Text style={[styles.toggleLabelDark, active && styles.toggleLabelOnGreen]}>
                {code === 'en' ? 'EN' : 'हिन्दी'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.toggle, inline && styles.toggleInline]}>
      {(['en', 'hi'] as const).map((code, index) => {
        const active = current === code;
        return (
          <React.Fragment key={code}>
            {inline && index > 0 && <Text style={styles.toggleSeparator}>/</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={code === 'en' ? 'English' : 'हिन्दी'}
              onPress={() => i18n.changeLanguage(code)}
              style={[
                styles.toggleOption,
                inline && styles.toggleOptionInline,
                active && !inline && styles.toggleOptionActive,
              ]}
              testID={`language-${code}`}
            >
              <Text
                style={[
                  styles.toggleLabel,
                  active && (inline ? styles.toggleLabelSelected : styles.toggleLabelActive),
                  inline && !active && styles.toggleLabelInactive,
                ]}
              >
                {inline ? (code === 'en' ? 'English' : 'हिन्दी') : code === 'en' ? 'EN' : 'हिं'}
              </Text>
            </Pressable>
          </React.Fragment>
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

  wordmark: {
    ...typography.display,
    color: colors.surface,
    letterSpacing: 2,
    textAlign: 'center',
  },
  wordmarkSmall: {
    ...typography.h3,
    fontFamily: fonts.headingBold,
    color: colors.surface,
    letterSpacing: 1,
  },

  toggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.pill,
    padding: 3,
  },
  compact: {
    minHeight: MIN_TOUCH_TARGET - 16,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },

  toggleLight: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    padding: 3,
  },
  toggleOptionLight: { backgroundColor: colors.primary },
  toggleLabelDark: { ...typography.label, color: colors.textMuted },
  toggleLabelOnGreen: { color: colors.surface },

  toggleInline: {
    alignItems: 'center',
    paddingHorizontal: spacing[1],
  },
  toggleOption: {
    minWidth: 40,
    minHeight: MIN_TOUCH_TARGET - 16,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOptionInline: { minWidth: 0, paddingHorizontal: spacing[2] },
  toggleOptionActive: { backgroundColor: colors.surface },
  toggleLabel: { ...typography.label, color: colors.surface },
  toggleLabelActive: { color: colors.ink },
  /** Selected, in the inline shape: weight rather than a fill, so the pill stays one object. */
  toggleLabelSelected: { fontFamily: fonts.headingBold },
  toggleLabelInactive: { opacity: 0.6 },
  toggleSeparator: { ...typography.label, color: colors.surface, opacity: 0.4 },

  decoration: {
    position: 'absolute',
    backgroundColor: green[400],
    opacity: 0.55,
  },
});
