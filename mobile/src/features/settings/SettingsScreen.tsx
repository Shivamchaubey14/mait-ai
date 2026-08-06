/**
 * Settings — who is signed in, what the app is doing, and the way out.
 *
 * Mostly read-only on purpose. Almost nothing here is a Mait's to change: the mobile number
 * and the MPP come from the SAP master, and letting them be edited on the handset would put
 * the app out of step with the record the office works from. They are shown because a Mait
 * gets asked "which number is on your account" and needs to be able to answer it.
 *
 * Sign-out asks twice when work is unsent. The queue lives in this app's storage, so those
 * records can only be sent by that Mait on that handset — and the idempotency window closes
 * in a day.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useLogoutMutation } from '@api/endpoints';
import { LanguageToggle } from '@/components/brand';
import PageHero from '@/components/hero';
import { SyncBanner } from '@/components/states';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

/** One row: a swatch, a label, and the value under it. */
function Row({
  tone,
  icon,
  label,
  value,
  badge,
  testID,
}: {
  tone: 'primary' | 'info' | 'accent' | 'neutral';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  badge?: string;
  testID?: string;
}): React.JSX.Element {
  const wash = {
    primary: colors.primaryWash,
    info: colors.infoWash,
    accent: colors.secondaryWash,
    neutral: colors.background,
  }[tone];
  const tint = {
    primary: colors.primaryDark,
    info: colors.info,
    accent: colors.secondaryPressed,
    neutral: colors.textMuted,
  }[tone];

  return (
    <View style={styles.row} testID={testID}>
      <View style={[styles.swatch, { backgroundColor: wash }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
      {!!badge && (
        <View style={[styles.badge, { backgroundColor: wash }]}>
          <Text style={[styles.badgeLabel, { color: tint }]}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function SettingsScreen({
  pending,
  onSync,
  online,
}: {
  pending: number;
  onSync: () => void;
  online: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);
  const mpps = useAppSelector(state => state.auth.assignedMppCodes);

  const [logout] = useLogoutMutation();
  const [confirming, setConfirming] = useState(false);

  const version = Constants.expoConfig?.version ?? '0.1.0';

  const signOut = async () => {
    if (pending > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    try {
      if (refreshToken) {
        await logout(refreshToken).unwrap();
      }
    } catch {
      // The token is unreachable either way; a session left in storage is the worse outcome.
    }
    dispatch(loggedOut());
  };

  return (
    <View style={styles.root}>
      <PageHero
        title={t('settings.title')}
        subtitle={[user?.fullName, user?.maitId ? `M-${user.maitId}` : null]
          .filter(Boolean)
          .join(' · ')}
      />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('settings.language')}</Text>
        <View style={styles.languageCard}>
          <LanguageToggle />
        </View>

        <Text style={styles.section}>{t('settings.profile')}</Text>
        <Row
          tone="info"
          icon="call-outline"
          label={t('settings.mobile')}
          value={`${user?.mobileNo ?? '—'} · ${t('settings.mobileFoot')}`}
          testID="settings-mobile"
        />
        <Row
          tone="primary"
          icon="home-outline"
          label={t('settings.mpp')}
          value={mpps && mpps.length ? mpps.join(', ') : t('settings.noMpps')}
          testID="settings-mpp"
        />
        <Row
          tone="neutral"
          icon="phone-portrait-outline"
          label={t('settings.version')}
          value={version}
          testID="settings-version"
        />

        <Text style={styles.section}>{t('settings.data')}</Text>
        <Row
          tone={pending > 0 ? 'accent' : 'primary'}
          icon={pending > 0 ? 'time-outline' : 'checkmark-done'}
          label={t('settings.queued')}
          value={pending > 0 ? t('settings.queuedFoot', { count: pending }) : t('home.allSent')}
          badge={pending > 0 ? String(pending) : undefined}
          testID="settings-queued"
        />
        {pending > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={onSync}
            style={styles.sendNow}
            testID="settings-send-now"
          >
            <Text style={styles.sendNowLabel}>
              {online ? t('home.sendNow') : t('home.offline')}
            </Text>
          </Pressable>
        )}
        {/* A statement of what the app does, not a control. The capture compresses to keep an
            upload possible on one bar of signal, and that is not a Mait's decision to make. */}
        <Row
          tone="info"
          icon="image-outline"
          label={t('settings.photoQuality')}
          value={t('settings.photoQualityFoot')}
          testID="settings-photo"
        />

        {confirming && (
          <SyncBanner
            tone="offline"
            title={t('settings.signOutWarnTitle', { count: pending })}
            body={t('settings.signOutWarnBody')}
            testID="signout-warning"
          />
        )}

        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          testID="sign-out"
        >
          <View style={styles.signOutSwatch}>
            <Ionicons name="log-out-outline" size={17} color={colors.error} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.signOutLabel}>
              {confirming ? t('settings.signOutAnyway') : t('settings.signOut')}
            </Text>
            <Text style={styles.signOutFoot}>{t('settings.signOutFoot')}</Text>
          </View>
        </Pressable>

        {confirming && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirming(false)}
            style={styles.cancel}
            testID="signout-cancel"
          >
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  section: {
    ...typography.h3,
    color: colors.ink,
    marginTop: spacing[3],
    marginBottom: spacing[3],
  },

  languageCard: {
    flexDirection: 'row',
    padding: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowLabel: { ...typography.bodyStrong, color: colors.ink },
  rowValue: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  badge: {
    minWidth: 26,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  badgeLabel: { ...typography.label },

  sendNow: {
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  sendNowLabel: { ...typography.label, color: colors.primaryDark },

  // Tinted, because it is the one row here that ends the session.
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginTop: spacing[3],
    backgroundColor: colors.errorWash,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  signOutPressed: { opacity: 0.8 },
  signOutSwatch: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  signOutLabel: { ...typography.bodyStrong, color: colors.error },
  signOutFoot: { ...typography.caption, color: colors.error, opacity: 0.85, marginTop: 2 },

  cancel: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...typography.bodyStrong, color: colors.primaryDark },
});
