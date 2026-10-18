/**
 * Admin sign-in (SRS §6.8.2) — the one door that is a password, not an OTP.
 *
 * A Mait, a keeper and a manager sign in with a code to a phone, because the phone *is* the
 * credential and there is no desk behind it. An office admin is the opposite: a named account
 * with a password, the same one they use in the portal. So this screen is reached from the
 * Mait login by "Are you an admin?", and it asks for the two things the portal asks for.
 *
 * On success it fetches the account before marking the session live — the profile carries the
 * role and the sections, which is what the shell routes on, so fetching first avoids a frame of
 * the wrong app.
 */

import React, { useCallback, useState } from 'react';
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

import { useLazyGetCurrentUserQuery, usePasswordLoginMutation } from '@api/endpoints';
import { BrandLogo, BrandWordmark } from '@/components/brand';
import { Toast } from '@/components/toast';
import { useAppDispatch } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { loggedIn } from './authSlice';
import { toAuthUser } from './liveScope';

export default function AdminLoginScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [login, loginState] = usePasswordLoginMutation();
  const [fetchCurrentUser] = useLazyGetCurrentUserQuery();

  const canSubmit = username.trim().length > 0 && password.length > 0;

  const submit = useCallback(async () => {
    setError(null);
    try {
      const tokens = await login({ username: username.trim(), password }).unwrap();
      // The profile carries role + sections, which the shell routes on — fetch it before the
      // session goes live so the first frame is the right app, never a flash of the wrong one.
      const user = await fetchCurrentUser(tokens.access).unwrap();
      dispatch(
        loggedIn({
          access: tokens.access,
          refresh: tokens.refresh,
          user: toAuthUser(user),
          assignedMppCodes: user.assigned_mpp_codes,
        }),
      );
    } catch (err) {
      const status = (err as { status?: number | string })?.status;
      if (status === 401 || status === 400) {
        setError(t('auth.adminBadCredentials'));
      } else if (status === 'FETCH_ERROR' || status === undefined) {
        setError(t('auth.officeAskOffline'));
      } else if (status === 429) {
        setError(t('errors.tooManyRequests'));
      } else {
        setError(t('errors.generic'));
      }
    }
  }, [dispatch, fetchCurrentUser, login, password, t, username]);

  const busy = loginState.isLoading;

  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor={colors.ink} />
      <Toast message={error} onDismiss={() => setError(null)} testID="admin-login-error" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { paddingTop: insets.top + spacing[3] }]}>
            <View style={styles.heroBrand}>
              <BrandLogo size={30} />
              <BrandWordmark size="small" />
            </View>
            <Text style={styles.heroTitle}>{t('auth.adminTitle')}</Text>
            <Text style={styles.heroSubtitle}>{t('auth.adminSubtitle')}</Text>
          </View>

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
            <Text style={styles.label}>{t('auth.adminUsername')}</Text>
            <View style={styles.field}>
              <Ionicons name="person" size={16} color={colors.info} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder={t('auth.adminUsernamePlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                testID="admin-username"
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>{t('auth.adminPassword')}</Text>
            <View style={styles.field}>
              <Ionicons name="lock-closed" size={16} color={colors.info} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.adminPasswordPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!show}
                textContentType="password"
                onSubmitEditing={canSubmit ? submit : undefined}
                returnKeyType="go"
                testID="admin-password"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(show ? 'auth.adminHide' : 'auth.adminShow')}
                onPress={() => setShow(s => !s)}
                hitSlop={8}
                testID="admin-password-toggle"
              >
                <Ionicons name={show ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.spacer} />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit || busy, busy }}
              onPress={submit}
              disabled={!canSubmit || busy}
              style={({ pressed }) => [
                styles.cta,
                !canSubmit || busy ? styles.ctaDisabled : styles.ctaEnabled,
                pressed && canSubmit && !busy && styles.ctaPressed,
              ]}
              testID="admin-login-submit"
            >
              <Text style={[styles.ctaLabel, (!canSubmit || busy) && styles.ctaLabelDisabled]}>
                {busy ? t('auth.adminSigningIn') : t('auth.adminSignIn')}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={onBack}
              style={styles.back}
              testID="admin-login-back"
            >
              <Ionicons name="arrow-back" size={15} color={colors.info} />
              <Text style={styles.backLabel}>{t('auth.adminBackToOtp')}</Text>
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
  heroBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[5],
  },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: { ...typography.body, color: colors.surface, opacity: 0.72, marginTop: spacing[2] },

  sheet: { flex: 1, paddingTop: spacing[5] },
  label: { ...typography.label, color: colors.info, marginBottom: spacing[2] },
  labelSpaced: { marginTop: spacing[4] },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 6,
    paddingHorizontal: spacing[3],
    borderWidth: 1.5,
    borderColor: colors.info,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  spacer: { flex: 1, minHeight: spacing[6] },
  cta: {
    minHeight: MIN_TOUCH_TARGET + 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
  ctaLabelDisabled: { color: colors.textDisabled },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[2],
  },
  backLabel: { ...typography.label, color: colors.info },
});
