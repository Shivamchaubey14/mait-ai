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
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand';
import { colors, radius, spacing, typography } from '@theme/tokens';

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

      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
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
    paddingBottom: spacing[5],
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginLeft: 'auto' },
  title: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  subtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },
});
