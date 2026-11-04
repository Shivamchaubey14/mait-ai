/**
 * Admin password reset (W1a) — the portal's `forgot-password.html` on a handset.
 *
 * Three steps on one screen, as the portal has them: ask for a one-time code by username; type
 * the code and a new password; done. The code is sent to the number already on the account —
 * this screen never asks for a number — so a reset cannot be aimed at a phone the account holder
 * does not hold. Field staff never come here: they sign in with an OTP and have no password.
 *
 * The request step answers the same way whether or not the username is real, by design on the
 * server, so account names cannot be probed. This screen therefore moves to the code step on any
 * username, and it is the code that tells a real account from an invented one — by arriving.
 */

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { usePasswordResetRequestMutation, usePasswordResetVerifyMutation } from '@api/endpoints';
import { colors, typography } from '@theme/tokens';

import {
  AuthFrame,
  ErrorAlert,
  Field,
  Submit,
  TextLink,
  Title,
  authStyles,
  problemOf,
  statusOf,
} from './adminAuth';

type Step = 'request' | 'verify' | 'done';

/** The same bar the server and the account screens hold a password to. */
export const MIN_PASSWORD = 10;

export default function AdminPasswordResetScreen({
  initialUsername = '',
  onBack,
  onDone,
}: {
  initialUsername?: string;
  onBack: () => void;
  /** Back to sign-in with the username the password was reset for. */
  onDone: (username: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const otpRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>('request');
  const [username, setUsername] = useState(initialUsername);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [minutes, setMinutes] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const [request, requesting] = usePasswordResetRequestMutation();
  const [verify, verifying] = usePasswordResetVerifyMutation();

  const failed = (err: unknown, fallback: string) => {
    const status = statusOf(err);
    setError(
      status === 429
        ? t('errors.tooManyRequests')
        : status === 'FETCH_ERROR' || status === undefined
          ? t('auth.officeAskOffline')
          : problemOf(err, fallback),
    );
  };

  const sendCode = async () => {
    setError(null);
    const name = username.trim();
    if (!name) {
      setError(t('auth.reset.enterUsername'));
      return;
    }
    try {
      const sent = await request({ username: name }).unwrap();
      setMinutes(Math.max(1, Math.round((sent.expires_in_seconds || 300) / 60)));
      setOtp('');
      setStep('verify');
      setTimeout(() => otpRef.current?.focus(), 50);
    } catch (err) {
      failed(err, t('errors.generic'));
    }
  };

  const reset = async () => {
    setError(null);
    const code = otp.trim();
    if (!code) {
      setError(t('auth.reset.enterCode'));
      otpRef.current?.focus();
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(t('auth.reset.tooShort', { n: MIN_PASSWORD }));
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      setError(t('auth.reset.mismatch'));
      setConfirm('');
      confirmRef.current?.focus();
      return;
    }
    try {
      await verify({ username: username.trim(), otp: code, new_password: password }).unwrap();
      setPassword('');
      setConfirm('');
      setStep('done');
    } catch (err) {
      // A wrong or expired code, or a password the server refused — in its own words.
      failed(err, t('auth.reset.failed'));
      otpRef.current?.focus();
    }
  };

  const back = () => {
    if (step === 'verify') {
      setError(null);
      setStep('request');
      return;
    }
    onBack();
  };

  return (
    <AuthFrame
      headline={t('auth.reset.headline')}
      note={t('auth.reset.note')}
      onBack={back}
      testID="admin-reset"
    >
      <ErrorAlert message={error} testID="admin-reset-error" />

      {step === 'request' && (
        <View testID="admin-reset-request">
          <Title title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} />
          <Field
            label={t('auth.admin.username')}
            value={username}
            onChangeText={setUsername}
            textContentType="username"
            autoComplete="username"
            returnKeyType="send"
            onSubmitEditing={sendCode}
            testID="admin-reset-username"
          />
          <Submit
            label={t('auth.reset.sendCode')}
            busyLabel={t('auth.reset.sending')}
            busy={requesting.isLoading}
            onPress={sendCode}
            testID="admin-reset-send"
          />
        </View>
      )}

      {step === 'verify' && (
        <View testID="admin-reset-verify">
          <Title title={t('auth.reset.codeTitle')} />
          {/* A read-back of where the code went, so they know which phone to pick up. */}
          <AppText style={authStyles.sent} testID="admin-reset-sent">
            {t('auth.reset.sent', { minutes })}
          </AppText>
          <Field
            ref={otpRef}
            label={t('auth.reset.code')}
            value={otp}
            onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={8}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            testID="admin-reset-code"
          />
          <Field
            ref={passwordRef}
            label={t('auth.reset.newPassword')}
            aside={
              // Confirm follows it, so the two are compared in the open or not at all.
              <TextLink
                label={t(show ? 'auth.admin.hide' : 'auth.admin.show')}
                accessibilityLabel={t(show ? 'auth.admin.hidePassword' : 'auth.admin.showPassword')}
                onPress={() => setShow(s => !s)}
                testID="admin-reset-toggle"
              />
            }
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            testID="admin-reset-password"
          />
          <Field
            ref={confirmRef}
            label={t('auth.reset.confirm')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!show}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={reset}
            testID="admin-reset-confirm"
          />
          <AppText style={styles.hint}>{t('auth.reset.rule', { n: MIN_PASSWORD })}</AppText>
          <Submit
            label={t('auth.reset.reset')}
            busyLabel={t('auth.reset.resetting')}
            busy={verifying.isLoading}
            onPress={reset}
            testID="admin-reset-submit"
          />
          <View style={authStyles.center}>
            <TextLink
              label={t('auth.reset.differentUser')}
              onPress={() => {
                setError(null);
                setStep('request');
              }}
              testID="admin-reset-different"
            />
          </View>
        </View>
      )}

      {step === 'done' && (
        <View testID="admin-reset-done">
          <Title title={t('auth.reset.doneTitle')} subtitle={t('auth.reset.doneBody')} />
          <Submit
            label={t('auth.reset.goToSignIn')}
            onPress={() => onDone(username.trim())}
            testID="admin-reset-signin"
          />
        </View>
      )}

      {step !== 'done' && (
        <View style={authStyles.returnRow}>
          <AppText style={authStyles.returnText}>{t('auth.reset.remembered')}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            hitSlop={8}
            testID="admin-reset-back"
          >
            <AppText style={styles.returnLink}>{t('auth.reset.backToSignIn')}</AppText>
          </Pressable>
        </View>
      )}
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textMuted, marginTop: -8, marginBottom: 8 },
  returnLink: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.primary,
  },
});
