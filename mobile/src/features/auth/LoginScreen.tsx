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
  useRequestSuperOtpMutation,
  useSendLoginOtpMutation,
  useVerifyLoginOtpMutation,
} from '@api/endpoints';
import { BrandLogo, BrandWordmark, LanguageToggle } from '@/components/brand';
import Problem, { useOnline } from '@/components/problem';
import { Toast } from '@/components/toast';
import { OTP_EXPIRY_SECONDS, OTP_LOCK_MINUTES, OTP_MAX_ATTEMPTS } from '@/config/env';
import { useAppDispatch } from '@/store';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { loggedIn } from './authSlice';
import { toAuthUser } from './liveScope';
import AdminLoginScreen from './AdminLoginScreen';
import OtpVerifyScreen, { OtpFailure } from './OtpVerifyScreen';

type Step = 'mobile' | 'otp';

/** Groups the ten digits as 5+5, which is how the number is read aloud and printed on a SIM. */
function formatMobile(digits: string): string {
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * The three steps of signing in, each in its colour: blue the number (a fact), yolk the code
 * on its way (waiting), green signed in (done).
 */
const STEPS = [
  {
    key: 'stepNumber',
    icon: 'call',
    solid: colors.info,
    on: colors.surface,
    word: colors.info,
    wash: colors.infoWash,
    edge: colors.info,
  },
  {
    key: 'stepCode',
    icon: 'chatbubble-ellipses',
    solid: yolk[500],
    on: colors.ink,
    word: yolk[800],
    wash: colors.secondaryWash,
    edge: yolk[300],
  },
  {
    key: 'stepIn',
    icon: 'checkmark-done',
    solid: colors.primary,
    on: colors.surface,
    word: colors.primaryDark,
    wash: colors.primaryWash,
    edge: green[300],
  },
] as const;

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
        {/* Small and beside the name here, rather than over it: this screen's job is the
            question below, and a badge big enough to admire would push it off the fold. */}
        <View style={styles.heroBrand}>
          <BrandLogo size={30} />
          <BrandWordmark size="small" />
        </View>
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
    <View style={styles.notice} testID="login-no-password">
      <View style={styles.noticeChip}>
        <Ionicons name={icon} size={20} color={colors.ink} />
      </View>
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
  /** The password door, for an office admin — reached by the link below the OTP button. */
  const [adminMode, setAdminMode] = useState(false);
  const [mobileNo, setMobileNo] = useState('');
  const [focused, setFocused] = useState(false);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A send that never reached the server. Shown as a card, cleared by the next attempt. */
  const [unreachable, setUnreachable] = useState(false);
  const online = useOnline();
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [failure, setFailure] = useState<OtpFailure>(null);
  // Counted here rather than parsed out of the server's message. The message is translated,
  // and reading a number out of prose breaks the moment the wording changes.
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);

  /** The office has been asked for a code; the next thing to arrive is a phone call. */
  const [askedOffice, setAskedOffice] = useState(false);
  const [requestSuperOtp, askState] = useRequestSuperOtpMutation();

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

      /**
       * A request that never reached anything gets a card, not a toast.
       *
       * RTK Query reports an unreachable server as `FETCH_ERROR` with no HTTP status, which
       * used to land on `errors.generic` — "Something went wrong. Please try again." That is
       * the least useful sentence the app can say here: signing in is the one step that
       * genuinely cannot work without a signal, and a Mait needs telling that rather than
       * being invited to try the same thing again in the same place.
       */
      const neverArrived =
        status === undefined || (err as { status?: string })?.status === 'FETCH_ERROR';
      if (neverArrived) {
        setUnreachable(true);
        return;
      }
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
          // Shared with the live refresh, so the two cannot come to disagree about what a
          // profile is — a field mapped here and forgotten there would go stale on a phone
          // that never signs out.
          user: toAuthUser(user),
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
          // The office's code spent too: offer to ask again, which clears the lock.
          setAskedOffice(false);
          setFailure('locked');
          setLockedFor(OTP_LOCK_MINUTES * 60);
          setSecondsLeft(0);
          break;
        case ErrorCode.OTP_INVALID: {
          const used = attemptsUsed + 1;
          setAttemptsUsed(used);
          // The server is the authority on being locked out; this only anticipates it so
          // the screen does not offer a retry that is already spent.
          // Not while the office's code is being typed: it has its own, larger allowance, and
          // the server says when it is spent (OTP_ATTEMPTS_EXCEEDED, below).
          if (used >= OTP_MAX_ATTEMPTS && !askedOffice) {
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
  }, [askedOffice, attemptsUsed, dispatch, fetchCurrentUser, mobileNo, otp, t, verifyOtp]);

  /**
   * Ask the office for a code, because the SMS is not coming.
   *
   * The office's code has its own attempts and its own ten minutes, so whatever the SMS path
   * had locked here is cleared: a Mait locked out of an SMS that never arrived must still be
   * able to type the code they are read. Nothing is claimed about the number — the server
   * answers the same whether or not it is registered.
   */
  const handleAskOffice = useCallback(async () => {
    setError(null);
    try {
      await requestSuperOtp({ mobileNo }).unwrap();
      setAskedOffice(true);
      setFailure(null);
      setAttemptsUsed(0);
      setLockedFor(0);
      setOtp('');
    } catch (err) {
      const status = (err as { status?: number | string })?.status;
      setError(
        status === 429
          ? t('errors.tooManyRequests')
          : status === 'FETCH_ERROR' || status === undefined
            ? t('auth.officeAskOffline')
            : t('errors.generic'),
      );
    }
  }, [mobileNo, requestSuperOtp, t]);

  // The office door is a different credential entirely (a password, not an OTP), so it is its
  // own screen rather than a third step — reached from the link below, and handing straight
  // back here on cancel.
  if (adminMode) {
    return <AdminLoginScreen onBack={() => setAdminMode(false)} />;
  }

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
          setAskedOffice(false);
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
        onAskOffice={handleAskOffice}
        askedOffice={askedOffice}
        askingOffice={askState.isLoading}
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

      {/* The one step in the app that cannot work offline, said plainly and in place, rather
          than as a toast that disappears before it has been read. */}
      {unreachable && (
        <View style={styles.problem}>
          <Problem
            kind={online ? 'server' : 'signIn'}
            onRetry={() => {
              setUnreachable(false);
              handleSend();
            }}
            busy={sendState.isLoading}
            onDismiss={() => setUnreachable(false)}
            testID="login-unreachable"
          />
        </View>
      )}

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
            {/* The whole of signing in, before it starts: three steps, the first one lit. A Mait
                signing in for the first time knows what is coming and that there is no
                password step waiting at the end of it. */}
            <View style={styles.steps} testID="login-steps">
              {STEPS.map((item, index) => (
                <View
                  key={item.key}
                  style={[styles.stepTile, { backgroundColor: item.wash, borderColor: item.edge }]}
                >
                  <View style={[styles.stepChip, { backgroundColor: item.solid }]}>
                    <Ionicons name={item.icon} size={16} color={item.on} />
                  </View>
                  <Text style={[styles.stepNumber, { color: item.word }]}>{index + 1}</Text>
                  <Text style={[styles.stepLabel, { color: item.word }]} numberOfLines={2}>
                    {t(`auth.${item.key}`)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.labelRow}>
              <View style={styles.labelChip}>
                <Ionicons name="call" size={13} color={colors.surface} />
              </View>
              <Text style={styles.label}>{t('auth.mobileNumber')}</Text>
              {/* How many of the ten are in, so a short number is seen before it is sent. */}
              <View style={[styles.count, isValidMobile && styles.countDone]}>
                <Text style={[styles.countLabel, isValidMobile && styles.countLabelDone]}>
                  {`${mobileNo.length}/10`}
                </Text>
              </View>
            </View>
            <View
              style={[
                styles.phoneField,
                focused && styles.phoneFieldFocused,
                isValidMobile && styles.phoneFieldDone,
              ]}
              testID="login-phone-field"
            >
              {/* The country code is a fixed block, not something to be typed past. Filling
                  it separates it from the ten digits that are the user's to change. */}
              <View style={[styles.prefixBlock, isValidMobile && styles.prefixBlockDone]}>
                <Ionicons name="call" size={14} color={colors.surface} />
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
              {isValidMobile && (
                <View style={styles.valid} testID="login-mobile-valid">
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                </View>
              )}
            </View>

            <Notice icon="key" title={t('auth.noPasswordTitle')} body={t('auth.noPasswordBody')} />

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
              <View style={[styles.ctaChip, (!canSubmit || busy) && styles.ctaChipDisabled]}>
                <Ionicons
                  name="paper-plane"
                  size={15}
                  color={!canSubmit || busy ? colors.textDisabled : colors.primary}
                />
              </View>
            </Pressable>

            {/* The office door. A quiet link rather than a second button: almost everyone on
                this screen is a Mait, and an admin knows to look for it. */}
            <Pressable
              accessibilityRole="button"
              onPress={() => setAdminMode(true)}
              style={styles.adminLink}
              testID="login-are-you-admin"
            >
              <Ionicons name="briefcase-outline" size={15} color={colors.info} />
              <Text style={styles.adminLinkLabel}>{t('auth.areYouAdmin')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Outside the form's own sheet, so it needs the page gutters itself.
  problem: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
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
  // The mark and the name read as one thing, so they travel as one against the toggle on the
  // far side rather than as two items sharing a row with it.
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
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

  steps: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[5] },
  stepTile: {
    flex: 1,
    padding: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  stepChip: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  stepNumber: { ...typography.caption, fontFamily: typography.h2.fontFamily },
  stepLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  labelChip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  label: { ...typography.label, color: colors.info, flex: 1 },
  count: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  countDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  countLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },
  countLabelDone: { color: colors.surface },

  // Blue while it is being filled, green once it holds a number that can be sent.
  phoneField: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: MIN_TOUCH_TARGET + 8,
    borderWidth: 1.5,
    borderColor: colors.info,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    // The prefix block is filled to the corner, so the container has to clip it back to the
    // radius or it squares off the left-hand side.
    overflow: 'hidden',
  },
  phoneFieldFocused: { borderWidth: 2 },
  phoneFieldDone: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  prefixBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.info,
  },
  prefixBlockDone: { backgroundColor: colors.primary },
  // The prefix and the digits use the heading face so the number block reads as data
  // rather than prose.
  prefix: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.surface },
  phoneInput: {
    flex: 1,
    ...typography.h3,
    fontFamily: typography.h2.fontFamily,
    color: colors.ink,
    letterSpacing: 0.5,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  valid: { justifyContent: 'center', paddingRight: spacing[3] },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: yolk[300],
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  noticeChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[500],
  },
  noticeBody: { flex: 1 },
  noticeTitle: { ...typography.bodyStrong, color: colors.ink },
  noticeText: { ...typography.caption, color: yolk[800], marginTop: 2 },

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
  ctaChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ctaChipDisabled: { backgroundColor: 'transparent' },

  adminLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[2],
  },
  adminLinkLabel: { ...typography.label, color: colors.info },
});
