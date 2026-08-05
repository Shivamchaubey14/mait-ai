/**
 * Splash screen.
 *
 * Shown while the fonts and the stored session load. It states the three things a Mait
 * standing in a field actually wants to know — it works offline, it uses the camera, it
 * tracks straws — rather than being a blank hold.
 *
 * The progress bar is determinate where it can be. A spinner says "wait"; a bar says "wait,
 * and here is how long", which matters on the cheap hardware this runs on.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandMark, CapabilityChips, HeroDecoration } from '@/components/brand';
import { colors, radius, spacing, typography } from '@theme/tokens';

interface Props {
  /** 0–1. Drives the bar; anything below 0 renders it as indeterminate-looking but full-width. */
  progress?: number;
}

export default function SplashScreen({ progress = 0.35 }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version ?? '0.1.0';
  const clamped = Math.max(0.06, Math.min(1, progress));

  return (
    <View style={styles.root}>
      <HeroDecoration size={300} top={-110} right={-90} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <BrandMark />
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>
        </View>

        <View style={styles.footer}>
          <CapabilityChips />

          <View style={styles.track} accessibilityRole="progressbar">
            <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
          </View>

          <Text style={styles.version}>{t('splash.version', { version })}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  safe: { flex: 1, paddingHorizontal: spacing[5] },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[5],
  },
  tagline: {
    ...typography.bodyStrong,
    color: colors.surface,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
    opacity: 0.95,
  },
  footer: { gap: spacing[4], paddingBottom: spacing[3] },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
    alignSelf: 'center',
    width: '46%',
  },
  fill: { height: '100%', backgroundColor: colors.surface, borderRadius: radius.pill },
  version: {
    ...typography.caption,
    color: colors.surface,
    textAlign: 'center',
    opacity: 0.8,
  },
});
