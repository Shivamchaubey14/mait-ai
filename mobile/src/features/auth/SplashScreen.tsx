/**
 * Splash screen.
 *
 * Shown while the fonts and the stored session load. Four things on an Ink field: the mark,
 * one line saying what the app is for, a progress bar, the version. Nothing else — this
 * screen is a hold, and anything a Mait might want to read here they cannot act on yet.
 *
 * The three capability chips — works offline, camera click, straw stock — used to live here
 * and on sign-in. Both screens dropped them: they were being read during the one second
 * nobody reads, and the app demonstrates all three within a minute of being used.
 *
 * The progress bar is determinate where it can be. A spinner says "wait"; a bar says "wait,
 * and here is how long", which matters on the cheap hardware this runs on.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandWordmark } from '@/components/brand';
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
      {/* The app-wide bar is green, for the hero headers every other screen opens with.
          This screen is Ink to the top edge, and a green strip above it reads as a
          rendering fault. */}
      <StatusBar style="light" backgroundColor={colors.ink} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.centre}>
          <BrandWordmark />
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>

          <View
            style={styles.track}
            // Without `accessible`, the role and the value sit on a view TalkBack walks
            // straight past — the one thing on this screen worth announcing goes unread.
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
          >
            <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
          </View>

          <Text style={styles.version}>{t('splash.version', { version })}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  safe: { flex: 1, paddingHorizontal: spacing[5] },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: {
    ...typography.body,
    color: colors.surface,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
    marginTop: spacing[5],
    // Muted against the white mark, but not as faint as it looks on a designer's monitor —
    // this is read in sunlight on a screen with the brightness turned down to save battery.
    opacity: 0.72,
  },
  track: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    width: '48%',
    marginTop: spacing[6],
  },
  fill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },
  version: {
    ...typography.caption,
    color: colors.surface,
    textAlign: 'center',
    marginTop: spacing[6],
    opacity: 0.65,
  },
});
