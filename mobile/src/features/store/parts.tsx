/**
 * The pieces the store keeper's screens share.
 *
 * The keeper's app is the Mait's app with a different job, so it wears the same frame: the Ink
 * hero welded to the top with its bottom corners rounded, white cards outlined on the grey
 * page, one green action at the foot. That frame moved to `components/frame.tsx` the day the
 * zonal manager's shell needed it too — the names here are unchanged and re-exported, because
 * a rename across six screens and their tests would be a diff about nothing.
 *
 * What is left in this file is genuinely the store's: the word a shelf puts on an indent, the
 * stepper a keeper counts straws out with, and the flask toggle.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppHero, FooterAction, frameStyles } from '@/components/frame';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

import type { StoreIndent } from '@api/types';

export { clock, itemLabel, Pill } from '@/components/frame';
export type { PillTone } from '@/components/frame';

/** The store's hero and its one green action, under the names the keeper's screens use. */
export const StoreHero = AppHero;
export const StoreAction = FooterAction;
export const storeStyles = frameStyles;

// --------------------------------------------------------------------------------------
// Readiness pill
// --------------------------------------------------------------------------------------
/**
 * What the shelf can do about an indent, as the word on its row.
 *
 * Green when it covers what is owed, amber when it covers some — the keeper can still hand
 * over what there is — and red when it covers none, with how long the Mait has been waiting,
 * because that is the number somebody will be asked about.
 */
export function readinessPill(
  indent: StoreIndent,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; tone: 'good' | 'waiting' | 'bad' | 'plain' } {
  if (indent.readiness === 'ready') {
    return { label: t('store.pillReady'), tone: 'good' };
  }
  if (indent.readiness === 'short') {
    return { label: t('store.pillShort', { count: indent.short_by }), tone: 'waiting' };
  }
  return {
    label:
      indent.waiting_days > 0
        ? t('store.pillWaitingDays', { days: indent.waiting_days })
        : t('store.pillWaiting'),
    tone: 'bad',
  };
}

// --------------------------------------------------------------------------------------
// Stepper
// --------------------------------------------------------------------------------------
/**
 * Two big targets and the figure between them.
 *
 * A keeper counting straws out of a canister is holding the canister. Typing 18 is a thing
 * that goes wrong as 81; tapping minus seven times from 25 does not. The ceiling is whatever
 * is smaller of what is owed and what is on the shelf, so the button cannot promise more than
 * either.
 */
export function Stepper({
  value,
  min = 1,
  max,
  onChange,
  testID,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  testID: string;
}): React.JSX.Element {
  const canLess = value > min;
  const canMore = value < max;
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="−"
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={!canLess}
        style={({ pressed }) => [
          styles.step,
          !canLess && styles.stepInert,
          pressed && canLess && styles.stepPressed,
        ]}
        testID={`${testID}-less`}
      >
        <Ionicons
          name="remove"
          size={20}
          color={canLess ? colors.primaryDark : colors.textDisabled}
        />
      </Pressable>

      <Text style={styles.stepValue} testID={`${testID}-value`}>
        {value}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="+"
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={!canMore}
        style={({ pressed }) => [
          styles.step,
          !canMore && styles.stepInert,
          pressed && canMore && styles.stepPressed,
        ]}
        testID={`${testID}-more`}
      >
        <Ionicons name="add" size={20} color={canMore ? colors.primaryDark : colors.textDisabled} />
      </Pressable>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Toggle
// --------------------------------------------------------------------------------------
/**
 * A yes/no the keeper confirms with a thumb — the flask check.
 *
 * Drawn rather than taken from React Native's `Switch`, which is a different control on every
 * Android skin: a thin grey rail on one handset and a square box on the next, neither of them
 * the green pill the design asks for. This one is the same everywhere, and it is a full touch
 * target rather than the forty-by-twenty strip the platform draws.
 */
export function Toggle({
  value,
  onChange,
  label,
  testID,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={[styles.toggle, value && styles.toggleOn]}
      testID={testID}
    >
      <View style={[styles.thumb, value && styles.thumbOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryWash,
  },
  stepPressed: { backgroundColor: colors.primaryWash, opacity: 0.7 },
  stepInert: { backgroundColor: colors.disabledFill },
  stepValue: { ...typography.h2, color: colors.ink, minWidth: 36, textAlign: 'center' },

  toggle: {
    width: 52,
    height: 30,
    borderRadius: 15,
    padding: 3,
    justifyContent: 'center',
    backgroundColor: colors.disabledFill,
  },
  toggleOn: { backgroundColor: colors.primary },
  thumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  thumbOn: { alignSelf: 'flex-end' },
});
