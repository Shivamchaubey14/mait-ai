/**
 * Profile, for a store keeper.
 *
 * Shorter than a Mait's, because a keeper has less to look up about themselves: which store
 * this account works, which BMC/MCCs send their Maits here, the language, and the way out.
 * The Mait's figures — inseminations, cash, PDs — mean nothing behind a counter, and a screen
 * of zeros under those headings would read as an account that is broken.
 */

import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useGetStoreHomeQuery, useLogoutMutation } from '@api/endpoints';
import { SignOutButton } from '@/components';
import { LanguageToggle } from '@/components/brand';
import PageHero from '@/components/hero';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { storeStyles } from './parts';

function Row({
  title,
  body,
  right,
  testID,
}: {
  title: string;
  body?: string;
  right?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!body && <Text style={styles.rowText}>{body}</Text>}
      </View>
      {right}
    </View>
  );
}

export default function StoreProfileScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);
  const home = useGetStoreHomeQuery();
  const [logout] = useLogoutMutation();

  const store = home.data?.store;
  const plants = store?.plant_names ?? [];

  const signOut = () => {
    Alert.alert(t('store.signOutTitle'), t('store.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: async () => {
          try {
            if (refreshToken) {
              await logout(refreshToken).unwrap();
            }
          } catch {
            // The token is unreachable either way; a session left in storage is the worse outcome.
          }
          dispatch(loggedOut());
        },
      },
    ]);
  };

  return (
    <View style={storeStyles.root}>
      <PageHero
        title={user?.fullName ?? ''}
        subtitle={[t('store.profileRole'), user?.mobileNo].filter(Boolean).join(' · ')}
      />

      <ScrollView contentContainerStyle={storeStyles.body}>
        <Row
          title={t('store.yourStore')}
          body={store ? `${store.name} · ${store.code}` : (user?.storeName ?? '—')}
          testID="profile-store"
        />
        <Row
          title={t('store.serves')}
          body={plants.length ? plants.join(', ') : t('store.servesNone')}
          testID="profile-serves"
        />
        <Row
          title={t('settings.language')}
          right={<LanguageToggle variant="light" />}
          testID="profile-language"
        />

        <SignOutButton label={t('settings.signOut')} onPress={signOut} testID="profile-sign-out" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
