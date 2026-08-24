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
 * postponed to a day nobody comes. Never offered after a refusal: the owner has just said no
 * to a hand on the animal, and asking to inseminate her is not the next thing to say.
 *
 * **What is owed, and by whom.** This is where the amount is acted on: a member's comes out
 * of her milk payment and there is nothing to do in the yard, a non-member's is cash to be
 * collected before anybody leaves. Opposite instructions, so the screen gives one of them
 * rather than a number and a shrug. A refused visit is not billed and says so.
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
import { settlementFor } from './charge';
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
    {
      pregnant: 'pd.pregnant',
      not_pregnant: 'pd.notPregnant',
      unsure: 'pd.unsure',
      declined: 'pd.declined',
    }[outcome] ?? 'pd.unsure',
  );

  const declined = outcome === 'declined';

  // The one place a Mait acts on the money, so it is a card rather than a line: collect it,
  // or tell her it comes off her payment. `charge.ts` decides which — the same function the
  // record screen quoted from, so the figure named before the visit and the figure named
  // after it are one figure.
  const settlement = settlementFor(check, outcome);
  const settlementCopy = {
    member: {
      title: t('pd.doneChargeMemberTitle', {
        amount: settlement.kind === 'member' ? settlement.amount : 0,
      }),
      body: t('pd.doneChargeMemberBody'),
      icon: 'receipt-outline' as const,
    },
    nonMember: {
      title: t('pd.doneChargeNonMemberTitle', {
        amount: settlement.kind === 'nonMember' ? settlement.amount : 0,
      }),
      body: t('pd.doneChargeNonMemberBody'),
      icon: 'cash-outline' as const,
    },
    unpriced: {
      title: t('pd.doneChargeUnpricedTitle'),
      body: t('pd.doneChargeUnpricedBody'),
      icon: 'help-circle-outline' as const,
    },
    none: {
      title: t('pd.doneChargeNoneTitle'),
      body: t('pd.doneChargeNoneBody'),
      icon: 'remove-circle-outline' as const,
    },
  }[settlement.kind];

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

        {/* Money first among the things left to do. A Mait putting the phone away with cash
            uncollected is the failure this card exists to prevent, and it is only ever one
            tap from the end of the visit. */}
        <View
          style={[styles.settlement, settlement.kind === 'nonMember' && styles.settlementCollect]}
          testID="pd-settlement"
        >
          <View style={styles.settlementIcon}>
            <Ionicons
              name={settlementCopy.icon}
              size={20}
              color={settlement.kind === 'nonMember' ? colors.primaryDark : colors.textMuted}
            />
          </View>
          <View style={styles.statusBody}>
            <Text style={styles.settlementTitle}>{settlementCopy.title}</Text>
            <Text style={styles.settlementBody}>{settlementCopy.body}</Text>
          </View>
        </View>

        {/* A refusal leaves nothing to decide, so the screen says so instead of leaving the
            Mait looking for the action they are used to seeing here. The reassurance is the
            point: the row is closed, the walk counted, and the animal is not lost. */}
        {declined && (
          <View style={styles.aside} testID="pd-done-declined">
            <Text style={styles.againTitle}>{t('pd.doneDeclinedTitle')}</Text>
            <Text style={styles.againBody}>{t('pd.doneDeclinedBody')}</Text>
          </View>
        )}

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

  // Quiet by default and green only when there is cash to take. A member's line is a
  // statement about what the dairy will do later; a non-member's is an instruction for the
  // next thirty seconds, and only that one earns the colour.
  settlement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settlementCollect: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  settlementIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  settlementTitle: { ...typography.h3, color: colors.ink },
  settlementBody: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  again: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  // The same card without the green. Nothing here is an opportunity to act on — it is the
  // screen confirming there is nothing left to do — and green would read as one.
  aside: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
