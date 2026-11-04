/**
 * The Ink header every tab screen wears.
 *
 * One component rather than three copies: Home, Stock and Profile are places a Mait moves
 * between constantly, and a header that changes shape between them makes the app feel like
 * three apps. The capture flow has its own hero in `aiFlow/components.tsx` because it carries
 * a step number and a progress bar that make no sense outside the flow.
 *
 * Ink rather than green, so the green in this product means one thing: the action to take.
 * A green header on every screen spends the loudest colour on furniture.
 */

import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppText from '@/components/AppText';
import { BrandMark } from '@/components/brand';
import { colors, radius, spacing, typography, yolk } from '@theme/tokens';

/** The size the title is set at when it fits, and the smallest it is allowed to be measured to. */
const TITLE_MAX = 26;
const TITLE_MIN = 16;

/**
 * How wide one character runs as a fraction of the font size, for the bold heading face.
 * Names reach this hero uppercase from the roster and capitals are the wide case, so the
 * figure is deliberately generous: overestimating costs a point of font size, underestimating
 * costs the end of somebody's name.
 */
const HEADING_CHAR_RATIO = 0.62;

/**
 * The largest size at which `title` still fits on one line in `available` points.
 *
 * A Mait's full name is the one word on this screen that is theirs, and a two-line name pushed
 * the Ink card taller on exactly the handsets that have the least room — while a name broken
 * across lines reads as two people. So the title is set to fit instead of to a fixed size, and
 * the card is as tall as a one-line name needs and no taller.
 *
 * Exported for the test: this is arithmetic, and arithmetic is worth checking without a
 * renderer in the way.
 */
export function fitTitleSize(title: string, available: number): number {
  const chars = title.trim().length;
  if (chars === 0) {
    return TITLE_MAX;
  }
  const fitted = Math.floor(available / (chars * HEADING_CHAR_RATIO));
  return Math.max(TITLE_MIN, Math.min(TITLE_MAX, fitted));
}

export default function PageHero({
  title,
  eyebrow,
  eyebrowIcon,
  subtitle,
  /** Sits beside the mark — an avatar, a filter, whatever the screen needs there. */
  top,
  children,
}: {
  title: string;
  /** A short line over the title — on Home, the greeting. */
  eyebrow?: string;
  /** Drawn before the eyebrow — on Home, the sun for the time of day. */
  eyebrowIcon?: React.ReactNode;
  subtitle?: string;
  top?: React.ReactNode;
  children?: React.ReactNode;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const fontSize = fitTitleSize(title, width - spacing[5] * 2);

  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing[3] }]}>
      {/* The mark rides on every screen, not just Home. A Mait hands this phone to a farmer
          to read an OTP off, and the app should say whose app it is wherever they are.

          The badge and the name, as on the splash and the sign-in hero — one logo from the
          launcher icon to the last screen. */}
      <View style={styles.top}>
        <BrandMark size="small" />
        {!!top && <View style={styles.topRight}>{top}</View>}
      </View>

      {!!eyebrow && (
        <View style={styles.eyebrowRow}>
          {eyebrowIcon}
          <AppText style={styles.eyebrow}>{eyebrow}</AppText>
        </View>
      )}

      {/* `adjustsFontSizeToFit` behind the measurement, not instead of it: the estimate above
          is a character count and cannot know that a particular name is all M's and W's, so
          the renderer gets the last word. `numberOfLines` is what actually holds the line. */}
      <AppText
        style={[styles.title, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {title}
      </AppText>
      {!!subtitle && (
        <AppText style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </AppText>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginLeft: 'auto' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: 2 },
  // Warm and a size up from a label: the greeting is the first thing the screen says.
  // Fills the row beside the icon rather than sizing to itself — Android measures Hindi narrow,
  // and "शुभ संध्या" sized to that would lose its second word.
  eyebrow: { ...typography.h2, fontFamily: typography.h3.fontFamily, color: yolk[300], flex: 1 },
  // Size and line height are set per title by `fitTitleSize`; what is left here is the face.
  title: { ...typography.display, color: colors.surface },
  subtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },
});
