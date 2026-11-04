/**
 * A six-digit code, typed into six boxes.
 *
 * One component for every code a Mait types — their own at sign-in, and a member's when her
 * phone is checked — so the two look and behave alike and a Mait learns it once. It was a
 * plain text field on the member's sheet, which read as a different kind of thing to fill in.
 *
 * Rounded slots rather than circles: a square-ish cell gives the digit room to sit at a size
 * that survives sunlight and a cracked screen, and the filled ones read as a block of six at
 * a glance, which is how the code is checked against the SMS.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import AppText from '@/components/AppText';
import { OTP_LENGTH } from '@/config/env';
import { colors, radius, spacing, typography, yolk } from '@theme/tokens';

/** Why the last code was refused, which the outline of every cell then says. */
export type OtpRefusal = 'wrong' | 'expired' | 'locked' | null;

export default function OtpInput({
  value,
  onChangeText,
  refusal = null,
  editable = true,
  autoFocus = false,
  accessibilityLabel,
  testID,
}: {
  value: string;
  /** Called with digits only, at most six of them. */
  onChangeText: (digits: string) => void;
  refusal?: OtpRefusal;
  editable?: boolean;
  /** Open the number keypad as soon as the boxes appear. */
  autoFocus?: boolean;
  accessibilityLabel: string;
  /** On the input itself, which is what a test types into. */
  testID?: string;
}): React.JSX.Element {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // A beat after mount rather than on it: focused in the same frame as a screen or sheet
  // sliding in, Android opens the keypad and then drops it again.
  useEffect(() => {
    if (!autoFocus || !editable) {
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [autoFocus, editable]);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.row}
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: value.split('').join(' ') }}
      >
        {Array.from({ length: OTP_LENGTH }).map((_, index) => {
          const digit = value[index] ?? '';
          const isNext = focused && index === value.length && !refusal;
          return (
            <View
              key={index}
              style={[
                styles.cell,
                !!digit && styles.cellFilled,
                isNext && styles.cellNext,
                refusal === 'wrong' && styles.cellWrong,
                refusal === 'expired' && styles.cellExpired,
                refusal === 'locked' && styles.cellLocked,
              ]}
            >
              {digit ? (
                <AppText style={styles.digit}>{digit}</AppText>
              ) : (
                // A caret only in the cell about to be typed into, so the eye knows where the
                // next digit lands without a blinking animation to chase.
                isNext && <View style={styles.caret} />
              )}
            </View>
          );
        })}
      </View>

      {/* One real input, invisible and stretched across the cells. Typing fills them directly,
          and because it is a genuine TextInput rather than a keypress handler, SMS autofill,
          paste and screen readers all still work. */}
      <TextInput
        ref={inputRef}
        style={styles.hiddenInput}
        value={value}
        onChangeText={text => onChangeText(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH}
        editable={editable}
        caretHidden
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { flexDirection: 'row', gap: spacing[2] },
  cell: {
    flex: 1,
    height: 58,
    maxWidth: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A typed digit firms the outline up. Only the outline — a fill or a shadow here would
  // make the six cells read as two groups, when the point is that they are one code.
  cellFilled: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  cellNext: { borderColor: colors.primary, borderWidth: 2.5, backgroundColor: colors.surface },
  // The outline carries the refusal, not a fill. The digits stay Ink and fully legible,
  // because the next thing the user does is read them back against the SMS.
  cellWrong: { borderColor: colors.error, backgroundColor: colors.errorWash },
  cellExpired: { borderColor: yolk[500], backgroundColor: colors.secondaryWash },
  cellLocked: { borderColor: colors.error, backgroundColor: colors.errorWash },
  digit: { ...typography.h2, fontSize: 24, lineHeight: 30, color: colors.ink },
  caret: { width: 2, height: 24, borderRadius: radius.pill, backgroundColor: colors.primary },

  // Invisible, but a real focusable input covering the whole row — so a tap anywhere on the
  // cells opens the keypad, and the text itself is never drawn twice.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
});
