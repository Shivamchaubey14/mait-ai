/**
 * OTP verification (SRS §6.5.1, §9.1).
 *
 * The six circles are a *display* of one real text input laid invisibly over them. Six
 * separate inputs are a well-known source of misery — paste breaks, backspace lands in the
 * wrong box, and screen readers announce six unlabelled fields. A single input keeps SMS
 * autofill, paste and assistive tech working, while the user simply types and watches the
 * circles fill.
 *
 * Three failures are kept distinct because each needs a different action from a Mait
 * standing in a village: the code is wrong (type it again), the code is stale (fetch a new
 * one), or the attempts are gone (wait, or find the MPP operator).
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandMark, HeroDecoration } from '@/components/brand';
import { OTP_LENGTH, OTP_MAX_ATTEMPTS } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

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
            <Text style={styles.cellDigit}>{digit}</Text>
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
      dot: colors.error,
      wash: colors.errorWash,
      title: t('auth.wrongCodeTitle'),
      body: t('auth.wrongCodeBody', { count: attemptsLeft }),
    },
    expired: {
      dot: colors.warning,
      wash: colors.warningWash,
      title: t('auth.expiredTitle'),
      body: t('auth.expiredBody'),
    },
    locked: {
      dot: colors.error,
      wash: colors.errorWash,
      title: t('auth.lockedTitle'),
      body: t('auth.lockedBody'),
    },
  }[failure];

  return (
    <View
      style={[styles.notice, { backgroundColor: config.wash }]}
      accessibilityRole="alert"
      testID={`otp-notice-${failure}`}
    >
      <View style={[styles.noticeDot, { backgroundColor: config.dot }]} />
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
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const locked = failure === 'locked';
  const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - attemptsUsed);
  const displayMobile = useMemo(
    () => (mobileNo.length === 10 ? `+91 ${mobileNo.slice(0, 5)} ${mobileNo.slice(5)}` : mobileNo),
    [mobileNo],
  );

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
          <View style={styles.hero}>
            <HeroDecoration size={220} top={-90} right={-70} />
            <SafeAreaView edges={['top']}>
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
              <Text style={styles.heroSubtitle}>
                {t('auth.verifySubtitle', { mobile: displayMobile })}
              </Text>
            </SafeAreaView>
          </View>

          {/* Safe area on the sides and bottom; the hero owns the top edge. */}
          <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheet}>
            <View style={styles.sentCard}>
              <View style={styles.sentSwatch} />
              <View style={styles.sentBody}>
                <Text style={styles.sentLabel}>{t('auth.codeSentTo')}</Text>
                <Text style={styles.sentNumber}>{displayMobile}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onEditNumber}
                style={styles.editButton}
                testID="otp-edit-number"
              >
                <Text style={styles.editLabel}>{t('auth.edit')}</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>{t('auth.enterSixDigitCode')}</Text>

            <View style={styles.cellsWrap}>
              <DigitCells value={otp} failure={failure} focused={focused} />

              {/* One real input, invisible and stretched across the circles. Typing fills
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

            {!locked && (
              <View style={styles.resendRow}>
                <Text style={styles.resendTimer}>
                  {resendIn > 0 ? t('auth.resendCodeIn', { time: mmss(resendIn) }) : ' '}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: resendIn > 0 }}
                  onPress={onResend}
                  disabled={resendIn > 0 || busy}
                  style={styles.resendButton}
                  testID="login-resend"
                >
                  <Text style={[styles.resendLink, resendIn > 0 && styles.linkDisabled]}>
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

            <View style={styles.divider} />

            <View style={styles.help}>
              <View style={styles.helpIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.info} />
              </View>
              <View style={styles.noticeBody}>
                <Text style={styles.noticeTitle}>{t('auth.didntGetCodeTitle')}</Text>
                <Text style={styles.noticeText}>{t('auth.didntGetCodeBody')}</Text>
              </View>
            </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const CELL = 44;

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
    gap: spacing[3],
    paddingTop: spacing[3],
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

  sheet: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },

  sentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing[3],
  },
  sentSwatch: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: colors.primaryWash,
  },
  sentBody: { flex: 1 },
  sentLabel: { ...typography.caption, color: colors.textMuted },
  sentNumber: { ...typography.bodyStrong, color: colors.ink },
  editButton: {
    minHeight: MIN_TOUCH_TARGET - 12,
    justifyContent: 'center',
    paddingLeft: spacing[2],
  },
  editLabel: { ...typography.label, color: colors.primaryDark },

  label: {
    ...typography.label,
    color: colors.text,
    marginTop: spacing[5],
    marginBottom: spacing[3],
  },

  cellRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: CELL / 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: colors.ink },
  cellNext: { borderColor: colors.primary, borderWidth: 2 },
  cellWrong: { borderColor: colors.error },
  cellExpired: { borderColor: colors.warning },
  cellLocked: { borderColor: colors.error },
  cellDigit: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.ink },

  cellsWrap: { position: 'relative' },
  // Invisible, but a real focusable input covering the whole row — so a tap anywhere on
  // the circles opens the keyboard, and the text itself is never drawn twice.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },

  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[3],
  },
  resendTimer: { ...typography.caption, color: colors.textMuted },
  resendButton: { minHeight: MIN_TOUCH_TARGET - 12, justifyContent: 'center' },
  resendLink: { ...typography.label, color: colors.primaryDark },
  linkDisabled: { color: colors.textDisabled },

  notice: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  noticeDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  noticeBody: { flex: 1 },
  noticeTitle: { ...typography.bodyStrong, color: colors.ink },
  noticeText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 6,
    borderRadius: radius.md,
    marginTop: spacing[4],
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

  divider: { height: 1, backgroundColor: colors.border, marginTop: spacing[5] },

  help: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  helpIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.infoWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
