/**
 * Mait login (SRS §6.8.2, §9.1).
 *
 * Two steps: enter a mobile number, then the OTP sent to it. There is no password — a field
 * phone gets shared, lost and handed around, so OTP is the only route in.
 *
 * The server deliberately answers identically whether or not a number is registered, so
 * this screen advances to the OTP step either way. Telling the user "no such number" here
 * would undo that and let anyone map the field workforce.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { errorCodeOf, ErrorCode } from '@api/client';
import {
  useLazyGetCurrentUserQuery,
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
} from '@api/endpoints';
import { Banner, Button, Screen, TextField } from '@/components';
import { OTP_EXPIRY_SECONDS, OTP_LENGTH } from '@/config/env';
import { useAppDispatch } from '@/store';
import { colors, spacing, typography } from '@theme/tokens';

import { loggedIn } from './authSlice';

type Step = 'mobile' | 'otp';

export default function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const [step, setStep] = useState<Step>('mobile');
  const [mobileNo, setMobileNo] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [sendOtp, sendState] = useSendLoginOtpMutation();
  const [verifyOtp, verifyState] = useVerifyLoginOtpMutation();
  const [fetchCurrentUser] = useLazyGetCurrentUserQuery();

  // Counts the OTP down so the Mait can see whether it is still worth typing, rather than
  // discovering it expired only after submitting.
  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }
    const timer = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);

  const handleSend = useCallback(async () => {
    setError(null);
    try {
      await sendOtp(mobileNo).unwrap();
      setStep('otp');
      setOtp('');
      setSecondsLeft(OTP_EXPIRY_SECONDS);
    } catch {
      setError(t('errors.generic'));
    }
  }, [mobileNo, sendOtp, t]);

  const handleVerify = useCallback(async () => {
    setError(null);
    try {
      const tokens = await verifyOtp({ mobileNo, otp }).unwrap();

      // Fetch the profile before marking the session live. It carries the assigned MPP
      // codes, which scope everything the app will show — landing on a screen that has to
      // ask for them separately means a visible empty state on every login.
      const user = await fetchCurrentUser().unwrap();

      dispatch(
        loggedIn({
          access: tokens.access,
          refresh: tokens.refresh,
          user: {
            id: user.id,
            fullName: user.full_name,
            role: user.role,
            mobileNo: user.mobile_no,
            maitId: user.mait_id,
          },
          assignedMppCodes: user.assigned_mpp_codes,
        }),
      );
    } catch (err) {
      // Branch on the machine-readable code, never the message — the message is translated
      // and would stop matching the moment the app is switched to Hindi.
      switch (errorCodeOf(err)) {
        case ErrorCode.OTP_EXPIRED:
          setError(t('errors.otpExpired'));
          setSecondsLeft(0);
          break;
        case ErrorCode.OTP_ATTEMPTS_EXCEEDED:
          setError(t('auth.tooManyAttempts'));
          setSecondsLeft(0);
          break;
        case ErrorCode.OTP_INVALID:
          setError(t('errors.otpIncorrect'));
          break;
        default:
          setError(t('errors.generic'));
      }
    }
  }, [dispatch, fetchCurrentUser, mobileNo, otp, t, verifyOtp]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.flex} keyboardShouldPersistTaps="handled">
        <Screen style={styles.centered}>
          <View style={styles.header}>
            <Text style={styles.title}>Mait AI</Text>
          </View>

          {!!error && <Banner message={error} testID="login-error" />}

          {step === 'mobile' ? (
            <>
              <TextField
                label={t('auth.mobileNumber')}
                value={mobileNo}
                onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
                keyboardType="number-pad"
                textContentType="telephoneNumber"
                maxLength={10}
                autoFocus
                testID="login-mobile"
              />
              <Button
                label={t('auth.sendOtp')}
                onPress={handleSend}
                disabled={!isValidMobile}
                loading={sendState.isLoading}
                testID="login-send-otp"
              />
            </>
          ) : (
            <>
              <Text style={styles.sentTo}>{t('auth.otpSent', { mobile: mobileNo })}</Text>
              <TextField
                label={t('auth.enterOtp')}
                value={otp}
                onChangeText={text => setOtp(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                autoFocus
                testID="login-otp"
              />
              <Button
                label={t('common.next')}
                variant="accent"
                onPress={handleVerify}
                disabled={otp.length !== OTP_LENGTH}
                loading={verifyState.isLoading}
                testID="login-verify"
              />
              <View style={styles.resendRow}>
                <Button
                  label={
                    secondsLeft > 0
                      ? t('auth.resendIn', { seconds: secondsLeft })
                      : t('auth.sendOtp')
                  }
                  variant="ghost"
                  onPress={handleSend}
                  disabled={secondsLeft > 0 || sendState.isLoading}
                  testID="login-resend"
                />
              </View>
              <Button
                label={t('common.back')}
                variant="ghost"
                onPress={() => {
                  setStep('mobile');
                  setError(null);
                }}
                testID="login-back"
              />
            </>
          )}
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flexGrow: 1 },
  centered: { justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: spacing[6] },
  title: { ...typography.display, color: colors.primaryDark },
  sentTo: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  resendRow: { marginTop: spacing[3], marginBottom: spacing[2] },
});
