/**
 * OTP verification (SRS §6.5.1, §9.1).
 *
 * The six cells are a *display* of one real text input laid invisibly over them. Six
 * separate inputs are a well-known source of misery — paste breaks, backspace lands in the
 * wrong box, and screen readers announce six unlabelled fields. A single input keeps SMS
 * autofill, paste and assistive tech working, while the user simply types and watches the
 * cells fill.
 *
 * Layout follows what the user does, in order: the hero carries the number the code went to
 * with the way back to it, then the six cells, then the countdown, then the button at the
 * foot of the screen. The number is stated once — it used to be repeated in a card below,
 * which asked the user to read the same ten digits twice.
 *
 * Three failures are kept distinct because each needs a different action from a Mait
 * standing in a village: the code is wrong (type it again), the code is stale (fetch a new
 * one), or the attempts are gone (wait, or call the IT department).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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

import { Toast } from '@/components/toast';
import {
  IT_SUPPORT_PHONE,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
  OTP_LOCK_MINUTES,
  OTP_MAX_ATTEMPTS,
} from '@/config/env';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/** What went wrong last, which decides the notice, the cell colour and the button. */
export type OtpFailure = 'wrong' | 'expired' | 'locked' | null;

interface Props {
  mobileNo: string;
  otp: string;
  onChangeOtp: (value: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  onEditNumber: () => void;
  /** Seconds until a resend is allowed. 0 means it is available now. */
  resendIn: number;
  /** Seconds until the lock lifts. Only meaningful when failure is 'locked'. */
  lockedFor?: number;
  attemptsUsed: number;
  failure: OtpFailure;
  busy?: boolean;
  /** A request-level failure — network, throttling. Shown as a toast, not inline. */
  error?: string | null;
  onDismissError?: () => void;
}

/** `0:24`, `14:52`. The minutes are not padded — a clock does not write 00:24 either. */
function mmss(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------------------
// Digit cells
// --------------------------------------------------------------------------------------
/**
 * Rounded slots rather than circles: a square-ish cell gives the digit room to sit at a size
 * that survives sunlight and a cracked screen, and the filled ones read as a block of six at
 * a glance, which is how the code is checked against the SMS.
 */
function DigitCells({
  value,
  failure,
  focused,
}: {
  value: string;
  failure: OtpFailure;
  focused: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View
      style={styles.cellRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('auth.enterSixDigitCode')}
      accessibilityValue={{ text: value.split('').join(' ') }}
    >
      {Array.from({ length: OTP_LENGTH }).map((_, index) => {
        const digit = value[index] ?? '';
        const isNext = focused && index === value.length && !failure;
        return (
          <View
            key={index}
            style={[
              styles.cell,
              !!digit && styles.cellFilled,
              isNext && styles.cellNext,
              failure === 'wrong' && styles.cellWrong,
              failure === 'expired' && styles.cellExpired,
              failure === 'locked' && styles.cellLocked,
            ]}
          >
            {digit ? (
              <Text style={styles.cellDigit}>{digit}</Text>
            ) : (
              // A caret only in the cell about to be typed into, so the eye knows where the
              // next digit lands without a blinking animation to chase.
              isNext && <View style={styles.caret} />
            )}
          </View>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Notice
// --------------------------------------------------------------------------------------
/**
 * The three refusals, each shaped like the action it wants next.
 *
 * A wrong code is corrected in place, so it stays a line under the cells the user is still
 * typing into — a card would push those cells up the screen mid-correction. An expired code
 * and a lock both end the current attempt, so those are cards: the flow has stopped, and
 * something is being explained rather than nudged.
 */
function FailureNotice({
  failure,
  attemptsLeft,
  lockLifted = false,
}: {
  failure: Exclude<OtpFailure, null>;
  attemptsLeft: number;
  /** The lock has run out. The card stops counting a wait that is already over. */
  lockLifted?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();

  if (failure === 'wrong') {
    return (
      <View style={styles.inlineError} accessibilityRole="alert" testID="otp-notice-wrong">
        {/* A glyph as well as a colour — colour alone excludes colour-blind users, and the
            wrong/expired pair is exactly the distinction they would lose. */}
        <Ionicons name="alert-circle" size={15} color={colors.error} />
        <Text style={styles.inlineErrorText}>
          {`${t('auth.wrongCodeTitle')}. ${t('auth.wrongCodeBody', { count: attemptsLeft })}`}
        </Text>
      </View>
    );
  }

  const config =
    failure === 'expired'
      ? {
          tint: colors.secondaryPressed,
          wash: colors.secondaryWash,
          border: colors.secondary,
          icon: 'time-outline' as const,
          title: t('auth.expiredTitle'),
          body: t('auth.expiredBody', { minutes: OTP_EXPIRY_SECONDS / 60 }),
        }
      : {
          tint: colors.error,
          wash: colors.errorWash,
          border: colors.error,
          icon: 'warning-outline' as const,
          title: t('auth.lockedTitle'),
          body: lockLifted
            ? t('auth.lockedLiftedBody')
            : t('auth.lockedBody', { minutes: OTP_LOCK_MINUTES }),
        };

  return (
    <View
      style={[styles.notice, { backgroundColor: config.wash, borderColor: config.border }]}
      accessibilityRole="alert"
      testID={`otp-notice-${failure}`}
    >
      <Ionicons name={config.icon} size={20} color={config.tint} style={styles.noticeIcon} />
      <View style={styles.noticeBody}>
        <Text style={styles.noticeTitle}>{config.title}</Text>
        <Text style={styles.noticeText}>{config.body}</Text>
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function OtpVerifyScreen({
  mobileNo,
  otp,
  onChangeOtp,
  onSubmit,
  onResend,
  onEditNumber,
  resendIn,
  lockedFor = 0,
  attemptsUsed,
  failure,
  busy = false,
  error = null,
  onDismissError,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const locked = failure === 'locked';
  const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - attemptsUsed);
  const displayMobile = useMemo(
    () => (mobileNo.length === 10 ? `+91 ${mobileNo.slice(0, 5)} ${mobileNo.slice(5)}` : mobileNo),
    [mobileNo],
  );

  // The countdown is split around its own value so the seconds can carry the weight — that
  // number is the only part of the line that changes, and the only part worth looking at.
  const countdown = mmss(resendIn);
  const [beforeTime, afterTime] = useMemo(() => {
    const [head, ...rest] = t('auth.resendCodeIn', { time: countdown }).split(countdown);
    return [head, rest.join(countdown)];
  }, [countdown, t]);

  // Focus on mount so the keyboard is already up — one less tap for someone holding a
  // phone in one hand and a flask in the other.
  useEffect(() => {
    if (!locked) {
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [locked]);

  /** True once there is nothing left to verify and the only move is to fetch a fresh code. */
  const lockLifted = locked && lockedFor <= 0;
  const resendMode = failure === 'expired' || lockLifted;

  /**
   * The button changes job with the failure, because after an expiry or a lock there is
   * nothing useful left to verify — offering "Verify" there would be a dead end.
   *
   * While the lock runs it holds the countdown and does nothing: the Mait can watch the wait
   * shrink instead of pressing a button that silently refuses. The moment it reaches zero the
   * same button becomes the way out — by then the original code is long dead, so a fresh one
   * is the only thing worth offering.
   */
  const primary = (() => {
    if (locked) {
      return lockLifted
        ? { label: t('auth.sendNewCode'), action: onResend }
        : { label: t('auth.lockedCta', { time: mmss(lockedFor) }), action: undefined };
    }
    if (failure === 'expired') {
      return { label: t('auth.sendNewCode'), action: onResend };
    }
    if (failure === 'wrong') {
      return { label: t('auth.tryAgain'), action: onSubmit };
    }
    return { label: t('auth.signIn'), action: onSubmit };
  })();

  const canPress = !!primary.action && !busy && (resendMode || otp.length === OTP_LENGTH);
  const canResend = resendIn <= 0 && !busy;

  return (
    <View style={styles.root}>
      {/* The hero runs to the top edge, so the bar sits on Ink rather than on the green the
          rest of the app opens with. */}
      <StatusBar style="light" backgroundColor={colors.ink} />

      <Toast message={error} onDismiss={onDismissError} testID="otp-error" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The status bar inset is applied as padding rather than with SafeAreaView.
              SafeAreaView derives its padding from its own measured frame, and inside a
              ScrollView that measurement is unreliable — which is how the header ended up
              drawn under the clock and the battery. */}
          <View style={[styles.hero, { paddingTop: insets.top + spacing[3] }]}>
            {/* The number sits next to the way back to it. A wrong number is the most likely
                reason no code arrives, so the thing to check and the thing to press are one
                glance apart. */}
            <View style={styles.heroTop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onEditNumber}
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                testID="otp-back"
              >
                <Ionicons name="arrow-back" size={20} color={colors.surface} />
              </Pressable>
              <Text style={styles.heroNumber}>{displayMobile}</Text>
            </View>

            <Text style={styles.heroTitle}>{t('auth.verifyTitle')}</Text>
            <Text style={styles.heroSubtitle}>{t('auth.verifySubtitle')}</Text>
          </View>

          <View
            style={[
              styles.sheet,
              {
                paddingLeft: spacing[5] + insets.left,
                paddingRight: spacing[5] + insets.right,
                paddingBottom: spacing[5] + insets.bottom,
              },
            ]}
          >
            <View style={styles.cellsWrap}>
              <DigitCells value={otp} failure={failure} focused={focused} />

              {/* One real input, invisible and stretched across the cells. Typing fills
                  them directly, and because it is a genuine TextInput rather than a
                  keypress handler, SMS autofill, paste and screen readers all still work. */}
              <TextInput
                ref={inputRef}
                style={styles.hiddenInput}
                value={otp}
                onChangeText={text => onChangeOtp(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={OTP_LENGTH}
                editable={!locked}
                caretHidden
                accessibilityLabel={t('auth.enterSixDigitCode')}
                testID="login-otp"
              />
            </View>

            {/* Directly under the cells, because that is where the eye already is and where
                the correction gets typed. */}
            {failure === 'wrong' && <FailureNotice failure="wrong" attemptsLeft={attemptsLeft} />}

            {/* Hidden once the code has expired: the primary button has already become
                "Send a new code", and offering the same action twice makes the Mait wonder
                whether the two do different things. */}
            {!locked && failure !== 'expired' && (
              <View style={styles.resendRow}>
                {resendIn > 0 ? (
                  <Text style={styles.timerLabel}>
                    {beforeTime}
                    <Text style={styles.timerValue}>{countdown}</Text>
                    {afterTime}
                  </Text>
                ) : (
                  <View style={styles.flex} />
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canResend }}
                  onPress={onResend}
                  disabled={!canResend}
                  style={styles.resendButton}
                  testID="login-resend"
                >
                  <Text style={[styles.resendLabel, !canResend && styles.resendLabelDisabled]}>
                    {t('auth.resend')}
                  </Text>
                </Pressable>
              </View>
            )}

            {failure === 'expired' || failure === 'locked' ? (
              <FailureNotice
                failure={failure}
                attemptsLeft={attemptsLeft}
                lockLifted={lockLifted}
              />
            ) : failure ? null : (
              // Only while nothing has gone wrong. A Mait who has just been told their code
              // was rejected does not need a second card explaining network coverage.
              <View style={styles.help}>
                <View style={styles.helpIcon}>
                  <Ionicons name="cellular-outline" size={18} color={colors.info} />
                </View>
                <View style={styles.helpBody}>
                  <Text style={styles.noticeTitle}>{t('auth.needsSignalTitle')}</Text>
                  <Text style={styles.noticeText}>{t('auth.needsSignalBody')}</Text>
                </View>
              </View>
            )}

            {/* Drops the button to the foot of the screen. The code arrives by SMS, so the
                hand is already holding the phone at the bottom edge when it is typed. */}
            <View style={styles.spacer} />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canPress, busy }}
              onPress={primary.action}
              disabled={!canPress}
              style={({ pressed }) => [
                styles.cta,
                canPress ? styles.ctaEnabled : styles.ctaDisabled,
                pressed && canPress && styles.ctaPressed,
              ]}
              testID="login-verify"
            >
              <Text style={[styles.ctaLabel, !canPress && styles.ctaLabelDisabled]}>
                {primary.label}
              </Text>
            </Pressable>

            {/* A lock is the one state with nothing left to press, so it gets the way out
                rather than a dead end. Rendered only when there is a number to dial — a call
                button that dials nothing is worse than no call button. */}
            {locked && IT_SUPPORT_PHONE && (
              <Pressable
                accessibilityRole="button"
                onPress={() => Linking.openURL(`tel:${IT_SUPPORT_PHONE}`)}
                style={styles.callIt}
                testID="otp-call-it"
              >
                <Text style={styles.callItLabel}>{t('auth.callIt')}</Text>
              </Pressable>
            )}
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
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[2],
  },
  heroNumber: { ...typography.bodyStrong, color: colors.surface },

  // flexGrow rather than flex: the sheet fills whatever the hero leaves over, but keeps its
  // natural height when the notice pushes the content past the fold and the screen scrolls.
  sheet: { flexGrow: 1, paddingTop: spacing[6] },

  // -- code entry -----------------------------------------------------------------------
  cellsWrap: { position: 'relative' },
  cellRow: { flexDirection: 'row', gap: spacing[2] },
  cell: {
    flex: 1,
    height: 58,
    maxWidth: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A typed digit firms the outline up. Only the outline — a fill or a shadow here would
  // make the six cells read as two groups, when the point is that they are one code.
  cellFilled: { borderColor: ink[200] },
  cellNext: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surface },
  // The outline carries the refusal, not a fill. The digits stay Ink and fully legible,
  // because the next thing the user does is read them back against the SMS.
  cellWrong: { borderColor: colors.error },
  cellExpired: { borderColor: colors.warning },
  cellLocked: { borderColor: colors.error },
  cellDigit: { ...typography.h2, fontSize: 24, lineHeight: 30, color: colors.ink },
  caret: { width: 2, height: 24, borderRadius: radius.pill, backgroundColor: colors.primary },

  // Invisible, but a real focusable input covering the whole row — so a tap anywhere on
  // the cells opens the keyboard, and the text itself is never drawn twice.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },

  // -- resend ---------------------------------------------------------------------------
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginTop: spacing[4],
  },
  timerLabel: { ...typography.label, color: colors.textMuted },
  /** The seconds, in Ink — the one part of the line that moves. */
  timerValue: { ...typography.label, fontFamily: typography.h2.fontFamily, color: colors.ink },
  resendButton: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingLeft: spacing[4],
  },
  // Green only once it can actually do something. Before that it is grey, which is the
  // honest signal that pressing it now achieves nothing.
  resendLabel: { ...typography.label, color: colors.primaryDark },
  resendLabelDisabled: { color: colors.textMuted },

  // -- notice ---------------------------------------------------------------------------
  /** Sits directly under the cells, where the correction is being typed. */
  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  inlineErrorText: { ...typography.caption, color: colors.error, flex: 1 },
  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing[4],
    marginTop: spacing[4],
  },
  noticeIcon: { marginTop: 1 },
  noticeBody: { flex: 1 },
  noticeTitle: { ...typography.bodyStrong, color: colors.ink },
  noticeText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // -- actions --------------------------------------------------------------------------
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

  callIt: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
  },
  callItLabel: { ...typography.bodyStrong, color: colors.primaryDark },

  /** Holds the CTA at the bottom when the content is short, and collapses when it is not. */
  spacer: { flexGrow: 1, minHeight: spacing[6] },

  // -- signal card ----------------------------------------------------------------------
  help: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
    backgroundColor: colors.infoWash,
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  helpIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBody: { flex: 1 },
});
