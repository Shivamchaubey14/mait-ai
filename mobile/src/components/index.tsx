/**
 * Shared UI primitives (docs/DESIGN_SYSTEM.md).
 *
 * Everything here obeys two rules the field context imposes: nothing tappable is smaller
 * than 48dp, and no string is hardcoded — the app ships with a Hindi toggle and the user
 * base is semi-literate, so both matter more than usual.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Button
// --------------------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'accent' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  testID,
}: ButtonProps): React.JSX.Element {
  const isInert = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInert, busy: loading }}
      onPress={onPress}
      disabled={isInert}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        // The step-advancing action in the AI flow is accent, so "what do I tap next" is
        // unmistakable at a glance.
        variant === 'accent' && { backgroundColor: colors.primary },
        variant === 'ghost' && styles.buttonGhost,
        isInert && styles.buttonInert,
        pressed && !isInert && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? colors.primary : colors.surface} />
      ) : (
        <Text style={[styles.buttonLabel, variant === 'ghost' && { color: colors.primary }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// TextField
// --------------------------------------------------------------------------------------
interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextField({
  label,
  error,
  hint,
  ...inputProps
}: TextFieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      {/* Label above the input, always visible. A placeholder-as-label disappears exactly
          when a hesitant user needs it. */}
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, !!error && styles.fieldInputError]}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...inputProps}
      />
      {!!hint && !error && <Text style={styles.fieldHint}>{hint}</Text>}
      {/* Errors carry a glyph as well as colour — colour alone excludes colour-blind users. */}
      {!!error && <Text style={styles.fieldError}>{`⚠  ${error}`}</Text>}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen scaffolding
// --------------------------------------------------------------------------------------
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

export function Banner({
  message,
  tone = 'error',
  testID,
}: {
  message: string;
  tone?: 'error' | 'info' | 'warning';
  testID?: string;
}): React.JSX.Element {
  const background = {
    error: colors.error,
    info: colors.info,
    warning: colors.warning,
  }[tone];
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: background }]}>
      <Text
        style={[
          styles.bannerText,
          // Warning yellow fails contrast against white text, so it takes dark text.
          tone === 'warning' && { color: colors.text },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

export function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={colors.primary} />
      {!!label && <Text style={styles.emptyText}>{label}</Text>}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// List row
// --------------------------------------------------------------------------------------
export function ListRow({
  title,
  subtitle,
  meta,
  onPress,
  disabled = false,
  warning,
  testID,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  onPress: () => void;
  disabled?: boolean;
  warning?: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        disabled && styles.rowDisabled,
        pressed && !disabled && { backgroundColor: colors.background },
      ]}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {!!warning && <Text style={styles.rowWarning}>{`⚠  ${warning}`}</Text>}
      </View>
      {!!meta && <Text style={styles.rowMeta}>{meta}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing[4],
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonInert: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonLabel: {
    ...typography.body,
    color: colors.surface,
    fontWeight: '600',
  },
  field: { marginBottom: spacing[4] },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  fieldInput: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[3],
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  fieldInputError: { borderColor: colors.error },
  fieldHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[1],
  },
  fieldError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing[1],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[4],
    marginBottom: spacing[4],
    ...shadows.card,
  },
  banner: {
    borderRadius: radius.sm,
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  bannerText: { ...typography.body, color: colors.surface },
  empty: {
    paddingVertical: spacing[7],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[2],
  },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    marginBottom: spacing[2],
    ...shadows.card,
  },
  rowDisabled: { opacity: 0.55 },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.h3, color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowWarning: { ...typography.caption, color: colors.error, marginTop: spacing[1] },
  rowMeta: { ...typography.label, color: colors.textMuted, marginLeft: spacing[3] },
});
