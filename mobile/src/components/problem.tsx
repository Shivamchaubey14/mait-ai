/**
 * When something is wrong, said in terms a Mait can act on.
 *
 * What was there before was one card for every failure: a red cloud, "Could not load your
 * history", and a Try again button. That sentence names the *screen's* problem, not the
 * Mait's, and it says nothing about the two things they actually need to know — whether the
 * work already on the handset is safe, and whether there is any point standing still.
 *
 * So the card is built from the cause rather than from the caller:
 *
 *   No network            The phone has no signal. Their fault-free, ordinary situation in a
 *                         village, and the queue is designed for it — so amber, not red.
 *   Not answering         The phone has signal and the server did not reply. That is our
 *                         fault, it is red, and nothing they recorded is at risk.
 *   Cannot sign in        The one step that genuinely cannot work offline, because the code
 *                         arrives by SMS.
 *   Still not answering   Retrying has given up. Says so plainly rather than spinning.
 *
 * Every variant carries a white reassurance box, because the question underneath all four is
 * the same one: *is my work lost*. Answering it in the same place every time is what stops a
 * Mait re-entering an insemination they have already recorded.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { IT_SUPPORT_PHONE } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

export type ProblemKind = 'offline' | 'server' | 'signIn' | 'exhausted';

/**
 * Whether the radio has a connection.
 *
 * Read here rather than threaded through every screen: the card is rendered by seven
 * different places and the cause is a property of the handset, not of the screen that
 * happened to notice. Defaults to online — a card that says "no network" on a working phone
 * sends a Mait walking to a hilltop for nothing.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => setOnline(!!state.isConnected));
    // Wrapped rather than chained. `fetch` is a native module call and hands back `undefined`
    // wherever the native side is absent — every suite that calls `jest.resetAllMocks()`, and
    // any platform without the module. Chaining `.then` onto that throws during the render of
    // whatever screen happened to mount the card, which is every screen that can fail.
    Promise.resolve(NetInfo.fetch?.())
      .then(state => setOnline(!!state?.isConnected))
      .catch(() => undefined);
    return () => unsubscribe?.();
  }, []);

  return online;
}

const TONE = {
  offline: 'warning',
  server: 'error',
  signIn: 'error',
  exhausted: 'warning',
} as const;

const ICON: Record<ProblemKind, React.ComponentProps<typeof Ionicons>['name']> = {
  offline: 'cloud-offline-outline',
  server: 'server-outline',
  signIn: 'cloud-offline-outline',
  exhausted: 'time-outline',
};

export interface ProblemProps {
  kind: ProblemKind;
  /** The primary action. Always present — a dead end is not a state a Mait can leave. */
  onRetry: () => void;
  busy?: boolean;
  /**
   * Records still held on this handset. Named in the reassurance line when offline, because
   * "your 3 saved records are safe" answers the question and "your work is safe" does not.
   */
  pending?: number;
  /** When the server was last reached, for the variant that says it has stopped answering. */
  lastReachedAt?: string | null;
  /** Attempts made and allowed, once retrying has given up. */
  attempts?: { made: number; of: number };
  /** Dismiss. Only where there is something to go back to — omitted, the card has one button. */
  onDismiss?: () => void;
  testID?: string;
}

export default function Problem({
  kind,
  onRetry,
  busy = false,
  pending = 0,
  lastReachedAt,
  attempts,
  onDismiss,
  testID = 'problem',
}: ProblemProps): React.JSX.Element {
  const { t } = useTranslation();
  const tone = TONE[kind];

  const subtitle =
    kind === 'server' && lastReachedAt
      ? t('problem.server.subtitleSince', { time: lastReachedAt })
      : kind === 'exhausted' && attempts
        ? t('problem.exhausted.subtitleAt', {
            count: attempts.made,
            time: lastReachedAt ?? '',
          })
        : t(`problem.${kind}.subtitle`);

  // Offline is the only one whose reassurance changes with the facts: how many records are
  // waiting decides whether there is anything to reassure anybody about.
  const reassurance =
    kind === 'offline'
      ? pending > 0
        ? t('problem.offline.holding', { count: pending })
        : t('problem.offline.nothingHeld')
      : t(`problem.${kind}.reassurance`);

  /**
   * The second button, and only where it leads somewhere.
   *
   * "Report" and "Call" both need a number to reach, and there is none until
   * `extra.itSupportPhone` is set. A button that does nothing is worse than no button: it
   * costs a Mait a tap and their belief that the app does what it says.
   */
  const canCall = !!IT_SUPPORT_PHONE && (kind === 'server' || kind === 'exhausted');
  const secondary = onDismiss
    ? { label: t('problem.dismiss'), onPress: onDismiss, testID: 'problem-dismiss' }
    : canCall
      ? {
          label: t(`problem.${kind}.secondary`),
          onPress: () => Linking.openURL(`tel:${IT_SUPPORT_PHONE}`),
          testID: 'problem-call',
        }
      : null;

  return (
    <View
      style={[styles.card, tone === 'error' ? styles.cardError : styles.cardWarning]}
      testID={testID}
    >
      <View style={styles.head}>
        <Ionicons
          name={ICON[kind]}
          size={19}
          color={tone === 'error' ? colors.error : colors.secondaryPressed}
        />
        <Text style={styles.title} testID="problem-title">
          {t(`problem.${kind}.title`)}
        </Text>
      </View>

      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* The answer to "is my work lost", in the same place in every variant. White, so it
          reads as a fact set apart from the colour of the alarm around it. */}
      <View style={styles.reassurance}>
        <Text style={styles.reassuranceText} testID="problem-reassurance">
          {reassurance}
        </Text>

        {!!attempts && (
          <View style={styles.attempts}>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(100, (attempts.made / attempts.of) * 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.attemptsLabel}>{`${attempts.made} / ${attempts.of}`}</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          onPress={onRetry}
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed && !busy && styles.pressed]}
          testID="problem-retry"
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <>
              <Ionicons name="refresh" size={17} color={colors.surface} />
              <Text style={styles.primaryLabel} numberOfLines={1}>
                {t(`problem.${kind}.primary`)}
              </Text>
            </>
          )}
        </Pressable>

        {!!secondary && (
          <Pressable
            accessibilityRole="button"
            onPress={secondary.onPress}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID={secondary.testID}
          >
            <Text style={styles.secondaryLabel} numberOfLines={1}>
              {secondary.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  // Amber for a situation, red for a fault. No signal in a village is not a fault, and a
  // Mait who is told it is one starts doubting the handset every time they walk into a dip.
  cardWarning: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  cardError: { backgroundColor: colors.errorWash, borderColor: colors.error },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { ...typography.h3, color: colors.ink, flexShrink: 1 },
  subtitle: { ...typography.caption, color: colors.textMuted, marginTop: spacing[1] },

  reassurance: {
    marginTop: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reassuranceText: { ...typography.caption, color: colors.text, lineHeight: 18 },

  attempts: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[3] },
  track: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.primary },
  attemptsLabel: { ...typography.caption, color: colors.textMuted },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[4] },
  pressed: { opacity: 0.85 },
  primary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.bodyStrong, color: colors.surface },
  secondary: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.bodyStrong, color: colors.textMuted },
});

/** Amber for a situation, red for a fault — exported so a test can assert the difference. */
export const PROBLEM_TONE = TONE;
