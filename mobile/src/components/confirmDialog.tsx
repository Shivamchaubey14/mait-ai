/**
 * A confirmation drawn in the app's own pattern, in place of the system alert.
 *
 * The platform alert is a plain white box with square corners in the handset's own font —
 * the one place a signed-in user sees something that does not look like this product. This
 * is the same question in our card: a toned glyph, the heading face, and two real buttons,
 * the safe one on the left and the one that acts in its colour on the right.
 *
 * The acting button holds a spinner while `onConfirm` runs, so a slow sign-out over a bad
 * connection cannot be pressed twice.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import AppText from '@/components/AppText';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

type Tone = 'danger' | 'primary';

const TONES: Record<Tone, { solid: string; pressed: string; wash: string }> = {
  danger: { solid: colors.error, pressed: colors.errorPressed, wash: colors.errorWash },
  primary: { solid: colors.primary, pressed: colors.primaryPressed, wash: colors.primaryWash },
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  icon = 'log-out-outline',
  tone = 'danger',
  onConfirm,
  onCancel,
  testID = 'confirm-dialog',
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: Tone;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  testID?: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const look = TONES[tone];

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (!busy) {
      onCancel();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={cancel}
      statusBarTranslucent
    >
      <View style={styles.centre}>
        <Pressable style={styles.scrim} onPress={cancel} testID={`${testID}-scrim`} />
        <View style={styles.card} accessibilityViewIsModal testID={testID}>
          <View style={[styles.glyph, { backgroundColor: look.wash }]}>
            <Ionicons name={icon} size={26} color={look.solid} />
          </View>
          <AppText style={styles.title} accessibilityRole="header">
            {title}
          </AppText>
          {!!body && <AppText style={styles.body}>{body}</AppText>}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={cancel}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                styles.cancel,
                pressed && styles.cancelPressed,
              ]}
              testID={`${testID}-cancel`}
            >
              <AppText style={styles.cancelLabel}>{cancelLabel}</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy }}
              onPress={confirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed || busy ? look.pressed : look.solid },
              ]}
              testID={`${testID}-confirm`}
            >
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <AppText style={styles.confirmLabel}>{confirmLabel}</AppText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[5] },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(12,21,27,0.55)' },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[5],
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: ink[900],
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  glyph: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  title: { ...typography.h2, color: colors.ink, textAlign: 'center', alignSelf: 'stretch' },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    alignSelf: 'stretch',
    marginTop: spacing[4],
  },
  button: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  cancel: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  cancelPressed: { backgroundColor: colors.background },
  cancelLabel: { ...typography.bodyStrong, color: colors.ink, textAlign: 'center' },
  confirmLabel: { ...typography.bodyStrong, color: colors.surface, textAlign: 'center' },
});
