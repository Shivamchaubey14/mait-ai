/**
 * The frame the deskless shells wear.
 *
 * Three apps sign in on one screen — a Mait's, a store keeper's, a zonal manager's — and all
 * three are the same product seen from a different job. So they wear the same frame: the Ink
 * hero welded to the top with its bottom corners rounded, white cards outlined on the grey
 * page, one green action at the foot, and one pill vocabulary for the state of a row.
 *
 * These pieces began as the store keeper's own (`features/store/parts.tsx`) and moved here
 * the day a second shell needed them. That is the rule this file exists to serve: the first
 * caller owns a component, the second one moves it. What stayed behind in `store/parts` is
 * genuinely the keeper's — the straw stepper, the flask toggle, the readiness word — and what
 * came here is the frame, which belongs to nobody in particular.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { fitTitleSize } from '@/components/hero';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

/** An item as the person reads it, in the language the app is in. */
export function itemLabel(
  item: { item_name: string; item_name_hi: string },
  language: string,
): string {
  return (language.startsWith('hi') && item.item_name_hi) || item.item_name;
}

/** 24-hour and local: this is somebody matching a slip against a clock on a wall. */
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
 * The top of every screen in these shells.
 *
 * Ink for a place and a question, green for something that has just happened — the same split
 * the capture flow makes between a step and *Recorded*, so green keeps meaning "done" across
 * the whole product. The back control sits on the right, where the mockup puts it, so the
 * left edge always starts with the words.
 */
export function AppHero({
  eyebrow,
  tag,
  title,
  subtitle,
  pill,
  onBack,
  done = false,
  children,
  testID,
}: {
  eyebrow?: string;
  /**
   * In place of the eyebrow, a label that has to be read at a glance — a record's number —
   * on a solid yolk pill rather than as faint words on the Ink.
   */
  tag?: string;
  title: string;
  subtitle?: string;
  /** The store's name, or the zone's — where this person is, in the corner. */
  pill?: string;
  onBack?: () => void;
  /** Green, with the tick in place of the top row. */
  done?: boolean;
  /** Anything that belongs on the Ink under the title — the zone's week and month figures. */
  children?: React.ReactNode;
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
          {tag ? (
            <View style={styles.tag} testID={testID ? `${testID}-tag` : undefined}>
              <Text style={styles.tagLabel} numberOfLines={1}>
                {tag}
              </Text>
            </View>
          ) : (
            !!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>
          )}
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
      {children}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Pill
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

// --------------------------------------------------------------------------------------
// Footer action
// --------------------------------------------------------------------------------------
/** The one green action at the foot of a screen. */
export function FooterAction({
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
  /**
   * `outline` for the quiet second action — *Find*, *Print slip*. `danger` for the one that
   * closes something against somebody: rejecting a request, signing out. `dangerOutline` is
   * that same action set beside a green one — a button, plainly, but not a second filled
   * block competing with the answer. Never two greens.
   */
  tone?: 'primary' | 'outline' | 'danger' | 'dangerOutline';
  testID?: string;
}): React.JSX.Element {
  const inert = disabled || busy;
  const outline = tone === 'outline';
  const danger = tone === 'danger';
  const dangerOutline = tone === 'dangerOutline';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.action,
        dangerOutline
          ? [styles.actionDangerOutline, inert && styles.actionDangerOutlineInert]
          : outline
            ? styles.actionOutline
            : inert
              ? styles.actionInert
              : danger
                ? styles.actionDanger
                : styles.actionPrimary,
        pressed &&
          !inert &&
          (dangerOutline
            ? styles.actionDangerOutlinePressed
            : outline
              ? styles.actionOutlinePressed
              : danger
                ? styles.actionDangerPressed
                : styles.actionPressed),
      ]}
      testID={testID}
    >
      {!!icon && (
        <Ionicons
          name={icon}
          size={18}
          color={
            dangerOutline
              ? inert
                ? colors.textDisabled
                : colors.error
              : outline
                ? colors.ink
                : inert
                  ? colors.textDisabled
                  : colors.surface
          }
        />
      )}
      <Text
        style={[
          styles.actionLabel,
          outline && styles.actionLabelOutline,
          dangerOutline && styles.actionLabelDanger,
          inert && !outline && styles.actionLabelInert,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export const frameStyles = StyleSheet.create({
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
  tag: {
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: yolk[500],
  },
  tagLabel: { ...typography.label, color: colors.ink },
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
  // Red is reserved for the two actions that are genuinely destructive or closing — signing
  // out, and rejecting somebody's request (docs/DESIGN_SYSTEM.md, Component rules).
  actionDanger: { backgroundColor: colors.error },
  actionDangerPressed: { backgroundColor: colors.errorPressed },
  actionInert: { backgroundColor: colors.disabledFill },
  actionOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: MIN_TOUCH_TARGET + 6,
  },
  actionOutlinePressed: { backgroundColor: colors.background },
  actionDangerOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  actionDangerOutlineInert: { borderColor: colors.border },
  actionDangerOutlinePressed: { backgroundColor: colors.errorWash },
  actionLabelDanger: { color: colors.error },
  actionLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  actionLabelOutline: { color: colors.ink },
  actionLabelInert: { color: colors.textDisabled },
});
