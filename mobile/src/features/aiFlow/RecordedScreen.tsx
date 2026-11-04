/**
 * The end of a capture: a card that says it is recorded, and then Home.
 *
 * It used to be a screen with a progress bar on it, which a Mait watched while the photo and
 * the close went up — on a weak signal, for a long time, standing in a yard with the next
 * farmer waiting. Everything that screen was waiting on is now in the queue the moment the
 * button is pressed, sending in the background and listed on the waiting list if it cannot,
 * so there is nothing left for a person to wait for. What is left is to say so, briefly, and
 * get out of the way.
 *
 * Four seconds, then Home, on its own. A tap anywhere goes sooner.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { useReducedMotion } from '@/components/reducedMotion';
import { colors, radius, spacing, typography } from '@theme/tokens';

/** The tick, as a Lottie animation: about two seconds, inside the four the card is up. */
const SUCCESS_CHECK = require('../../../assets/animations/success-check.json');

/** How long the card stays before the Mait is taken Home. */
export const RECORDED_MS = 4000;

/** From this hour on it is night, and the card says so. */
const NIGHT_FROM_HOUR = 19;
const NIGHT_UNTIL_HOUR = 5;

function signOffKey(now = new Date()): string {
  const hour = now.getHours();
  const night = hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
  return night ? 'aiFlow.recordedNight' : 'aiFlow.recordedDay';
}

export default function RecordedScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const card = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const left = useRef(false);

  const leave = useRef(onDone);
  leave.current = onDone;
  const goHome = () => {
    if (!left.current) {
      left.current = true;
      leave.current();
    }
  };

  useEffect(() => {
    // Timed, not hung off the animation: a native-driver completion is not guaranteed to
    // arrive, and a Mait must never be left on this card.
    const timer = setTimeout(goHome, RECORDED_MS);
    return () => clearTimeout(timer);
  }, []);

  // The bar across the foot of the card: how long until Home, filling over the same four
  // seconds the timer above counts. Linear, because it is a clock rather than a flourish — and
  // run even with motion reduced, because it says something the Mait needs to know.
  useEffect(() => {
    const fill = Animated.timing(progress, {
      toValue: 1,
      duration: RECORDED_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    fill.start();
    return () => fill.stop();
  }, [progress]);

  useEffect(() => {
    if (reduced) {
      card.setValue(1);
      return undefined;
    }
    const run = Animated.spring(card, {
      toValue: 1,
      friction: 6,
      tension: 90,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [card, reduced]);

  return (
    <Pressable
      style={styles.root}
      onPress={goHome}
      accessibilityRole="button"
      accessibilityHint={t('aiFlow.backToHome')}
      testID="recorded"
    >
      <StatusBar style="light" />
      <Animated.View
        style={[
          styles.card,
          {
            opacity: card,
            transform: [
              { scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
            ],
          },
        ]}
      >
        {/* LottieFiles' "Success Check" by Pranav Patil (LottieFiles Free License), played once.
            Held on its last frame when the handset has asked for less motion. */}
        <LottieView
          source={SUCCESS_CHECK}
          autoPlay={!reduced}
          loop={false}
          progress={reduced ? 1 : undefined}
          style={styles.tick}
          testID="recorded-tick"
        />

        <AppText style={styles.title} testID="recorded-title">
          {t('aiFlow.recordedTitle')}
        </AppText>
        <AppText style={styles.signOff} testID="recorded-sign-off">
          {t(signOffKey())}
        </AppText>

        <View style={styles.going}>
          <AppText style={styles.goingLabel}>{t('aiFlow.backToHome')}</AppText>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel={t('aiFlow.backToHome')}
            testID="recorded-progress"
          >
            <Animated.View
              style={[styles.fill, { transform: [{ scaleX: progress }] }]}
              testID="recorded-progress-fill"
            />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    backgroundColor: colors.ink,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing[7],
    paddingHorizontal: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 12,
  },
  tick: { width: 150, height: 150, marginBottom: spacing[2] },
  title: { ...typography.h1, color: colors.primaryDark, textAlign: 'center', alignSelf: 'stretch' },
  signOff: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    alignSelf: 'stretch',
    marginTop: spacing[2],
  },
  going: { alignSelf: 'stretch', marginTop: spacing[6] },
  goingLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    alignSelf: 'stretch',
    marginBottom: spacing[2],
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryWash,
    overflow: 'hidden',
  },
  // Full width and scaled from its left edge, so the native driver can grow it — a width that
  // changed every frame would be laid out again on the JS thread each time.
  fill: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    transformOrigin: 'left',
  },
});
