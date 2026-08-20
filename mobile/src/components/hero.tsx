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
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand';
import { colors, radius, spacing, typography } from '@theme/tokens';

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
  subtitle,
  /** Sits beside the mark — an avatar, a filter, whatever the screen needs there. */
  top,
  children,
}: {
  title: string;
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

          The white tile, not the bare wordmark. Bare is right on the splash and the sign-in
          hero, where the mark is the only thing in the room and a card would be a box drawn
          around it — here it shares a row with an avatar and a language toggle, and set as
          plain text it read as a heading rather than as a mark. It is the same object the
          admin portal pins to the top of its sidebar, so the two halves of the product are
          recognisably one. */}
      <View style={styles.top}>
        <BrandMark size="small" />
        {!!top && <View style={styles.topRight}>{top}</View>}
      </View>

      {/* `adjustsFontSizeToFit` behind the measurement, not instead of it: the estimate above
          is a character count and cannot know that a particular name is all M's and W's, so
          the renderer gets the last word. `numberOfLines` is what actually holds the line. */}
      <Text
        style={[styles.title, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {title}
      </Text>
      {!!subtitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
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
  // Size and line height are set per title by `fitTitleSize`; what is left here is the face.
  title: { ...typography.display, color: colors.surface },
  subtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },
});
