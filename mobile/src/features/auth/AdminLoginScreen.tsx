/**
 * Admin sign-in (SRS §6.8.2) — the portal's `login.html` on a handset.
 *
 * A Mait, a keeper and a manager sign in with a code to a phone, because the phone *is* the
 * credential. An office admin is the opposite: a named account with a password, the same one
 * they use in the portal. So this screen is reached from the Mait login by "Are you an admin?",
 * and it looks and reads like the portal's own sign-in — the Ink brand panel, the form under it,
 * Show beside the password, "Forgot password?" under it, the green Sign in with its arrow, the
 * rate-limit footnote, and the superuser's second door below the form.
 *
 * "Forgot password?" opens the reset flow here rather than sending anybody to a browser: the
 * code goes to the number on the account, which is very often the phone in their hand.
 *
 * On success it fetches the account before marking the session live — the profile carries the
 * role and the sections, which is what the shell routes on, so fetching first avoids a frame of
 * the wrong app.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import AppText from '@/components/AppText';
import { apiBaseUrl } from '@/config/env';
import { useLazyGetCurrentUserQuery, usePasswordLoginMutation } from '@api/endpoints';
import { useAppDispatch } from '@/store';
import { colors, ink, radius, spacing, typography } from '@theme/tokens';

import AdminPasswordResetScreen from './AdminPasswordResetScreen';
import {
  AuthFrame,
  ErrorAlert,
  Field,
  Submit,
  TextLink,
  Title,
  authStyles,
  problemOf,
  statusOf,
} from './adminAuth';
import { loggedIn } from './authSlice';
import { toAuthUser } from './liveScope';

/** Django's admin, on the API's own host: `https://host/api/v1` → `https://host/admin/`. */
export function djangoAdminUrl(base: string = apiBaseUrl()): string {
  return `${base.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '')}/admin/`;
}

export default function AdminLoginScreen({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const passwordRef = useRef<TextInput>(null);

  const [view, setView] = useState<'signin' | 'reset'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [login, loginState] = usePasswordLoginMutation();
  const [fetchCurrentUser] = useLazyGetCurrentUserQuery();

  const submit = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (!username.trim() || !password) {
      setError(t('auth.admin.enterBoth'));
      return;
    }
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
      const status = statusOf(err);
      if (status === 401 || status === 400) {
        // One message for every failure: an unknown username and a wrong password are
        // deliberately indistinguishable, so nobody can enumerate accounts.
        setError(problemOf(err, t('auth.admin.badCredentials')));
      } else if (status === 429) {
        setError(t('errors.tooManyRequests'));
      } else if (status === 'FETCH_ERROR' || status === undefined) {
        setError(t('auth.officeAskOffline'));
      } else {
        setError(t('errors.generic'));
      }
      setPassword('');
      passwordRef.current?.focus();
    }
  }, [dispatch, fetchCurrentUser, login, password, t, username]);

  const back = useCallback(() => onBack(), [onBack]);

  if (view === 'reset') {
    return (
      <AdminPasswordResetScreen
        initialUsername={username.trim()}
        onBack={() => setView('signin')}
        onDone={name => {
          setView('signin');
          if (name) {
            setUsername(name);
          }
          setPassword('');
          setError(null);
          setNotice(t('auth.admin.resetDone'));
        }}
      />
    );
  }

  return (
    <AuthFrame
      headline={
        <>
          {t('auth.admin.headlineA')}
          <AppText style={styles.figure}>{t('auth.admin.members')}</AppText>
          {t('auth.admin.headlineB')}
          <AppText style={styles.figure}>{t('auth.admin.maits')}</AppText>
          {t('auth.admin.headlineC')}
        </>
      }
      note={t('auth.admin.note')}
      onBack={back}
      testID="admin-login"
    >
      <Title title={t('auth.admin.signInTitle')} subtitle={t('auth.admin.signInSubtitle')} />

      <ErrorAlert message={error} testID="admin-login-error" />
      {!!notice && (
        <View style={styles.notice} testID="admin-login-notice">
          <Ionicons name="checkmark-circle" size={18} color={colors.primaryDark} />
          <AppText style={styles.noticeText}>{notice}</AppText>
        </View>
      )}

      <Field
        label={t('auth.admin.username')}
        value={username}
        onChangeText={setUsername}
        textContentType="username"
        autoComplete="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="admin-username"
      />
      <Field
        ref={passwordRef}
        label={t('auth.admin.password')}
        aside={
          // A mistyped password on a shared office phone is the likeliest way to burn an
          // attempt against the lockout.
          <TextLink
            label={t(show ? 'auth.admin.hide' : 'auth.admin.show')}
            accessibilityLabel={t(show ? 'auth.admin.hidePassword' : 'auth.admin.showPassword')}
            onPress={() => setShow(s => !s)}
            testID="admin-password-toggle"
          />
        }
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!show}
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="admin-password"
      />

      <View style={authStyles.right}>
        <TextLink
          label={t('auth.admin.forgot')}
          onPress={() => {
            setError(null);
            setNotice(null);
            setView('reset');
          }}
          testID="admin-login-forgot"
        />
      </View>

      <Submit
        label={t('auth.admin.signIn')}
        busyLabel={t('auth.admin.signingIn')}
        busy={loginState.isLoading}
        onPress={submit}
        testID="admin-login-submit"
      />

      <AppText style={authStyles.footnote}>{t('auth.admin.footnote')}</AppText>

      {/* The second door. Django's admin edits the database directly, with none of the portal's
          zone scoping or audit trail in the way — a superuser's tool, so it is Ink rather than
          green and the warning is said plainly. It opens in the browser: it is not this app. */}
      <View style={styles.rule}>
        <View style={styles.ruleLine} />
        <AppText style={styles.ruleText}>{t('auth.admin.orDatabase')}</AppText>
        <View style={styles.ruleLine} />
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(djangoAdminUrl())}
        style={({ pressed }) => [styles.alt, pressed && styles.altPressed]}
        testID="admin-login-django"
      >
        <View style={styles.altIcon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.surface} />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.altTitle}>{t('auth.admin.superuser')}</AppText>
          <AppText style={styles.altSub}>{t('auth.admin.superuserSub')}</AppText>
        </View>
        <AppText style={styles.altGo}>→</AppText>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.altPressed]}
        testID="admin-login-back"
      >
        <Ionicons name="arrow-back" size={15} color={colors.primary} />
        <AppText style={styles.backLabel}>{t('auth.admin.backToOtp')}</AppText>
      </Pressable>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  figure: { color: colors.primary },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  noticeText: { ...typography.label, color: colors.primaryDark, flex: 1 },

  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[5],
    marginBottom: spacing[3],
  },
  ruleLine: { flex: 1, height: 1, backgroundColor: colors.border },
  ruleText: { ...typography.caption, color: colors.textMuted },
  alt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  altPressed: { opacity: 0.85 },
  altIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  altTitle: { ...typography.label, color: colors.surface },
  altSub: { ...typography.caption, color: ink[200] },
  altGo: { ...typography.bodyStrong, color: ink[200] },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[5],
    paddingVertical: spacing[2],
  },
  backLabel: { ...typography.label, color: colors.primary },
});
