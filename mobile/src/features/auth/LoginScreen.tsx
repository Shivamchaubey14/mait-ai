/**
 * Mait login (SRS §6.8.2, §9.1).
 *
 * Two steps: a mobile number, then the OTP sent to it. There is no password — a field phone
 * gets shared, lost and handed around, so OTP is the only route in. The screen says so
 * plainly rather than leaving the user hunting for a password field that does not exist.
 *
 * The server answers identically whether or not a number is registered, so this screen
 * advances to the OTP step either way. Saying "no such number" here would undo that and let
 * anyone map the field workforce.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useLazyGetCurrentUserQuery,
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
} from '@api/endpoints';
import { Banner } from '@/components';
import { BrandMark, CapabilityChips, HeroDecoration, LanguageToggle } from '@/components/brand';
import { OTP_EXPIRY_SECONDS, OTP_LENGTH } from '@/config/env';
import { useAppDispatch } from '@/store';
import { colors, green, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { loggedIn } from './authSlice';

type Step = 'mobile' | 'otp';

/** Groups the ten digits as 5+5, which is how the number is read aloud and printed on a SIM. */
function formatMobile(digits: string): string {
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

// --------------------------------------------------------------------------------------
// Hero
// --------------------------------------------------------------------------------------
function Hero(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.hero}>
      <HeroDecoration size={240} top={-100} right={-80} />
      <SafeAreaView edges={['top']}>
        <View style={styles.heroTop}>
          <BrandMark size="small" />
          <LanguageToggle />
        </View>

        <Text style={styles.heroTitle}>
          {t('auth.welcomeBack')}
          {'\n'}
          {t('auth.welcomeRole')}
        </Text>
        <Text style={styles.heroSubtitle}>{t('auth.heroSubtitle')}</Text>

        <CapabilityChips style={styles.heroChips} />
      </SafeAreaView>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Notice rows
// --------------------------------------------------------------------------------------
function Notice({
  tone,
  title,
  body,
}: {
  tone: 'warning' | 'success' | 'info';
  title: string;
  body: string;
}): React.JSX.Element {
  const swatch = {
    warning: colors.secondary,
    success: green[100],
    info: '#D8E7FA',
  }[tone];

  return (
    <View style={[styles.notice, tone === 'warning' && styles.noticeWarning]}>
      <View style={[styles.noticeSwatch, { backgroundColor: swatch }]} />
      <View style={styles.noticeBody}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.noticeText}>{body}</Text>
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
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

  // Counts down so the Mait can see whether the code is still worth typing, rather than
  // finding out only after submitting it.
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

      // Fetched before the session is marked live: it carries the assigned MPP codes that
      // scope everything, so this order avoids an empty first screen on every login.
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
      // and would stop matching the moment the app runs in Hindi.
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

  const onMobile = step === 'mobile';
  const canSubmit = onMobile ? isValidMobile : otp.length === OTP_LENGTH;
  const busy = onMobile ? sendState.isLoading : verifyState.isLoading;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Hero />

          <View style={styles.sheet}>
            <Text style={styles.title}>{t('auth.signIn')}</Text>
            <Text style={styles.subtitle}>
              {onMobile ? t('auth.enterMobileToContinue') : t('auth.otpSent', { mobile: mobileNo })}
            </Text>

            {!!error && <Banner message={error} testID="login-error" />}

            {onMobile ? (
              <>
                <Text style={styles.label}>{t('auth.mobileNumber')}</Text>
                <View style={styles.phoneField}>
                  <Text style={styles.prefix}>+91</Text>
                  <View style={styles.prefixDivider} />
                  <TextInput
                    style={styles.phoneInput}
                    value={formatMobile(mobileNo)}
                    onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
                    placeholder={t('auth.mobilePlaceholder')}
                    placeholderTextColor={colors.textDisabled}
                    keyboardType="number-pad"
                    textContentType="telephoneNumber"
                    maxLength={11} // ten digits plus the grouping space
                    autoFocus
                    accessibilityLabel={t('auth.mobileNumber')}
                    testID="login-mobile"
                  />
                </View>
                <Text style={styles.helper}>{t('auth.otpHelper')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>{t('auth.enterOtp')}</Text>
                <View style={styles.phoneField}>
                  <TextInput
                    style={[styles.phoneInput, styles.otpInput]}
                    value={otp}
                    onChangeText={text => setOtp(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                    keyboardType="number-pad"
                    maxLength={OTP_LENGTH}
                    autoFocus
                    accessibilityLabel={t('auth.enterOtp')}
                    testID="login-otp"
                  />
                </View>
                <Text style={styles.helper}>
                  {secondsLeft > 0
                    ? t('auth.resendIn', { seconds: secondsLeft })
                    : t('auth.otpHelper')}
                </Text>
              </>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit || busy, busy }}
              onPress={onMobile ? handleSend : handleVerify}
              disabled={!canSubmit || busy}
              style={({ pressed }) => [
                styles.cta,
                !canSubmit || busy ? styles.ctaDisabled : styles.ctaEnabled,
                pressed && canSubmit && !busy && styles.ctaPressed,
              ]}
              testID={onMobile ? 'login-send-otp' : 'login-verify'}
            >
              <Text style={[styles.ctaLabel, (!canSubmit || busy) && styles.ctaLabelDisabled]}>
                {onMobile ? t('auth.sendOtp') : t('common.next')}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={!canSubmit || busy ? colors.textDisabled : colors.surface}
              />
            </Pressable>

            {!onMobile && (
              <View style={styles.secondaryRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSend}
                  disabled={secondsLeft > 0 || sendState.isLoading}
                  style={styles.linkButton}
                  testID="login-resend"
                >
                  <Text style={[styles.link, secondsLeft > 0 && styles.linkDisabled]}>
                    {t('auth.sendOtp')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setStep('mobile');
                    setError(null);
                  }}
                  style={styles.linkButton}
                  testID="login-back"
                >
                  <Text style={styles.link}>{t('common.back')}</Text>
                </Pressable>
              </View>
            )}

            <Notice
              tone="warning"
              title={t('auth.noPasswordTitle')}
              body={t('auth.noPasswordBody')}
            />
            <Notice
              tone="success"
              title={t('auth.registeredOnlyTitle')}
              body={t('auth.registeredOnlyBody')}
            />
            <Notice
              tone="info"
              title={t('auth.numberNotWorkingTitle')}
              body={t('auth.numberNotWorkingBody')}
            />

            <View style={styles.legal}>
              <Text style={styles.legalText}>{t('auth.legalPrefix')}</Text>
              <Text style={styles.legalText}>
                <Text style={styles.legalLink}>{t('auth.termsOfService')}</Text>
                {` ${t('auth.and')} `}
                <Text style={styles.legalLink}>{t('auth.privacyPolicy')}</Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: spacing[6] },

  hero: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[3],
    marginBottom: spacing[5],
  },
  heroTitle: { ...typography.h1, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.92,
    marginTop: spacing[2],
  },
  heroChips: { marginTop: spacing[5] },

  sheet: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },
  title: { ...typography.h1, color: colors.ink },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing[1] },
  label: {
    ...typography.label,
    color: colors.text,
    marginTop: spacing[5],
    marginBottom: spacing[2],
  },

  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
  },
  // The prefix and the digits use the heading face so the number block reads as data
  // rather than prose.
  prefix: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.ink },
  prefixDivider: {
    width: 1,
    height: 22,
    backgroundColor: colors.border,
    marginHorizontal: spacing[3],
  },
  phoneInput: {
    flex: 1,
    ...typography.h3,
    fontFamily: typography.h2.fontFamily,
    color: colors.ink,
    letterSpacing: 0.5,
    paddingVertical: spacing[2],
  },
  otpInput: { letterSpacing: 6, textAlign: 'center' },

  helper: { ...typography.caption, color: colors.textMuted, marginTop: spacing[2] },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 6,
    borderRadius: radius.md,
    marginTop: spacing[5],
  },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
  ctaLabelDisabled: { color: colors.textDisabled },

  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[3],
  },
  linkButton: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 2 },
  link: { ...typography.bodyStrong, color: colors.primaryDark },
  linkDisabled: { color: colors.textDisabled },

  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
    marginTop: spacing[4],
  },
  // Only the first notice gets the yellow wash and border; the others are plain rows, so the
  // eye lands on the one that changes how signing in works.
  noticeWarning: {
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: radius.md,
    padding: spacing[3],
  },
  noticeSwatch: { width: 26, height: 26, borderRadius: 8 },
  noticeBody: { flex: 1 },
  noticeTitle: { ...typography.bodyStrong, color: colors.ink },
  noticeText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  legal: { marginTop: spacing[6], alignItems: 'center', gap: 2 },
  legalText: { ...typography.caption, color: ink[300], textAlign: 'center' },
  legalLink: { color: colors.primaryDark },
});
