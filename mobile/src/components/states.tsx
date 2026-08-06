/**
 * The four states every data screen has, and the three sync indicators.
 *
 * Written once because they are what a Mait sees most: a list that is loading, a day that has
 * not started yet, a server that did not answer, and — constantly — whether what they just
 * recorded has actually left the phone.
 *
 * The error state never says "something went wrong" and stops there. On a handset holding
 * unsent inseminations, the first question is not what broke but whether the work is lost, so
 * that is what it answers.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------------------
/**
 * Skeleton rows rather than a spinner.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is the shape of what is coming",
 * which on a slow rural connection is the difference between waiting and force-quitting.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" testID="skeleton">
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonAvatar} />
          {/* Two bars of unequal length, so the block reads as a name over a detail rather
              than as a loading graphic. */}
          <View style={styles.skeletonBody}>
            <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
            <View style={[styles.skeletonBar, styles.skeletonBarThin]} />
          </View>
        </View>
      ))}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Empty and error
// --------------------------------------------------------------------------------------
function CentredState({
  tone,
  icon,
  title,
  body,
  action,
  pointsDown,
  testID,
}: {
  tone: 'good' | 'bad';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; busy?: boolean; testID?: string };
  pointsDown?: string;
  testID?: string;
}): React.JSX.Element {
  const wash = tone === 'good' ? colors.primaryWash : colors.errorWash;
  const tint = tone === 'good' ? colors.primary : colors.error;

  return (
    <View style={styles.centred} testID={testID}>
      <View style={[styles.centredIcon, { backgroundColor: wash }]}>
        <Ionicons name={icon} size={26} color={tint} />
      </View>
      <Text style={styles.centredTitle}>{title}</Text>
      <Text style={styles.centredBody}>{body}</Text>

      {!!action && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: action.busy }}
          onPress={action.onPress}
          disabled={action.busy}
          style={({ pressed }) => [styles.centredCta, pressed && styles.centredCtaPressed]}
          testID={action.testID}
        >
          {action.busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.centredCtaLabel}>{action.label}</Text>
          )}
        </Pressable>
      )}

      {!!pointsDown && (
        <View style={styles.pointer} testID={testID ? `${testID}-pointer` : undefined}>
          <Text style={styles.pointerLabel}>{pointsDown}</Text>
          <Ionicons name="arrow-down" size={22} color={colors.primary} />
        </View>
      )}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  /**
   * Points at a control that already exists elsewhere on screen.
   *
   * Preferred over a second button doing the same thing: two ways to start an AI teaches a
   * Mait nothing, while an arrow teaches them where the button lives for every day after
   * this one.
   */
  pointsDown,
  testID = 'empty-state',
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; testID?: string };
  pointsDown?: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <CentredState
      tone="good"
      icon="leaf-outline"
      title={title}
      body={body}
      action={action}
      pointsDown={pointsDown}
      testID={testID}
    />
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
  busy,
  testID = 'error-state',
}: {
  title: string;
  body?: string;
  onRetry: () => void;
  busy?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <CentredState
      tone="bad"
      icon="cloud-offline-outline"
      title={title}
      // The default says the queued work is safe, because that is the actual question.
      body={body ?? t('states.errorBody')}
      action={{ label: t('states.tryAgain'), onPress: onRetry, busy, testID: 'retry' }}
      testID={testID}
    />
  );
}

// --------------------------------------------------------------------------------------
// Sync indicators
// --------------------------------------------------------------------------------------
export type SyncTone = 'offline' | 'queued' | 'synced';

/**
 * The one line that tells a Mait where their work is.
 *
 * Yellow means it is on the phone and will send itself; green means the phone is empty and
 * the server has it. Neither is an error, and neither is styled as one — a Mait who has just
 * done ten inseminations with no signal has done nothing wrong.
 */
export function SyncBanner({
  tone,
  title,
  body,
  action,
  /** A short figure worth reading before the sentence — "3 sent", "12 straws". */
  metric,
  testID,
}: {
  tone: SyncTone;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  metric?: string;
  testID?: string;
}): React.JSX.Element {
  const palette = {
    offline: {
      tint: colors.secondaryPressed,
      wash: colors.secondaryWash,
      icon: 'cloud-offline' as const,
    },
    queued: {
      tint: colors.secondaryPressed,
      wash: colors.secondaryWash,
      icon: 'time' as const,
    },
    synced: {
      tint: colors.primary,
      wash: colors.primaryWash,
      icon: 'checkmark-done' as const,
    },
  }[tone];

  return (
    <View style={[styles.banner, { borderLeftColor: palette.tint }]} testID={testID}>
      {/* A glyph in a disc rather than a bare dot: this card is read a hundred times a day,
          and at a glance the shape is what carries the meaning, not the colour. */}
      <View style={[styles.bannerIcon, { backgroundColor: palette.wash }]}>
        <Ionicons name={palette.icon} size={18} color={palette.tint} />
      </View>

      <View style={styles.bannerBody}>
        <Text style={styles.bannerTitle}>{title}</Text>
        {!!body && <Text style={styles.bannerText}>{body}</Text>}
      </View>

      {!!metric && (
        <View style={[styles.bannerMetric, { backgroundColor: palette.wash }]}>
          <Text style={[styles.bannerMetricLabel, { color: palette.tint }]}>{metric}</Text>
        </View>
      )}

      {!!action && (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.bannerAction, pressed && styles.bannerActionPressed]}
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={styles.bannerActionLabel}>{action.label}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primaryDark} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // -- skeleton ---------------------------------------------------------------------------
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  skeletonAvatar: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  skeletonBody: { flex: 1, gap: spacing[2] },
  skeletonBar: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  skeletonBarWide: { width: '62%' },
  skeletonBarThin: { height: 8, width: '38%' },

  // -- centred states ---------------------------------------------------------------------
  centred: {
    alignItems: 'center',
    paddingVertical: spacing[7],
    paddingHorizontal: spacing[4],
  },
  centredIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  centredTitle: { ...typography.h2, color: colors.ink, textAlign: 'center' },
  centredBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[2],
  },
  centredCta: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minHeight: MIN_TOUCH_TARGET + 6,
    marginTop: spacing[5],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  centredCtaPressed: { backgroundColor: colors.primaryPressed },
  centredCtaLabel: { ...typography.bodyStrong, color: colors.surface },

  // Aimed at the button on the bar below rather than repeating it here.
  pointer: { alignItems: 'center', gap: spacing[2], marginTop: spacing[5] },
  pointerLabel: { ...typography.bodyStrong, color: colors.primaryDark },

  // -- sync banner ------------------------------------------------------------------------
  // White card with a coloured spine, not a tinted block. It sits at the top of a screen a
  // Mait opens all day, so it has to read as information rather than as a warning.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    ...shadows.card,
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBody: { flex: 1 },
  bannerTitle: { ...typography.bodyStrong, color: colors.ink },
  bannerText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  bannerMetric: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  bannerMetricLabel: { ...typography.label },
  bannerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingLeft: spacing[2],
  },
  bannerActionPressed: { opacity: 0.6 },
  bannerActionLabel: { ...typography.label, color: colors.primaryDark },
});
