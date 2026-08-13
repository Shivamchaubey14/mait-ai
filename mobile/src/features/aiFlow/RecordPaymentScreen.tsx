/**
 * Proof that the money changed hands (SRS §6.5.4, C11).
 *
 * A Mait took cash in a yard. The only thing that turns that into a record anyone can stand
 * behind is a code sent to the farmer's own number and read back — so this screen exists even
 * though the insemination is already done and the cash is already in a pocket.
 *
 * **And it must work with no signal.** A code cannot be sent from a village with no bars, and
 * refusing to finish would leave a Mait holding money against an event the app will not close.
 * So the payment is recorded either way: the code is asked for when it can be, and when it
 * cannot, the capture is saved and the app asks for it once there is network. What is never
 * done is pretending a code was verified when it was not.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import type { AIEvent } from '@api/types';
import { OTP_LENGTH } from '@/config/env';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, LabelledField } from './components';

interface Props {
  event: AIEvent;
  farmerName: string;
  mode: 'COD' | 'ONLINE';
  /** Masked destination of the code, when one went out. Null when it could not be sent. */
  sentTo: string | null;
  code: string;
  onCodeChange: (next: string) => void;
  onResend: () => void;
  problem?: string | null;
  busy?: boolean;
  /** Verifies the code, or saves without it when there is no signal to send one. */
  onFinish: () => void;
  onBack: () => void;
}

export default function RecordPaymentScreen({
  event,
  farmerName,
  mode,
  sentTo,
  code,
  onCodeChange,
  onResend,
  problem,
  busy = false,
  onFinish,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const amount = event.amount_due ? `₹ ${Math.round(Number(event.amount_due))}` : '';

  return (
    <FlowScreen
      step={null}
      eyebrow={t('payment.proofEyebrow')}
      title={
        amount ? t('payment.recordWhatYouTook', { amount }) : t('payment.recordWhatYouTookPlain')
      }
      subtitle={t('payment.recordSubtitle')}
      onBack={onBack}
      cta={{
        label: sentTo ? t('payment.saveAndFinish') : t('payment.saveAndFinishOffline'),
        onPress: onFinish,
        // With a code on the way, it has to be typed. With none, there is nothing to type and
        // the button saves what there is.
        disabled: !!sentTo && code.trim().length < OTP_LENGTH,
        busy,
        testID: 'payment-save',
      }}
      link={
        sentTo
          ? { label: t('payment.trySendingAgain'), onPress: onResend, testID: 'payment-resend' }
          : undefined
      }
    >
      {/* What the Mait is confirming, in their own words, before anything about codes. */}
      <View style={styles.taken}>
        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
        <Text style={styles.takenText}>
          {mode === 'COD'
            ? t('payment.cashTakenFrom', { amount, name: farmerName })
            : t('payment.paidOnlineBy', { amount, name: farmerName })}
        </Text>
      </View>

      {!sentTo && (
        <FlowNotice
          tone="accent"
          title={t('payment.codeCannotBeSent')}
          body={t('payment.codeWillBeAskedLater')}
          icon="time-outline"
          testID="payment-code-queued"
        />
      )}

      {!!sentTo && (
        <View testID="payment-code">
          <LabelledField
            label={t('payment.authorisationCode')}
            tone="primary"
            hint={t('payment.codeSentTo', { mobile: sentTo })}
            placeholder={t('aiFlow.otpPlaceholder')}
            value={code}
            onChangeText={text => onCodeChange(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            testID="payment-code-input"
          />
        </View>
      )}

      {!!problem && <FlowNotice tone="error" title={problem} testID="payment-code-problem" />}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  taken: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.primaryWash,
    borderRadius: radius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  takenText: { ...typography.bodyStrong, color: colors.primaryDark, flex: 1 },
});
