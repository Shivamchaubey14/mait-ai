/**
 * The portal's sign-in look, on a handset — shared by admin sign-in and password reset.
 *
 * `admin-web/login.html` is a split page: an Ink panel carrying the brand and the scale of the
 * thing, and a light panel carrying the one job the page has. A phone has no room for two
 * columns, so they stack — the Ink panel on top, as the portal's own narrow layout does — but
 * everything inside them is the portal's: the white "MAIT AI / ADMIN PORTAL" mark, the soft
 * green disc behind it, the headline, the note, the version, then labels above plain bordered
 * fields, a green submit with its arrow, quiet green text links, and a red alert above the form.
 *
 * An office admin who uses both should not feel they have left one product for another.
 */

import React, { useEffect } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { colors, green, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/** Every message a refusal carries, field errors included, in the server's own words. */
export function problemOf(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown })?.data;
  if (data && typeof data === 'object') {
    const body = data as Record<string, unknown>;
    // A problem document's sentence is `detail`; `type`, `title` and `status` describe the
    // problem to a program, and the type is a URL nobody should be shown.
    if (typeof body.detail === 'string' && body.detail) {
      return body.detail;
    }
    for (const [key, value] of Object.entries(body)) {
      if (['type', 'title', 'status', 'instance', 'code'].includes(key)) {
        continue;
      }
      if (typeof value === 'string' && value) {
        return value;
      }
      if (Array.isArray(value) && value.length) {
        return String(value[0]);
      }
    }
  }
  return fallback;
}

/** The status a failed request came back with, or the fetch failure that stood in for one. */
export function statusOf(error: unknown): number | string | undefined {
  return (error as { status?: number | string })?.status;
}

export function AuthFrame({
  headline,
  note,
  onBack,
  children,
  testID,
}: {
  headline: React.ReactNode;
  note: string;
  /** Hardware back. The screen decides what back means for its own step. */
  onBack: () => void;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '0.1.0';
  const { t } = useTranslation();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={styles.root} testID={testID}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.brand, { paddingTop: insets.top + spacing[5] }]}>
            {/* Behind everything, so it can never take a tap meant for what sits on it. */}
            <View style={styles.disc} pointerEvents="none" />
            <View style={styles.mark} testID="admin-auth-mark">
              <AppText style={styles.markName}>MAIT AI</AppText>
              <AppText style={styles.markSub}>ADMIN PORTAL</AppText>
            </View>
            <AppText style={styles.headline} testID="admin-auth-headline">
              {headline}
            </AppText>
            <AppText style={styles.note}>{note}</AppText>
            <AppText style={styles.version}>{t('auth.admin.version', { version })}</AppText>
          </View>

          <View
            style={[
              styles.panel,
              {
                paddingLeft: spacing[5] + insets.left,
                paddingRight: spacing[5] + insets.right,
                paddingBottom: spacing[6] + insets.bottom,
              },
            ]}
          >
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export function Title({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <AppText style={styles.title} accessibilityRole="header">
        {title}
      </AppText>
      {!!subtitle && <AppText style={styles.subtitle}>{subtitle}</AppText>}
    </View>
  );
}

/** The portal's `.alert--error`: red, above the form, said in the server's words. */
export function ErrorAlert({ message, testID }: { message: string | null; testID?: string }) {
  if (!message) {
    return null;
  }
  return (
    <View style={styles.alert} accessibilityRole="alert" testID={testID}>
      <Ionicons name="alert-circle" size={18} color={colors.error} />
      <AppText style={styles.alertText}>{message}</AppText>
    </View>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  /** Beside the label, as the portal puts Show/Hide. */
  aside?: React.ReactNode;
};

/** A label above a plain bordered box, green while it has the cursor — the portal's `.field`. */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, aside, ...input },
  ref,
) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <AppText style={styles.label}>{label}</AppText>
        {aside}
      </View>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        onFocus={e => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[styles.input, focused && styles.inputFocused, input.style]}
      />
    </View>
  );
});

/** A quiet green text button — Show, Forgot password?, Use a different username. */
export function TextLink({
  label,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => pressed && styles.pressed}
      testID={testID}
    >
      <AppText style={styles.link}>{label}</AppText>
    </Pressable>
  );
}

/** The portal's `.auth__submit`: full width, green, the arrow after the words. */
export function Submit({
  label,
  busyLabel,
  busy,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const off = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.submit,
        off ? styles.submitOff : pressed ? styles.submitPressed : styles.submitOn,
      ]}
      testID={testID}
    >
      <AppText style={[styles.submitLabel, off && styles.submitLabelOff]}>
        {busy && busyLabel ? busyLabel : label}
      </AppText>
      <AppText
        style={[styles.submitLabel, off && styles.submitLabelOff]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        →
      </AppText>
    </Pressable>
  );
}

export const authStyles = StyleSheet.create({
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[4],
  },
  right: { alignItems: 'flex-end', marginTop: spacing[1] },
  center: { alignItems: 'center', marginTop: spacing[4] },
  sent: {
    ...typography.caption,
    color: colors.textMuted,
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  returnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[4],
  },
  returnText: { ...typography.caption, color: colors.textMuted },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  pressed: { opacity: 0.7 },

  brand: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    backgroundColor: colors.ink,
    overflow: 'hidden',
    gap: spacing[3],
  },
  disc: {
    position: 'absolute',
    top: -140,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: green[800],
    opacity: 0.55,
  },
  mark: {
    alignSelf: 'flex-start',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing[2],
  },
  markName: { ...typography.h3, color: colors.ink, letterSpacing: 0.6 },
  markSub: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 14,
    fontFamily: typography.label.fontFamily,
    color: colors.primary,
    letterSpacing: 1.8,
  },
  headline: { ...typography.h1, fontSize: 24, lineHeight: 31, color: colors.surface },
  note: { ...typography.body, color: ink[200] },
  version: { ...typography.caption, color: ink[300] },

  panel: { flex: 1, paddingTop: spacing[6], backgroundColor: colors.background },
  titleBlock: { marginBottom: spacing[4], gap: spacing[1] },
  title: { ...typography.h1, color: colors.ink },
  subtitle: { ...typography.body, color: colors.textMuted },

  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  alertText: { ...typography.label, color: colors.error, flex: 1 },

  field: { marginBottom: spacing[4] },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  label: { ...typography.label, color: colors.ink },
  input: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET + 2,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  inputFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  link: { ...typography.label, color: colors.primary },

  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 46,
    marginTop: spacing[2],
    borderRadius: radius.md,
  },
  submitOn: { backgroundColor: colors.primary },
  submitPressed: { backgroundColor: colors.primaryPressed },
  submitOff: { backgroundColor: colors.disabledFill },
  submitLabel: { ...typography.bodyStrong, color: colors.surface },
  submitLabelOff: { color: colors.textDisabled },
});
