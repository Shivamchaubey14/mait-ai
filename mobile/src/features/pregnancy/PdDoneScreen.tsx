/**
 * The check is recorded. Now what?
 *
 * Three things a Mait needs at this moment, in the order they matter:
 *
 * **Where the record went.** Queued or sent, said plainly. A check done in a yard with no
 * signal is the ordinary case, and a Mait who cannot tell "saved here" from "lost" will
 * record the visit again later — which is the one thing the idempotency key exists to
 * survive, and still a wasted walk.
 *
 * **Whether to inseminate her again, now.** Only on "not pregnant", and it is the whole
 * reason this screen exists rather than dropping straight back to the list. She is not in
 * calf, she is in heat, and the Mait is standing in the yard with a flask. Making them go
 * back to Home and start a six-step capture from scratch is how a second service gets
 * postponed to a day nobody comes.
 *
 * **What is left.** The next check and where it is, so a round keeps moving without a trip
 * back to the list to find out.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import type { PdOutcome, PregnancyCheck } from '@api/types';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

export default function PdDoneScreen({
  check,
  outcome,
  queued,
  next,
  onStartAi,
  onOpenNext,
  onBackToList,
}: {
  check: PregnancyCheck;
  outcome: PdOutcome;
  /** True when it is sitting on the handset. The offline queue is the normal path here. */
  queued: boolean;
  /** The next open check this week, if there is one. */
  next: PregnancyCheck | null;
  /** Starts a capture with the farmer and animal already chosen. */
  onStartAi: () => void;
  onOpenNext: () => void;
  onBackToList: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const outcomeWord = t(
    outcome === 'pregnant'
      ? 'pd.pregnant'
      : outcome === 'not_pregnant'
        ? 'pd.notPregnant'
        : 'pd.unsure',
  );

  // Only where she is open to service. Offering it after a positive check would be offering
  // to inseminate a pregnant animal.
  const canServeAgain = outcome === 'not_pregnant';

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[6] }]}>
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={26} color={colors.surface} />
        </View>
        <Text style={styles.heroTitle}>{t('pd.doneTitle')}</Text>
        <Text style={styles.heroSubtitle} numberOfLines={2} testID="pd-done-subject">
          {t('pd.doneSubject', {
            name: check.owner_name,
            outcome: outcomeWord.toLowerCase(),
            days: check.days_since_ai ?? 0,
          })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Where the record is. Amber for queued because it is a situation and not a fault —
            the queue is what this app is built around — and green once it has gone. */}
        <View
          style={[styles.status, queued ? styles.statusQueued : styles.statusSent]}
          testID="pd-status"
        >
          <Ionicons
            name={queued ? 'time-outline' : 'cloud-done-outline'}
            size={18}
            color={queued ? colors.secondaryPressed : colors.primaryDark}
          />
          <View style={styles.statusBody}>
            <Text style={styles.statusTitle}>
              {queued ? t('pd.queuedTitle') : t('pd.sentTitle')}
            </Text>
            <Text style={styles.statusText}>{queued ? t('pd.queuedBody') : t('pd.sentBody')}</Text>
          </View>
          {queued && (
            <View style={styles.pill}>
              <Text style={styles.pillLabel}>{t('pd.queuedPill')}</Text>
            </View>
          )}
        </View>

        {canServeAgain && (
          <View style={styles.again} testID="pd-serve-again">
            <Text style={styles.againTitle}>{t('pd.againTitle')}</Text>
            <Text style={styles.againBody}>{t('pd.againBody')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onStartAi}
              style={({ pressed }) => [styles.againCta, pressed && styles.pressed]}
              testID="pd-start-ai"
            >
              <Ionicons name="add" size={19} color={colors.surface} />
              <Text style={styles.againCtaLabel} numberOfLines={1}>
                {t('pd.againCta', { name: check.owner_name })}
              </Text>
            </Pressable>
          </View>
        )}

        {next ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenNext}
            style={({ pressed }) => [styles.next, pressed && styles.pressed]}
            testID="pd-next"
          >
            <View style={styles.nextBody}>
              <Text style={styles.nextTitle}>{t('pd.nextTitle', { count: 1 })}</Text>
              <Text style={styles.nextMeta} numberOfLines={1}>
                {t('pd.nextBody', {
                  name: next.owner_name,
                  where:
                    next.mpp_code === check.mpp_code
                      ? t('pd.nextSameVillage')
                      : t('pd.nextOtherVillage', { mpp: next.mpp_name }),
                })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View style={styles.allDone} testID="pd-all-done">
            <Text style={styles.allDoneText}>{t('pd.allDone')}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          onPress={onBackToList}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          testID="pd-back-to-list"
        >
          <Text style={styles.backLabel}>{t('pd.backToList')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  pressed: { opacity: 0.85 },

  hero: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[6],
  },
  // No back arrow and no progress: the visit is recorded, and an arrow in that corner offers
  // to undo something that has already happened.
  tick: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginBottom: spacing[4],
  },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
    textAlign: 'center',
  },

  body: { padding: spacing[4] },

  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  statusQueued: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  statusSent: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  statusBody: { flex: 1 },
  statusTitle: { ...typography.bodyStrong, color: colors.ink },
  statusText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  pillLabel: { ...typography.caption, color: yolk[800] },

  again: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  againTitle: { ...typography.h3, color: colors.ink },
  againBody: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[2],
    lineHeight: 18,
  },
  againCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 52,
    marginTop: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  againCtaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface, flexShrink: 1 },

  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[4],
    marginTop: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  nextBody: { flex: 1 },
  nextTitle: { ...typography.bodyStrong, color: colors.ink },
  nextMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  allDone: {
    padding: spacing[4],
    marginTop: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  allDoneText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },

  foot: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  back: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backLabel: { ...typography.bodyStrong, color: colors.primaryDark },
});
