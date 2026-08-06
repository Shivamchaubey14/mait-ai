/**
 * Profile — who is signed in, what is still on the phone, and the way out.
 *
 * Sign-out asks twice when there is unsent work. The queue lives in this app's storage: a Mait
 * who signs out with ten inseminations waiting has not lost them, but nobody can send them
 * until that same Mait signs back in on that same handset — and by then the idempotency window
 * may have closed.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useLogoutMutation } from '@api/endpoints';
import { LanguageToggle } from '@/components/brand';
import PageHero from '@/components/hero';
import { SyncBanner } from '@/components/states';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

export default function ProfileScreen({
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
        top={
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.surface} />
          </View>
        }
        title={user?.fullName ?? '—'}
        subtitle={[
          user?.maitId ? t('profile.maitId', { id: user.maitId }) : '',
          user?.mobileNo ?? '',
        ]
          .filter(Boolean)
          .join(' · ')}
      />

      <ScrollView contentContainerStyle={styles.body}>
        {pending > 0 ? (
          <SyncBanner
            tone="queued"
            title={t('home.queued', { count: pending })}
            body={t('home.queuedBody')}
            action={{ label: online ? t('home.sendNow') : t('home.view'), onPress: onSync }}
            testID="profile-queued"
          />
        ) : (
          <SyncBanner tone="synced" title={t('home.allSent')} testID="profile-synced" />
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('profile.yourMpps')}</Text>
          <Text style={styles.cardValue}>
            {mpps && mpps.length ? mpps.join(', ') : t('profile.noMpps')}
          </Text>
          <Text style={styles.cardFoot}>{t('profile.mppsFoot')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t('profile.language')}</Text>
          <View style={styles.languageRow}>
            <LanguageToggle />
          </View>
        </View>

        {/* Asked twice when work is waiting, and the reason is stated rather than implied. */}
        {confirming && (
          <SyncBanner
            tone="offline"
            title={t('profile.signOutWarnTitle', { count: pending })}
            body={t('profile.signOutWarnBody')}
            testID="signout-warning"
          />
        )}

        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
          testID="sign-out"
        >
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.signOutLabel}>
            {confirming ? t('profile.signOutAnyway') : t('profile.signOut')}
          </Text>
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
  // Translucent on the green, the same treatment the capture flow's back button uses.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { padding: spacing[5] },

  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  cardLabel: { ...typography.caption, color: colors.textMuted },
  cardValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 },
  cardFoot: { ...typography.caption, color: colors.textMuted, marginTop: spacing[2] },
  languageRow: { flexDirection: 'row', marginTop: spacing[3] },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  signOutPressed: { backgroundColor: colors.errorWash },
  signOutLabel: { ...typography.bodyStrong, color: colors.error },
  cancel: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { ...typography.bodyStrong, color: colors.primaryDark },
});
