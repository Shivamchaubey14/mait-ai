/**
 * OTP verification (SRS §6.5.1, §9.1).
 *
 * The six cells are a *display* of one real text input laid invisibly over them. Six
 * separate inputs are a well-known source of misery — paste breaks, backspace lands in the
 * wrong box, and screen readers announce six unlabelled fields. A single input keeps SMS
 * autofill, paste and assistive tech working, while the user simply types and watches the
 * cells fill.
 *
 * Layout follows what the user does, in order: the hero says which number the code went to
 * and offers the way to change it, the sheet carries the one job — type the code — and the
 * "didn't get it" card is pinned to the bottom of the screen. That card answers a question
 * that only arises after waiting, so it has no business sitting between the keypad and the
 * button.
 *
 * Three failures are kept distinct because each needs a different action from a Mait
 * standing in a village: the code is wrong (type it again), the code is stale (fetch a new
 * one), or the attempts are gone (wait, or call the IT department).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandMark, HeroDecoration } from '@/components/brand';
import { Toast } from '@/components/toast';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

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

function mmss(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
function FailureNotice({
  failure,
  attemptsLeft,
}: {
  failure: Exclude<OtpFailure, null>;
  attemptsLeft: number;
}): React.JSX.Element {
  const { t } = useTranslation();

  const config = {
    wrong: {
      tint: colors.error,
      wash: colors.errorWash,
      icon: 'close-circle' as const,
      title: t('auth.wrongCodeTitle'),
      body: t('auth.wrongCodeBody', { count: attemptsLeft }),
    },
    expired: {
      tint: colors.warning,
      wash: colors.warningWash,
      icon: 'time-outline' as const,
      title: t('auth.expiredTitle'),
      body: t('auth.expiredBody'),
    },
    locked: {
      tint: colors.error,
      wash: colors.errorWash,
      icon: 'lock-closed' as const,
      title: t('auth.lockedTitle'),
      body: t('auth.lockedBody'),
    },
  }[failure];

  return (
    <View
      style={[styles.notice, { backgroundColor: config.wash, borderLeftColor: config.tint }]}
      accessibilityRole="alert"
      testID={`otp-notice-${failure}`}
    >
      {/* A glyph as well as a colour — colour alone excludes colour-blind users, and the
          wrong/expired pair is exactly the distinction they would lose. */}
      <View style={[styles.noticeIcon, { backgroundColor: config.tint }]}>
        <Ionicons name={config.icon} size={16} color={colors.surface} />
      </View>
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

  // The number is set in strong type inside the sentence, so it can be checked against the
  // handset without reading the whole line.
  const [before, after] = useMemo(() => {
    const [head, ...rest] = t('auth.verifySubtitle', { mobile: displayMobile }).split(
      displayMobile,
    );
    return [head, rest.join(displayMobile)];
  }, [displayMobile, t]);

  // Focus on mount so the keyboard is already up — one less tap for someone holding a
  // phone in one hand and a flask in the other.
  useEffect(() => {
    if (!locked) {
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [locked]);

  /**
   * The button changes job with the failure, because after an expiry or a lock there is
   * nothing useful left to verify — offering "Verify" there would be a dead end.
   */
  const primary = (() => {
    if (locked) {
      return { label: t('auth.lockedCta', { time: mmss(lockedFor) }), action: undefined };
    }
    if (failure === 'expired') {
      return { label: t('auth.sendNewCode'), action: onResend };
    }
    if (failure === 'wrong') {
      return { label: t('auth.tryAgain'), action: onSubmit };
    }
    return { label: t('auth.verifyAndContinue'), action: onSubmit };
  })();

  const canPress =
    !!primary.action && !busy && (failure === 'expired' || otp.length === OTP_LENGTH);
  const canResend = resendIn <= 0 && !busy;

  return (
    <View style={styles.root}>
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
            <HeroDecoration size={220} top={-90} right={-70} />

            <View style={styles.heroTop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onEditNumber}
                style={styles.backButton}
                testID="otp-back"
              >
                <Ionicons name="arrow-back" size={20} color={colors.surface} />
              </Pressable>
              <BrandMark size="small" />
            </View>

            <Text style={styles.heroTitle}>{t('auth.verifyTitle')}</Text>
            {/* The number lives here and nowhere else. It used to be repeated in a card
                below, which asked the user to read the same ten digits twice.
                Split around the number rather than put on its own line: the sentence is
                translated, and Hindi leads with the number where English trails it. */}
            <Text style={styles.heroSubtitle}>
              {before}
              <Text style={styles.heroNumber}>{displayMobile}</Text>
              {after}
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={onEditNumber}
              style={({ pressed }) => [styles.editPill, pressed && styles.editPillPressed]}
              testID="otp-edit-number"
            >
              <Ionicons name="create-outline" size={14} color={colors.surface} />
              <Text style={styles.editPillLabel}>{t('auth.edit')}</Text>
            </Pressable>
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

            {/* Hidden once the code has expired: the primary button has already become
                "Send a new code", and offering the same action twice makes the Mait wonder
                whether the two do different things. */}
            {!locked && failure !== 'expired' && (
              <View style={styles.resendRow}>
                {resendIn > 0 ? (
                  <View style={styles.timerChip}>
                    <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.timerLabel}>
                      {t('auth.resendCodeIn', { time: mmss(resendIn) })}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.flex} />
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canResend }}
                  onPress={onResend}
                  disabled={!canResend}
                  style={({ pressed }) => [
                    styles.resendButton,
                    canResend && styles.resendButtonReady,
                    pressed && canResend && styles.resendButtonPressed,
                  ]}
                  testID="login-resend"
                >
                  <Ionicons
                    name="refresh"
                    size={15}
                    color={canResend ? colors.primaryDark : colors.textDisabled}
                  />
                  <Text style={[styles.resendLabel, !canResend && styles.resendLabelDisabled]}>
                    {t('auth.resend')}
                  </Text>
                </Pressable>
              </View>
            )}

            {!!failure && <FailureNotice failure={failure} attemptsLeft={attemptsLeft} />}

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
              {!failure && (
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={canPress ? colors.surface : colors.textDisabled}
                />
              )}
            </Pressable>

            {!locked && (
              <Pressable
                accessibilityRole="button"
                onPress={onEditNumber}
                style={styles.differentNumber}
                testID="otp-different-number"
              >
                <Text style={styles.differentNumberLabel}>{t('auth.useDifferentNumber')}</Text>
              </Pressable>
            )}

            {/* Takes up whatever is left, which drops the help card to the foot of the
                screen instead of leaving it wedged under the button. */}
            <View style={styles.spacer} />

            <View style={styles.help}>
              <View style={styles.helpIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.info} />
              </View>
              <View style={styles.helpBody}>
                <Text style={styles.noticeTitle}>{t('auth.didntGetCodeTitle')}</Text>
                <Text style={styles.noticeText}>{t('auth.didntGetCodeBody')}</Text>
              </View>
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
  scroll: { flexGrow: 1 },

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
    gap: spacing[3],
    marginBottom: spacing[5],
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...typography.h1, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.92,
    marginTop: spacing[2],
  },
  heroNumber: { ...typography.bodyStrong, color: colors.surface },

  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginTop: spacing[3],
  },
  editPillPressed: { backgroundColor: 'rgba(255,255,255,0.34)' },
  editPillLabel: { ...typography.label, color: colors.surface },

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
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A typed digit is a small commitment, so the cell lifts off the page to say so.
  cellFilled: {
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  cellNext: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surface },
  cellWrong: { borderColor: colors.error, backgroundColor: colors.errorWash },
  cellExpired: { borderColor: colors.warning, backgroundColor: colors.warningWash },
  cellLocked: { borderColor: colors.error, backgroundColor: colors.errorWash },
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
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  timerLabel: { ...typography.caption, color: colors.textMuted },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingHorizontal: spacing[4],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Only once it can actually do something does it look like a button worth pressing.
  resendButtonReady: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  resendButtonPressed: { backgroundColor: colors.primaryWash, opacity: 0.7 },
  resendLabel: { ...typography.label, color: colors.primaryDark },
  resendLabelDisabled: { color: colors.textDisabled },

  // -- notice ---------------------------------------------------------------------------
  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderLeftWidth: 3,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  noticeIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    marginTop: spacing[5],
  },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
  ctaLabelDisabled: { color: colors.textDisabled },

  differentNumber: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
  },
  differentNumberLabel: { ...typography.bodyStrong, color: colors.primaryDark },

  // -- help, pinned to the foot ---------------------------------------------------------
  spacer: { flexGrow: 1, minHeight: spacing[6] },
  help: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing[3],
  },
  helpIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.infoWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBody: { flex: 1 },
});
