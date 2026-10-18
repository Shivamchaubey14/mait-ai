/**
 * The admin shell.
 *
 * The fourth app on the same sign-in, beside the Mait's, the keeper's and the manager's: an
 * office account on a handset, with the portal's surface behind a hamburger. A top bar with the
 * drawer button and the section's name; the drawer is the portal's aside (`features/admin`), a
 * scrollable list of every section; and below the bar, the section itself.
 *
 * Kept a sibling of the other navigators for the reason `Shell` gives — a navigator is a pile of
 * state, and signing out unmounts it rather than resetting twenty flags by hand. It mounts only
 * for an office account that is not a zonal manager (a manager gets the zonal app instead).
 *
 * This round builds AI events and Members; the rest of the drawer is visible and opens a short
 * note that it is on the way, so the whole surface is navigable while it is filled in.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useLogoutMutation } from '@api/endpoints';
import AdminDrawer from '@/features/admin/AdminDrawer';
import AdminEventsScreen from '@/features/admin/AdminEventsScreen';
import AdminMaitsScreen from '@/features/admin/AdminMaitsScreen';
import AdminMembersScreen from '@/features/admin/AdminMembersScreen';
import AdminMppsScreen from '@/features/admin/AdminMppsScreen';
import AdminNonMembersScreen from '@/features/admin/AdminNonMembersScreen';
import { ADMIN_HOME, sectionFor } from '@/features/admin/sections';
import { loggedOut } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, radius, spacing, typography } from '@theme/tokens';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'admin.role.superAdmin',
  admin: 'admin.role.admin',
  normal_user: 'admin.role.normalUser',
};

export default function AdminNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();

  const user = useAppSelector(state => state.auth.user);
  const refreshToken = useAppSelector(state => state.auth.refreshToken);
  const [logout] = useLogoutMutation();

  const [section, setSection] = useState<string>(ADMIN_HOME);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const current = sectionFor(section);

  // Back closes the drawer first, then returns to the home section, then leaves the app. A
  // screen with an open record adds its own handler, which runs before this one and wins.
  const goBack = useCallback((): boolean => {
    if (drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
    if (section !== ADMIN_HOME) {
      setSection(ADMIN_HOME);
      return true;
    }
    return false;
  }, [drawerOpen, section]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]);

  const signOut = () => {
    Alert.alert(t('admin.signOutTitle'), t('admin.signOutBody'), [
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
            // The token is unreachable either way; a session left in storage is the worse one.
          }
          dispatch(loggedOut());
        },
      },
    ]);
  };

  let screen: React.JSX.Element;
  if (section === 'ai-events') {
    screen = <AdminEventsScreen />;
  } else if (section === 'members') {
    screen = <AdminMembersScreen />;
  } else if (section === 'maits') {
    screen = <AdminMaitsScreen />;
  } else if (section === 'mpps') {
    screen = <AdminMppsScreen />;
  } else if (section === 'non-members') {
    screen = <AdminNonMembersScreen />;
  } else {
    screen = (
      <View style={styles.soonBody} testID="admin-section-soon">
        <View style={styles.soonChip}>
          <Ionicons name={current.icon} size={28} color={colors.info} />
        </View>
        <Text style={styles.soonTitle}>{current.label}</Text>
        <Text style={styles.soonText}>{t('admin.sectionSoon')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('admin.openMenu')}
          onPress={() => setDrawerOpen(true)}
          hitSlop={8}
          style={styles.hamburger}
          testID="admin-hamburger"
        >
          <Ionicons name="menu" size={24} color={colors.surface} />
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>
          {current.label}
        </Text>
      </View>

      <View style={styles.flex}>{screen}</View>

      <AdminDrawer
        visible={drawerOpen}
        activeKey={section}
        name={user?.fullName ?? ''}
        roleLabel={t(ROLE_LABEL[user?.role ?? 'admin'] ?? 'admin.role.admin')}
        onSelect={key => {
          setSection(key);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
        onSignOut={() => {
          setDrawerOpen(false);
          signOut();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  hamburger: { padding: spacing[1] },
  barTitle: { ...typography.h2, color: colors.surface, flex: 1 },

  soonBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6], gap: spacing[3] },
  soonChip: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  soonTitle: { ...typography.h2, color: colors.ink },
  soonText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
});
