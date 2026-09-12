/**
 * The pieces the store keeper's screens share.
 *
 * The keeper's app is the Mait's app with a different job, so it wears the same frame: the Ink
 * hero welded to the top with its bottom corners rounded, white cards outlined on the grey
 * page, one green action at the foot. What is particular to the store is small — the pill that
 * says which store this is, a green hero for a handover that has happened, and the stepper a
 * keeper counts straws out with.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { fitTitleSize } from '@/components/hero';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import type { StoreIndent } from '@api/types';

/** The breed or product as the keeper reads it, in the language the app is in. */
export function itemLabel(
  item: { item_name: string; item_name_hi: string },
  language: string,
): string {
  return (language.startsWith('hi') && item.item_name_hi) || item.item_name;
}

/** 24-hour and local: the keeper is matching a slip against a clock on the wall. */
export function clock(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------------------
// Hero
// --------------------------------------------------------------------------------------
/**
 * The top of every store screen.
 *
 * Ink for a place and a question, green for a handover that has just happened — the same
 * split the capture flow makes between a step and *Recorded*, so green keeps meaning "done"
 * across both halves of the product. The back control sits on the right, where the mockup
 * puts it, so the left edge always starts with the words.
 */
export function StoreHero({
  eyebrow,
  title,
  subtitle,
  pill,
  onBack,
  done = false,
  testID,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** The store's name, in the corner. */
  pill?: string;
  onBack?: () => void;
  /** Green, with the tick in place of the top row. */
  done?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const fontSize = fitTitleSize(title, width - spacing[5] * 2);

  return (
    <View
      style={[styles.hero, done && styles.heroDone, { paddingTop: insets.top + spacing[4] }]}
      testID={testID}
    >
      <StatusBar style="light" backgroundColor={done ? colors.primaryDark : colors.ink} />

      {done ? (
        <View style={styles.doneRow}>
          <View style={styles.doneDisc}>
            <Ionicons name="checkmark" size={30} color={colors.surface} />
          </View>
        </View>
      ) : (
        <View style={styles.top}>
          {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          <View style={styles.topRight}>
            {!!pill && (
              <View style={styles.storePill} testID="store-pill">
                <Text style={styles.storePillLabel} numberOfLines={1}>
                  {pill}
                </Text>
              </View>
            )}
            {!!onBack && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onBack}
                style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
                testID="store-back"
              >
                <Ionicons name="arrow-back" size={20} color={colors.surface} />
              </Pressable>
            )}
          </View>
        </View>
      )}

      <Text
        style={[
          styles.title,
          { fontSize, lineHeight: Math.round(fontSize * 1.3) },
          done && styles.centred,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {title}
      </Text>
      {!!subtitle && (
        <Text style={[styles.subtitle, done && styles.subtitleDone, done && styles.centred]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Readiness pill
// --------------------------------------------------------------------------------------
export type PillTone = 'good' | 'waiting' | 'bad' | 'plain';

export function Pill({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: PillTone;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]} testID={testID}>
      <Text style={[styles.pillLabel, styles[`pillLabel_${tone}`]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

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
): { label: string; tone: PillTone } {
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

// --------------------------------------------------------------------------------------
// Footer action
// --------------------------------------------------------------------------------------
/** The one green action at the foot of a store screen. */
export function StoreAction({
  label,
  onPress,
  disabled = false,
  busy = false,
  icon,
  tone = 'primary',
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** `outline` for the quiet second action — *Find*, *Print slip*. */
  tone?: 'primary' | 'outline';
  testID?: string;
}): React.JSX.Element {
  const inert = disabled || busy;
  const outline = tone === 'outline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.action,
        outline ? styles.actionOutline : inert ? styles.actionInert : styles.actionPrimary,
        pressed && !inert && (outline ? styles.actionOutlinePressed : styles.actionPressed),
      ]}
      testID={testID}
    >
      {!!icon && (
        <Ionicons
          name={icon}
          size={18}
          color={outline ? colors.ink : inert ? colors.textDisabled : colors.surface}
        />
      )}
      <Text
        style={[
          styles.actionLabel,
          outline && styles.actionLabelOutline,
          inert && !outline && styles.actionLabelInert,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const storeStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[4], paddingBottom: spacing[5] },
  footer: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  cardTitle: { ...typography.h3, color: colors.ink },
  cardMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroDone: { backgroundColor: colors.primaryDark },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    marginBottom: spacing[3],
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginLeft: 'auto' },
  eyebrow: { ...typography.label, color: colors.surface, opacity: 0.8 },
  storePill: {
    maxWidth: 180,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  storePillLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  doneRow: { alignItems: 'center', marginBottom: spacing[3] },
  doneDisc: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.display, color: colors.surface },
  subtitle: { ...typography.body, color: colors.surface, opacity: 0.72, marginTop: spacing[1] },
  subtitleDone: { ...typography.label, opacity: 0.85 },
  centred: { textAlign: 'center' },

  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pill_plain: { backgroundColor: colors.background },
  pill_good: { backgroundColor: colors.primaryWash },
  pill_waiting: { backgroundColor: colors.secondaryWash },
  pill_bad: { backgroundColor: colors.errorWash },
  pillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  pillLabel_plain: { color: colors.textMuted },
  pillLabel_good: { color: colors.primaryDark },
  pillLabel_waiting: { color: yolk[800] },
  pillLabel_bad: { color: colors.error },

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

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 54,
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionPressed: { backgroundColor: colors.primaryPressed },
  actionInert: { backgroundColor: colors.disabledFill },
  actionOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: MIN_TOUCH_TARGET + 6,
  },
  actionOutlinePressed: { backgroundColor: colors.background },
  actionLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  actionLabelOutline: { color: colors.ink },
  actionLabelInert: { color: colors.textDisabled },
});
