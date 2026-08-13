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
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { AIEvent } from '@api/types';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, InfoRow } from './components';

interface Props {
  event: AIEvent;
  farmerName: string;
  animalLabel: string;
  busy?: boolean;
  failed?: boolean;
  onFinish: () => void;
}

export default function MemberNothingToCollectScreen({
  event,
  farmerName,
  animalLabel,
  busy = false,
  failed = false,
  onFinish,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <FlowScreen
      step={null}
      tone="good"
      done
      eyebrow={t('payment.eyebrow')}
      title={t('payment.nothingToCollect')}
      subtitle={t('payment.nothingToCollectSubtitle')}
      cta={{
        label: t('payment.finish'),
        onPress: onFinish,
        busy,
        testID: 'payment-finish',
      }}
    >
      {/* The amount, said once and said large: it is what she will see come off her payout,
          and a Mait who is asked "how much?" should be reading it off the screen. */}
      <View style={styles.amountCard}>
        <Text style={styles.amountLabel}>{t('payment.deductedFromMilk')}</Text>
        <Text style={styles.amount}>
          {event.amount_due ? `₹ ${Math.round(Number(event.amount_due))}` : t('payment.unpriced')}
        </Text>
        <Text style={styles.amountNote}>{t('payment.atNextPayout')}</Text>
      </View>

      <View style={styles.facts}>
        <InfoRow label={t('aiFlow.member')} value={farmerName} />
        <InfoRow label={t('payment.animal')} value={animalLabel} last />
      </View>

      {failed && (
        <FlowNotice
          tone="error"
          title={t('errors.generic')}
          body={t('aiFlow.tryAgainInAMoment')}
          testID="payment-error"
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // Pale green and outlined, not filled: this is a fact about money that has already been
  // settled, and it must not read as a button.
  amountCard: {
    alignItems: 'center',
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  amountLabel: { ...typography.label, color: colors.primaryDark },
  amount: { ...typography.display, color: colors.primaryDark, marginVertical: spacing[2] },
  amountNote: { ...typography.caption, color: colors.primaryDark, textAlign: 'center' },

  facts: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
  },
});
