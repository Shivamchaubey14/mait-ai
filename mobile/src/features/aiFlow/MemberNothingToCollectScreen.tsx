/**
 * A member owes the Mait nothing (SRS §6.5, C10a).
 *
 * **A statement, not a step.** There is no choice on this screen and there must not be one:
 * the single most valuable thing it does is stop a Mait asking a member for cash she has
 * already paid for in milk. She has no reason to refuse — she was asked, and she paid — and
 * nothing downstream would ever catch it.
 *
 * So it is green before it is read, it says *do not take money from her* in as many words, and
 * the only button on it finishes the capture.
 *
 * The figure comes from the server, priced by the administrator against the breed used. Where
 * nobody has priced it, the sentence stands without a number rather than inventing one.
 *
 * The number is what she will be charged; it is not something this app collects or settles.
 * The deduction is made by the finance department in their own software, against the milk
 * payout. Everything here is a record for them to reconcile against — which is why the screen
 * has no payment control on it at all, and why finishing needs no authorisation code.
 *
 * **In the coloured pattern, top to bottom:**
 *
 *   - *No cash* in red — the one instruction on the page, and the only thing on it that can go
 *     wrong in the yard.
 *   - *The amount* in blue, the colour every screen gives a member's deduction: a fact the dairy
 *     will settle, not something the Mait does.
 *   - *How it is settled* as three steps — recorded now (green, done), deducted by finance and
 *     shown on her slip (slate, still to come) — so "deducted from her milk" is a sequence a
 *     Mait can say out loud, not a phrase.
 *   - *Who and what* as two rows: the member in blue with her code, the animal in yolk.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import type { AIEvent } from '@api/types';
import { colors, green, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { FlowNotice, FlowScreen } from './components';

interface Props {
  event: AIEvent;
  farmerName: string;
  animalLabel: string;
  busy?: boolean;
  /** The server's reason for refusing, shown as it was written. */
  failed?: string | null;
  onFinish: () => void;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** One step of how the charge is settled: a glyph on a rail, what happens, and where. */
function SettleStep({
  icon,
  title,
  body,
  done,
  last = false,
  testID,
}: {
  icon: IoniconName;
  title: string;
  body: string;
  /** Green and ticked once it has happened; slate while it is still to come. */
  done: boolean;
  last?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.step} testID={testID}>
      <View style={styles.rail}>
        <View style={[styles.dot, done ? styles.dotDone : styles.dotLater]}>
          <Ionicons name={done ? 'checkmark' : icon} size={14} color={colors.surface} />
        </View>
        {!last && <View style={[styles.line, done && styles.lineDone]} />}
      </View>
      <View style={[styles.stepBody, done ? styles.stepBodyDone : styles.stepBodyLater]}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={[styles.stepText, { color: done ? colors.primaryDark : ink[600] }]}>
          {body}
        </Text>
      </View>
    </View>
  );
}

/** Who or what this visit was for, with its glyph on a chip of its colour. */
function FactRow({
  icon,
  tone,
  label,
  value,
  pill,
  testID,
}: {
  icon: IoniconName;
  tone: 'info' | 'warm';
  label: string;
  value: string;
  pill?: string;
  testID?: string;
}): React.JSX.Element {
  const warm = tone === 'warm';
  return (
    <View style={[styles.fact, warm ? styles.factWarm : styles.factInfo]} testID={testID}>
      <View style={[styles.chip, { backgroundColor: warm ? yolk[500] : colors.info }]}>
        <Ionicons name={icon} size={18} color={warm ? colors.ink : colors.surface} />
      </View>
      <View style={styles.factBody}>
        <Text style={[styles.factLabel, { color: warm ? yolk[800] : colors.info }]}>{label}</Text>
        <Text style={styles.factValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {!!pill && (
        <View style={[styles.factPill, { backgroundColor: warm ? yolk[500] : colors.info }]}>
          <Text style={[styles.factPillLabel, { color: warm ? colors.ink : colors.surface }]}>
            {pill}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function MemberNothingToCollectScreen({
  event,
  farmerName,
  animalLabel,
  busy = false,
  failed = null,
  onFinish,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const priced = !!event.amount_due;

  return (
    <FlowScreen
      step={null}
      tone="good"
      done
      eyebrow={t('payment.eyebrow')}
      title={t('payment.nothingToCollect')}
      subtitle={t('payment.nothingToCollectSubtitle')}
      tabBarBelow
      cta={{
        label: t('payment.finish'),
        onPress: onFinish,
        busy,
        testID: 'payment-finish',
      }}
    >
      {/* The one instruction, first and in red: a Mait who takes cash here charges her twice,
          and nothing downstream would ever catch it. */}
      <View style={styles.noCash} testID="payment-no-cash">
        <View style={styles.noCashChip}>
          <Ionicons name="cash" size={22} color={colors.surface} />
          <View style={styles.noCashSlash} />
        </View>
        <View style={styles.noCashBody}>
          <Text style={styles.noCashTitle}>{t('payment.noCashTitle')}</Text>
          <Text style={styles.noCashText}>{t('payment.noCashBody')}</Text>
        </View>
      </View>

      {/* The amount, said once and said large: it is what she will see come off her payout,
          and a Mait who is asked "how much?" should be reading it off the screen. Blue, the
          colour every screen gives a member's deduction. */}
      <View style={styles.amountCard} testID="payment-deduction">
        <View style={styles.amountHead}>
          <View style={[styles.chip, { backgroundColor: colors.info }]}>
            <Ionicons name="receipt" size={18} color={colors.surface} />
          </View>
          <Text style={styles.amountLabel}>{t('payment.deductedFromMilk')}</Text>
        </View>
        <Text style={[styles.amount, !priced && styles.amountUnpriced]}>
          {priced ? `₹ ${Math.round(Number(event.amount_due))}` : t('payment.unpriced')}
        </Text>
        <View style={styles.amountPill}>
          <Ionicons name="calendar" size={13} color={colors.surface} />
          <Text style={styles.amountPillLabel}>{t('payment.atNextPayout')}</Text>
        </View>
      </View>

      {/* Said before the button is tapped, not after it fails. A rate nobody has entered is
          an administrator's gap, and the Mait can do nothing about it in the yard except
          know that it is not their fault. */}
      {!priced && (
        <FlowNotice
          tone="accent"
          title={t('payment.unpricedTitle')}
          body={t('payment.unpricedBody')}
          testID="payment-unpriced"
        />
      )}

      {/* How "deducted from her milk" actually happens, so it is something a Mait can explain
          to her rather than a phrase to repeat. */}
      <View style={styles.sectionRow}>
        <View style={[styles.sectionChip, { backgroundColor: ink[500] }]}>
          <Ionicons name="git-commit" size={13} color={colors.surface} />
        </View>
        <Text style={styles.section}>{t('payment.howSettled')}</Text>
      </View>
      <View style={styles.settle} testID="payment-settle">
        <SettleStep
          icon="create"
          title={t('payment.settleStep1')}
          body={t('payment.settleStep1Body')}
          done
          testID="payment-settle-1"
        />
        <SettleStep
          icon="business"
          title={t('payment.settleStep2')}
          body={t('payment.settleStep2Body')}
          done={false}
          testID="payment-settle-2"
        />
        <SettleStep
          icon="document-text"
          title={t('payment.settleStep3')}
          body={t('payment.settleStep3Body')}
          done={false}
          last
          testID="payment-settle-3"
        />
      </View>

      <View style={styles.sectionRow}>
        <View style={[styles.sectionChip, { backgroundColor: colors.info }]}>
          <Ionicons name="clipboard" size={13} color={colors.surface} />
        </View>
        <Text style={styles.section}>{t('payment.thisVisit')}</Text>
      </View>
      <FactRow
        icon="people"
        tone="info"
        label={t('aiFlow.member')}
        value={farmerName}
        pill={event.member_code || undefined}
        testID="payment-member"
      />
      <FactRow
        icon="paw"
        tone="warm"
        label={t('payment.animal')}
        value={animalLabel}
        testID="payment-animal"
      />

      {!!failed && <FlowNotice tone="error" title={failed} testID="payment-error" />}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // -- no cash -----------------------------------------------------------------------------
  noCash: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  noCashChip: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  // A stroke through the cash glyph: "no cash" said as a shape, for a reader in sunlight.
  noCashSlash: {
    position: 'absolute',
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surface,
    transform: [{ rotate: '-45deg' }],
  },
  noCashBody: { flex: 1 },
  noCashTitle: { ...typography.h3, color: colors.error },
  noCashText: { ...typography.caption, color: colors.ink, marginTop: 2, lineHeight: 18 },

  // -- the amount --------------------------------------------------------------------------
  amountCard: {
    alignItems: 'center',
    padding: spacing[4],
    marginBottom: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  amountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  amountLabel: { ...typography.label, color: colors.info, flexShrink: 1 },
  amount: { ...typography.display, color: colors.ink, marginVertical: spacing[2] },
  amountUnpriced: { ...typography.h2, color: yolk[800] },
  amountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  amountPillLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // -- sections ----------------------------------------------------------------------------
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  sectionChip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { ...typography.label, color: ink[600] },

  // -- how it is settled -------------------------------------------------------------------
  settle: {
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ink[100],
    backgroundColor: ink[50],
  },
  step: { flexDirection: 'row', gap: spacing[3] },
  rail: { alignItems: 'center', width: 26 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary },
  dotLater: { backgroundColor: ink[400] },
  line: { flex: 1, width: 2, marginVertical: 2, backgroundColor: ink[200] },
  lineDone: { backgroundColor: colors.primary },
  stepBody: {
    flex: 1,
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  stepBodyDone: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  stepBodyLater: { backgroundColor: colors.surface, borderColor: ink[100] },
  stepTitle: { ...typography.bodyStrong, color: colors.ink },
  stepText: { ...typography.caption, marginTop: 2 },

  // -- who and what ------------------------------------------------------------------------
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  factInfo: { backgroundColor: colors.infoWash, borderColor: colors.info },
  factWarm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  factBody: { flex: 1 },
  factLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  factValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 1 },
  factPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  factPillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
});
