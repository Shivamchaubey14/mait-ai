/**
 * The green header every tab screen wears.
 *
 * One component rather than three copies: Home, Stock and Profile are places a Mait moves
 * between constantly, and a header that changes shape between them makes the app feel like
 * three apps. The capture flow has its own hero in `aiFlow/components.tsx` because it carries
 * a step number and a progress bar that make no sense outside the flow.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeroDecoration } from '@/components/brand';
import { colors, radius, spacing, typography } from '@theme/tokens';

export default function PageHero({
  title,
  subtitle,
  /** Sits above the title — the brand mark on Home, nothing elsewhere. */
  top,
  /** Overlaps the bottom edge, so a tile row can sit half on the green and half off it. */
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
      <HeroDecoration size={200} top={-90} right={-70} />
      {!!top && <View style={styles.top}>{top}</View>}
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[4] },
  title: { ...typography.h1, color: colors.surface },
  subtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.92,
    marginTop: spacing[1],
  },
});
