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
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useLazyGetCurrentUserQuery,
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
} from '@api/endpoints';
import { BrandWordmark, LanguageToggle } from '@/components/brand';
import { Toast } from '@/components/toast';
import { OTP_EXPIRY_SECONDS, OTP_LOCK_MINUTES, OTP_MAX_ATTEMPTS } from '@/config/env';
import { useAppDispatch } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { loggedIn } from './authSlice';
import OtpVerifyScreen, { OtpFailure } from './OtpVerifyScreen';

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
  const insets = useSafeAreaInsets();

  return (
    // The status bar inset is applied as padding rather than with SafeAreaView. That
    // component derives its padding from its own measured frame, and inside a ScrollView the
    // measurement is unreliable — which is how this header ended up drawn under the clock,
    // the signal bars and the battery.
    <View style={[styles.hero, { paddingTop: insets.top + spacing[3] }]}>
      <View style={styles.heroTop}>
        <BrandWordmark size="small" />
        <LanguageToggle variant="inline" />
      </View>

      {/* The screen asks one question, so the question is the heading. "Sign in" as a title
          describes the screen to someone who already knows what it is for; this tells a
          first-time user what to do with the only field on it. */}
      <Text style={styles.heroTitle}>{t('auth.mobileQuestion')}</Text>
      <Text style={styles.heroSubtitle}>{t('auth.heroSubtitle')}</Text>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Notice rows
// --------------------------------------------------------------------------------------
/**
 * The one thing a Mait needs to know before signing in: there is no password.
 *
 * A card in the Cream Yolk wash rather than a line of small print, because it exists for the
 * user who is looking for a password field, and that user is scanning the screen rather than
 * reading it. Yolk is the accent for a notice everywhere in the product, and the text on it
 * is Ink — never the yellow itself, which fails contrast.
 */
function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <View style={styles.notice}>
      <Ionicons name={icon} size={20} color={colors.secondaryPressed} style={styles.noticeIcon} />
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
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('mobile');
  const [mobileNo, setMobileNo] = useState('');
  const [focused, setFocused] = useState(false);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [failure, setFailure] = useState<OtpFailure>(null);
  // Counted here rather than parsed out of the server's message. The message is translated,
  // and reading a number out of prose breaks the moment the wording changes.
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);

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

  // The lock countdown is advisory: the authority is server-side, where the code is dead
  // after three attempts and the endpoint is rate limited. This just stops the Mait
  // hammering a button that cannot work.
  useEffect(() => {
    if (lockedFor <= 0) {
      return;
    }
    const timer = setTimeout(() => setLockedFor(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedFor]);

  // The lock is deliberately *not* cleared when the countdown runs out. Dropping back to
  // "Sign in" would offer a code that died fifteen minutes ago; the screen keeps the locked
  // state, and its button turns into "Send a new code" instead. Pressing that clears
  // everything, because a fresh code is a fresh start.

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);

  const handleSend = useCallback(async () => {
    setError(null);
    try {
      await sendOtp(mobileNo).unwrap();
      setStep('otp');
      setOtp('');
      setSecondsLeft(OTP_EXPIRY_SECONDS);
      // A fresh code is a fresh start — the old failure and its attempt count no longer
      // describe anything true.
      setFailure(null);
      setAttemptsUsed(0);
    } catch (err) {
      // A throttled send is not a fault, and saying "something went wrong" sends the Mait
      // hunting for a problem that does not exist — they simply have to wait.
      const status = (err as { status?: number })?.status;
      setError(status === 429 ? t('errors.tooManyRequests') : t('errors.generic'));
    }
  }, [mobileNo, sendOtp, t]);

  const handleVerify = useCallback(async () => {
    setError(null);
    try {
      const tokens = await verifyOtp({ mobileNo, otp }).unwrap();

      // Fetched before the session is marked live: it carries the assigned MPP codes that
      // scope everything, so this order avoids an empty first screen on every login.
      //
      // The token is passed explicitly for exactly that reason — it is not in the store yet,
      // so there is nothing for the client to attach on its own.
      const user = await fetchCurrentUser(tokens.access).unwrap();

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
          setFailure('expired');
          setSecondsLeft(0);
          break;
        case ErrorCode.OTP_ATTEMPTS_EXCEEDED:
          setFailure('locked');
          setLockedFor(OTP_LOCK_MINUTES * 60);
          setSecondsLeft(0);
          break;
        case ErrorCode.OTP_INVALID: {
          const used = attemptsUsed + 1;
          setAttemptsUsed(used);
          // The server is the authority on being locked out; this only anticipates it so
          // the screen does not offer a retry that is already spent.
          if (used >= OTP_MAX_ATTEMPTS) {
            setFailure('locked');
            setLockedFor(OTP_LOCK_MINUTES * 60);
          } else {
            setFailure('wrong');
          }
          break;
        }
        default: {
          const status = (err as { status?: number })?.status;
          setError(status === 429 ? t('errors.tooManyRequests') : t('errors.generic'));
        }
      }
    }
  }, [attemptsUsed, dispatch, fetchCurrentUser, mobileNo, otp, t, verifyOtp]);

  const onMobile = step === 'mobile';

  if (!onMobile) {
    return (
      <OtpVerifyScreen
        mobileNo={mobileNo}
        otp={otp}
        onChangeOtp={value => {
          setOtp(value);
          // Typing is the user answering the notice, so clear it — leaving a red banner up
          // while they correct the code reads as though the correction already failed.
          if (failure === 'wrong') {
            setFailure(null);
          }
        }}
        onSubmit={handleVerify}
        onResend={handleSend}
        onEditNumber={() => {
          setStep('mobile');
          setError(null);
          setFailure(null);
          setAttemptsUsed(0);
        }}
        resendIn={secondsLeft}
        lockedFor={lockedFor}
        attemptsUsed={attemptsUsed}
        failure={failure}
        busy={verifyState.isLoading || sendState.isLoading}
        error={error}
        onDismissError={() => setError(null)}
      />
    );
  }

  const canSubmit = isValidMobile;
  const busy = sendState.isLoading;

  return (
    <View style={styles.root}>
      {/* The hero runs to the top edge, so the bar sits on Ink here rather than on the green
          the rest of the app opens with. Unmounts with this step and hands back to the
          app-wide bar on the OTP screen. */}
      <StatusBar style="light" backgroundColor={colors.ink} />

      {/* Above the hero rather than inside the form: a failed send is about the request, not
          about the number in the box below it. */}
      <Toast message={error} onDismiss={() => setError(null)} testID="login-error" />

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

          {/* Safe area on the sides and bottom: on a notched handset in landscape the
              sheet would otherwise run under the cutout, and the CTA under the home
              indicator. The hero handles the top edge itself. */}
          <View
            style={[
              styles.sheet,
              {
                paddingLeft: spacing[5] + insets.left,
                paddingRight: spacing[5] + insets.right,
                paddingBottom: spacing[6] + insets.bottom,
              },
            ]}
          >
            <Text style={styles.label}>{t('auth.mobileNumber')}</Text>
            <View style={[styles.phoneField, focused && styles.phoneFieldFocused]}>
              {/* The country code is a fixed block, not something to be typed past. Filling
                  it separates it from the ten digits that are the user's to change. */}
              <View style={styles.prefixBlock}>
                <Text style={styles.prefix}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                value={formatMobile(mobileNo)}
                onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
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

            <Notice
              icon="information-circle-outline"
              title={t('auth.noPasswordTitle')}
              body={t('auth.noPasswordBody')}
            />

            {/* The CTA sits at the bottom of the screen rather than under the field it
                submits. On a one-field form the two are the same gesture, and the thumb
                reaches the bottom edge without moving the hand. */}
            <View style={styles.spacer} />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit || busy, busy }}
              onPress={handleSend}
              disabled={!canSubmit || busy}
              style={({ pressed }) => [
                styles.cta,
                !canSubmit || busy ? styles.ctaDisabled : styles.ctaEnabled,
                pressed && canSubmit && !busy && styles.ctaPressed,
              ]}
              testID="login-send-otp"
            >
              <Text style={[styles.ctaLabel, (!canSubmit || busy) && styles.ctaLabelDisabled]}>
                {t('auth.sendOtp')}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={!canSubmit || busy ? colors.textDisabled : colors.surface}
              />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  hero: {
    backgroundColor: colors.ink,
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
    marginBottom: spacing[5],
  },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    // Muted enough to sit under the question rather than beside it, bright enough to survive
    // a dimmed screen in daylight.
    opacity: 0.72,
    marginTop: spacing[2],
  },

  sheet: { flex: 1, paddingTop: spacing[5] },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing[2],
  },

  phoneField: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: MIN_TOUCH_TARGET + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    // The prefix block is filled to the corner, so the container has to clip it back to the
    // radius or it squares off the left-hand side.
    overflow: 'hidden',
  },
  phoneFieldFocused: { borderColor: colors.primary },
  prefixBlock: {
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    backgroundColor: colors.primaryWash,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  // The prefix and the digits use the heading face so the number block reads as data
  // rather than prose.
  prefix: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.ink },
  phoneInput: {
    flex: 1,
    ...typography.h3,
    fontFamily: typography.h2.fontFamily,
    color: colors.ink,
    letterSpacing: 0.5,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },

  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
    borderRadius: radius.md,
    padding: spacing[4],
    marginTop: spacing[4],
  },
  noticeIcon: { marginTop: 1 },
  noticeBody: { flex: 1 },
  noticeTitle: { ...typography.bodyStrong, color: colors.ink },
  noticeText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  /** Holds the CTA at the bottom when the content is short, and collapses when it is not. */
  spacer: { flex: 1, minHeight: spacing[6] },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 6,
    borderRadius: radius.md,
  },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
  ctaLabelDisabled: { color: colors.textDisabled },
});
