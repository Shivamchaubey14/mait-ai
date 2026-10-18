/**
 * Users & roles, for an admin — the portal accounts (the portal's W11 screen).
 *
 * Search by name, username or mobile; the record reads back what the account is and what it can
 * reach — its role, the sections it opens, the zones it sees, whether it can still sign in.
 * Read-only here: creating an account, changing a role, and switching a login on or off are
 * deliberate writes that stay on the portal and a later round.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListUsersQuery } from '@api/endpoints';
import type { AdminUser } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, SearchBar, adminStyles, useDebounced } from './common';

function Record({ user, onBack }: { user: AdminUser; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={adminStyles.root}>
      <RecordHead title={user.full_name || user.username} onBack={onBack} testID="admin-user-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        <View style={[styles.banner, user.is_active ? styles.on : styles.off]}>
          <Ionicons
            name={user.is_active ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={user.is_active ? colors.primaryDark : ink[500]}
          />
          <Text style={[styles.bannerLabel, { color: user.is_active ? colors.primaryDark : ink[500] }]}>
            {user.role_display} · {t(user.is_active ? 'admin.users.active' : 'admin.users.inactive')}
          </Text>
        </View>
        <Field label={t('admin.users.fieldUsername')} value={user.username} />
        <Field label={t('admin.users.fieldMobile')} value={user.mobile_no} />
        <Field label={t('admin.users.fieldEmail')} value={user.email} />
        <Field
          label={t('admin.users.fieldSections')}
          value={t('admin.users.sectionsOf', { have: user.portal_sections.length, total: user.portal_section_total })}
        />
        <Field label={t('admin.users.fieldZones')} value={user.zone_names.join(', ')} />
        <Field label={t('admin.users.fieldMait')} value={[user.mait_name, user.sahayak_vendor_code].filter(Boolean).join(' · ')} />
        <Field
          label={t('admin.users.fieldLastLogin')}
          value={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : t('admin.users.neverSignedIn')}
        />
      </ScrollView>
    </View>
  );
}

export default function AdminUsersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<AdminUser | null>(null);

  const list = useAdminListUsersQuery(search ? { search } : undefined);
  const rows = list.data?.results ?? [];

  useEffect(() => {
    if (!open) {return;}
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open) {
    return <Record user={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.users.searchPlaceholder')}
        testID="admin-users-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.users.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.users.noneFound', { query: search }) : t('admin.users.none')} />
        ) : (
          rows.map(user => (
            <Pressable
              key={user.id}
              accessibilityRole="button"
              onPress={() => setOpen(user)}
              style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
              testID={`admin-user-${user.username}`}
            >
              <View style={[adminStyles.rowChip, !user.is_active && styles.chipOff]}>
                <Ionicons name="shield-checkmark" size={18} color={user.is_active ? colors.info : ink[400]} />
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {user.full_name || user.username}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[user.role_display, user.username].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {!user.is_active && (
                <View style={styles.offPill}>
                  <Text style={styles.offLabel}>{t('admin.users.inactive')}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  on: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  off: { backgroundColor: ink[50], borderColor: ink[200] },
  bannerLabel: { ...typography.bodyStrong },
  chipOff: { backgroundColor: ink[50] },
  offPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: ink[50],
  },
  offLabel: { ...typography.caption, fontSize: 10, color: ink[500] },
});
