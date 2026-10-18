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
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

/**
 * What the money card is, as a colour: blue for a member's deduction (a fact the dairy will
 * settle), yolk for cash to collect or no price set (something to do before leaving), slate
 * for a visit that is not billed.
 */
const SETTLE_PAINT = {
  member: {
    solid: colors.info,
    on: colors.surface,
    word: colors.info,
    wash: colors.infoWash,
    edge: colors.info,
  },
  nonMember: {
    solid: yolk[500],
    on: colors.ink,
    word: yolk[800],
    wash: colors.secondaryWash,
    edge: yolk[300],
  },
  unpriced: {
    solid: yolk[500],
    on: colors.ink,
    word: yolk[800],
    wash: colors.secondaryWash,
    edge: yolk[300],
  },
  none: { solid: ink[400], on: colors.surface, word: ink[600], wash: ink[50], edge: ink[100] },
} as const;

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
      icon: 'receipt' as const,
    },
    nonMember: {
      title: t('pd.doneChargeNonMemberTitle', {
        amount: settlement.kind === 'nonMember' ? settlement.amount : 0,
      }),
      body: t('pd.doneChargeNonMemberBody'),
      icon: 'cash' as const,
    },
    unpriced: {
      title: t('pd.doneChargeUnpricedTitle'),
      body: t('pd.doneChargeUnpricedBody'),
      icon: 'alert' as const,
    },
    none: {
      title: t('pd.doneChargeNoneTitle'),
      body: t('pd.doneChargeNoneBody'),
      icon: 'remove-circle' as const,
    },
  }[settlement.kind];

  // Only where she is open to service. Offering it after a positive check would be offering
  // to inseminate a pregnant animal.
  const canServeAgain = outcome === 'not_pregnant';
  const settle = SETTLE_PAINT[settlement.kind];

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
          <View style={[styles.chip, { backgroundColor: queued ? yolk[500] : colors.primary }]}>
            <Ionicons
              name={queued ? 'time' : 'cloud-done'}
              size={20}
              color={queued ? colors.ink : colors.surface}
            />
          </View>
          <View style={styles.statusBody}>
            <Text style={styles.statusTitle}>
              {queued ? t('pd.queuedTitle') : t('pd.sentTitle')}
            </Text>
            <Text style={[styles.statusText, { color: queued ? yolk[800] : colors.primaryDark }]}>
              {queued ? t('pd.queuedBody') : t('pd.sentBody')}
            </Text>
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
          style={[styles.settlement, { backgroundColor: settle.wash, borderColor: settle.edge }]}
          testID="pd-settlement"
        >
          <View style={[styles.chip, { backgroundColor: settle.solid }]}>
            <Ionicons name={settlementCopy.icon} size={20} color={settle.on} />
          </View>
          <View style={styles.statusBody}>
            <Text style={styles.settlementTitle}>{settlementCopy.title}</Text>
            <Text style={[styles.settlementBody, { color: settle.word }]}>
              {settlementCopy.body}
            </Text>
          </View>
        </View>

        {/* A refusal leaves nothing to decide, so the screen says so instead of leaving the
            Mait looking for the action they are used to seeing here. The reassurance is the
            point: the row is closed, the walk counted, and the animal is not lost. */}
        {declined && (
          <View style={styles.aside} testID="pd-done-declined">
            <View style={styles.cardHead}>
              <View style={[styles.chip, { backgroundColor: ink[500] }]}>
                <Ionicons name="hand-left" size={20} color={colors.surface} />
              </View>
              <Text style={[styles.againTitle, styles.cardTitle]}>{t('pd.doneDeclinedTitle')}</Text>
            </View>
            <Text style={[styles.againBody, { color: ink[600] }]}>{t('pd.doneDeclinedBody')}</Text>
          </View>
        )}

        {canServeAgain && (
          <View style={styles.again} testID="pd-serve-again">
            <View style={styles.cardHead}>
              <View style={[styles.chip, { backgroundColor: colors.primary }]}>
                <Glyph name={STRAW_GLYPH} size={20} color={colors.surface} />
              </View>
              <Text style={[styles.againTitle, styles.cardTitle]}>{t('pd.againTitle')}</Text>
            </View>
            <Text style={[styles.againBody, { color: colors.primaryDark }]}>
              {t('pd.againBody')}
            </Text>
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
            <View style={[styles.chip, { backgroundColor: colors.info }]}>
              <Ionicons name="navigate" size={19} color={colors.surface} />
            </View>
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
            <View style={styles.go}>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.allDone} testID="pd-all-done">
            <View style={[styles.chip, { backgroundColor: colors.primary }]}>
              <Ionicons name="checkmark-done" size={20} color={colors.surface} />
            </View>
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
          <Ionicons name="list" size={18} color={ink[600]} />
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
    backgroundColor: colors.primary,
    marginBottom: spacing[4],
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardTitle: { flex: 1 },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
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
  statusQueued: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  statusSent: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  statusBody: { flex: 1 },
  statusTitle: { ...typography.bodyStrong, color: colors.ink },
  statusText: { ...typography.caption, marginTop: 2 },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: yolk[500],
  },
  pillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },

  // In the colour of what it asks of the Mait — see SETTLE_PAINT.
  settlement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  settlementTitle: { ...typography.h3, color: colors.ink },
  settlementBody: { ...typography.caption, marginTop: 2 },

  again: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: green[300],
  },
  // Slate, not green: nothing here is an opportunity to act on — it is the screen confirming
  // there is nothing left to do — and green would read as one.
  aside: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
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

  // Blue, the colour of places: where the round goes next.
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginTop: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  nextBody: { flex: 1 },
  nextTitle: { ...typography.bodyStrong, color: colors.ink },
  nextMeta: { ...typography.caption, color: colors.info, marginTop: 2 },

  allDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginTop: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: green[300],
  },
  allDoneText: { ...typography.bodyStrong, color: colors.primaryDark, flex: 1 },

  foot: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  back: {
    flexDirection: 'row',
    gap: spacing[2],
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[200],
  },
  backLabel: { ...typography.bodyStrong, color: ink[600] },
});
