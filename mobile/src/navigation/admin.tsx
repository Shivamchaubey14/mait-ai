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
 * The whole portal surface is here now — every drawer section has a handset screen, the last
 * four (SAP upload, Assignment, Reports, Super OTP) landing in Round 7. The "coming soon"
 * branch below is kept only as the fall-through for an unknown key, not for any real section.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import AppText from '@/components/AppText';
import { ConfirmDialog } from '@/components/confirmDialog';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useLogoutMutation } from '@api/endpoints';
import AdminAssignmentScreen from '@/features/admin/AdminAssignmentScreen';
import AdminAuditScreen from '@/features/admin/AdminAuditScreen';
import AdminDashboardScreen from '@/features/admin/AdminDashboardScreen';
import AdminEventsScreen from '@/features/admin/AdminEventsScreen';
import AdminExceptionsScreen from '@/features/admin/AdminExceptionsScreen';
import AdminIndentsScreen from '@/features/admin/AdminIndentsScreen';
import AdminInventoryScreen from '@/features/admin/AdminInventoryScreen';
import AdminLeaderboardScreen from '@/features/admin/AdminLeaderboardScreen';
import AdminMaitPaymentScreen from '@/features/admin/AdminMaitPaymentScreen';
import AdminMaitsScreen from '@/features/admin/AdminMaitsScreen';
import AdminMembersScreen from '@/features/admin/AdminMembersScreen';
import AdminMppsScreen from '@/features/admin/AdminMppsScreen';
import AdminOtpPipelineScreen from '@/features/admin/AdminOtpPipelineScreen';
import AdminNonMembersScreen from '@/features/admin/AdminNonMembersScreen';
import AdminPregnancyScreen from '@/features/admin/AdminPregnancyScreen';
import AdminProductsScreen from '@/features/admin/AdminProductsScreen';
import AdminRatesScreen from '@/features/admin/AdminRatesScreen';
import AdminReportsScreen from '@/features/admin/AdminReportsScreen';
import AdminStoresScreen from '@/features/admin/AdminStoresScreen';
import AdminSuperOtpScreen from '@/features/admin/AdminSuperOtpScreen';
import AdminUploadsScreen from '@/features/admin/AdminUploadsScreen';
import AdminUsersScreen from '@/features/admin/AdminUsersScreen';
import AdminZonesScreen from '@/features/admin/AdminZonesScreen';
import AdminRail from '@/features/admin/AdminRail';
import { ADMIN_HOME, sectionFor, sectionName } from '@/features/admin/sections';
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

  const current = sectionFor(section);

  // Back returns to the home section, then leaves the app. A screen with an open record adds
  // its own handler, which runs before this one and wins.
  const goBack = useCallback((): boolean => {
    if (section !== ADMIN_HOME) {
      setSection(ADMIN_HOME);
      return true;
    }
    return false;
  }, [section]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => sub.remove();
  }, [goBack]);

  // Asked in our own card rather than the system alert — see components/confirmDialog.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const signOut = () => setConfirmingSignOut(true);
  const finishSignOut = async () => {
    try {
      if (refreshToken) {
        await logout(refreshToken).unwrap();
      }
    } catch {
      // The token is unreachable either way; a session left in storage is the worse one.
    }
    dispatch(loggedOut({ deliberate: true }));
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
  } else if (section === 'inventory') {
    screen = <AdminInventoryScreen />;
  } else if (section === 'products') {
    screen = <AdminProductsScreen />;
  } else if (section === 'indents') {
    screen = <AdminIndentsScreen />;
  } else if (section === 'stores') {
    screen = <AdminStoresScreen />;
  } else if (section === 'rates') {
    screen = <AdminRatesScreen />;
  } else if (section === 'leaderboard') {
    screen = <AdminLeaderboardScreen />;
  } else if (section === 'pregnancy') {
    screen = <AdminPregnancyScreen />;
  } else if (section === 'exceptions') {
    screen = <AdminExceptionsScreen onOpenSection={setSection} />;
  } else if (section === 'mait-payment') {
    screen = <AdminMaitPaymentScreen />;
  } else if (section === 'dashboard') {
    screen = <AdminDashboardScreen onOpenExceptions={() => setSection('exceptions')} />;
  } else if (section === 'users') {
    screen = <AdminUsersScreen />;
  } else if (section === 'zones') {
    screen = <AdminZonesScreen onOpenSection={setSection} />;
  } else if (section === 'logs') {
    screen = <AdminAuditScreen />;
  } else if (section === 'super-otp') {
    screen = <AdminSuperOtpScreen />;
  } else if (section === 'otp-pipeline') {
    screen = <AdminOtpPipelineScreen onOpenSection={setSection} />;
  } else if (section === 'uploads') {
    screen = <AdminUploadsScreen />;
  } else if (section === 'assignments') {
    screen = <AdminAssignmentScreen />;
  } else if (section === 'reports') {
    screen = <AdminReportsScreen />;
  } else {
    screen = (
      <View style={styles.soonBody} testID="admin-section-soon">
        <View style={styles.soonChip}>
          <Ionicons name={current.icon} size={28} color={colors.info} />
        </View>
        <AppText style={styles.soonTitle}>{sectionName(t, current)}</AppText>
        <AppText style={styles.soonText}>{t('admin.sectionSoon')}</AppText>
      </View>
    );
  }

  return (
    // The sections down the left, always in view, the way the portal's aside is; the open
    // section beside them. There is no menu to open.
    <View style={styles.root}>
      <AdminRail activeKey={section} onSelect={setSection} onSignOut={signOut} />

      <View style={styles.flex}>
        <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
          <AppText style={styles.barTitle} numberOfLines={1} testID="admin-title">
            {sectionName(t, current)}
          </AppText>
          <AppText style={styles.barWho} numberOfLines={1}>
            {[user?.fullName, t(ROLE_LABEL[user?.role ?? 'admin'] ?? 'admin.role.admin')]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </View>

        <View style={styles.flex}>{screen}</View>
      </View>
      <ConfirmDialog
        visible={confirmingSignOut}
        title={t('admin.signOutTitle')}
        body={t('admin.signOutBody')}
        confirmLabel={t('settings.signOut')}
        cancelLabel={t('common.cancel')}
        onConfirm={finishSignOut}
        onCancel={() => setConfirmingSignOut(false)}
        testID="admin-sign-out-dialog"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  flex: { flex: 1 },

  bar: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.ink,
    // Square on the left, where it meets the rail; rounded only at the open end.
    borderBottomRightRadius: radius.lg,
  },
  barTitle: { ...typography.h2, color: colors.surface },
  barWho: { ...typography.caption, color: colors.surface, opacity: 0.72 },

  soonBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[3],
  },
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
