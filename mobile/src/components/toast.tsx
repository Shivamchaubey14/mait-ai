/**
 * Top-anchored notification.
 *
 * Errors that are about the *request* rather than about a field belong here: a network
 * failure or a throttled send is not something to fix in the form below it, so putting it in
 * the form's flow pushes the actual controls down and reads as though the field were at
 * fault.
 *
 * Deliberately soft. A solid red bar is the loudest thing the palette can do, and spending
 * that on "try again in a minute" leaves nothing louder for the things that genuinely cannot
 * be undone — a straw consumed, a payment taken. The colour lives in the accent bar and the
 * glyph; the text stays ink on white so it is legible in sunlight.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

export type ToastTone = 'error' | 'warning' | 'info' | 'success';

const TONE = {
  error: { tint: colors.error, wash: colors.errorWash, icon: 'alert-circle' },
  warning: { tint: colors.secondaryPressed, wash: colors.secondaryWash, icon: 'time-outline' },
  info: { tint: colors.info, wash: colors.infoWash, icon: 'information-circle' },
  success: { tint: colors.primary, wash: colors.primaryWash, icon: 'checkmark-circle' },
} as const;

interface Props {
  /** Null hides the toast. Passing a new string re-shows it. */
  message: string | null;
  tone?: ToastTone;
  onDismiss?: () => void;
  /** Milliseconds before it leaves on its own. 0 keeps it until dismissed. */
  duration?: number;
  testID?: string;
}

export function Toast({
  message,
  tone = 'error',
  onDismiss,
  duration = 6000,
  testID,
}: Props): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const { tint, wash, icon } = TONE[tone];

  useEffect(() => {
    if (!message) {
      return;
    }

    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    if (!duration) {
      return;
    }
    // Cleared on unmount and whenever the message changes, so a second error does not
    // inherit the first one's countdown and vanish early.
    const timer = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(timer);
  }, [duration, message, onDismiss, slide]);

  if (!message) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + spacing[2],
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={message}
        onPress={onDismiss}
        style={[styles.card, { borderLeftColor: tint }]}
        testID={testID}
      >
        <View style={[styles.icon, { backgroundColor: wash }]}>
          <Ionicons name={icon} size={18} color={tint} />
        </View>
        <Text style={styles.message}>{message}</Text>
        {!!onDismiss && <Ionicons name="close" size={18} color={colors.textMuted} />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing[4],
    // Above the hero and anything the screen scrolls under it.
    zIndex: 10,
    elevation: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    ...shadows.raised,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { ...typography.body, color: colors.ink, flex: 1 },
});
