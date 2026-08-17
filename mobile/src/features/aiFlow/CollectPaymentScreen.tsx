/**
 * How a non-member is paying (SRS §6.5, C10b).
 *
 * The only moment in this product where money moves between two people with nobody watching:
 * a farmer who is not a member has no milk payout to deduct from, so she hands cash to a Mait
 * in her own yard. Everything after this screen exists to leave a trace of that.
 *
 * Cash leads, and is chosen by default. It is what actually happens in a village, and UPI
 * cannot happen at all without a signal — which the screen says outright rather than letting
 * a Mait pick it, wait, and discover it.
 *
 * The amount is the server's, priced by the administrator against the breed used. A
 * non-member's rate is its own: she is not settling against a payout the dairy already owes.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import type { AIEvent } from '@api/types';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, OptionCard } from './components';

export type PaymentMode = 'COD' | 'ONLINE';

interface Props {
  event: AIEvent;
  farmerName: string;
  /** False when the handset has no connection: UPI cannot be started, and cash is the answer. */
  online: boolean;
  busy?: boolean;
  /** The server's reason for refusing, shown as it was written. */
  failed?: string | null;
  onContinue: (mode: PaymentMode) => void;
  onBack: () => void;
}

export default function CollectPaymentScreen({
  event,
  farmerName,
  online,
  busy = false,
  failed = null,
  onContinue,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PaymentMode>('COD');

  const chosen = !online ? 'COD' : mode;

  return (
    <FlowScreen
      step={null}
      eyebrow={t('payment.eyebrow')}
      title={t('payment.howIsShePaying')}
      subtitle={t('payment.howIsShePayingSubtitle')}
      onBack={onBack}
      tabBarBelow
      cta={{
        label: t('common.continue'),
        onPress: () => onContinue(chosen),
        busy,
        testID: 'payment-continue',
      }}
    >
      <View style={styles.amountCard}>
        <Text style={styles.amountLabel}>{t('payment.toCollectFrom', { name: farmerName })}</Text>
        <Text style={styles.amount}>
          {event.amount_due ? `₹ ${Math.round(Number(event.amount_due))}` : t('payment.unpriced')}
        </Text>
      </View>

      <OptionCard
        title={t('payment.cash')}
        subtitle={t('payment.cashBody')}
        icon="cash-outline"
        check
        selected={chosen === 'COD'}
        onPress={() => setMode('COD')}
        testID="payment-mode-COD"
      />

      <OptionCard
        title={t('payment.upi')}
        subtitle={t('payment.upiBody')}
        icon="phone-portrait-outline"
        tone="neutral"
        check
        selected={chosen === 'ONLINE'}
        blockedReason={online ? undefined : t('payment.upiNeedsSignal')}
        onPress={() => setMode('ONLINE')}
        testID="payment-mode-ONLINE"
      />

      {/* Said before the choice, not after it: a Mait who picks UPI in a village with no bars
          finds out by waiting, and the farmer is standing there while they do. */}
      {!online && (
        <View style={styles.offline} testID="payment-offline">
          <Ionicons name="cloud-offline-outline" size={18} color={colors.textMuted} />
          <Text style={styles.offlineText}>{t('payment.offlineTakeCash')}</Text>
        </View>
      )}

      {/* Said before the button is tapped, not after it fails. A rate nobody has entered is
          an administrator's gap, and the Mait can do nothing about it in the yard except
          know that it is not their fault. */}
      {!event.amount_due && (
        <FlowNotice
          tone="accent"
          title={t('payment.unpricedTitle')}
          body={t('payment.unpricedBody')}
          testID="payment-unpriced"
        />
      )}

      {!!failed && <FlowNotice tone="error" title={failed} testID="payment-error" />}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  amountCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  amountLabel: { ...typography.label, color: colors.textMuted },
  amount: { ...typography.display, color: colors.ink, marginTop: spacing[2] },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[2],
  },
  offlineText: { ...typography.caption, color: colors.textMuted, flex: 1 },
});
