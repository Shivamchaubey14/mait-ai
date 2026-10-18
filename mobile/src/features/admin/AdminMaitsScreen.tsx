/**
 * Maits, for an admin — the portal's Mait roster on a handset.
 *
 * Search by name, vendor code or mobile; each row says where the account stands, because that
 * is the one thing the roster is read for: a Mait who never activated, one whose login is on,
 * and one it has been switched off for are three different states that look alike until the
 * pill says which. The record reads back their coverage — the collection points they hold.
 *
 * Read-only here. Activating a Mait and switching an account on or off are writes that live on
 * the Users screen, and come in a later round.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListMaitsQuery } from '@api/endpoints';
import type { AdminMait } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, SearchBar, adminStyles, useDebounced } from './common';

type Standing = 'active' | 'off' | 'inactive';

function standingOf(mait: AdminMait): Standing {
  if (!mait.activated) {return 'inactive';}
  return mait.account_active ? 'active' : 'off';
}

const LOOK: Record<Standing, { tone: string; wash: string; border: string }> = {
  active: { tone: colors.primaryDark, wash: colors.primaryWash, border: green[300] },
  off: { tone: colors.error, wash: colors.errorWash, border: colors.error },
  inactive: { tone: ink[500], wash: ink[50], border: ink[200] },
};

function Record({ mait, onBack }: { mait: AdminMait; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const standing = standingOf(mait);
  return (
    <View style={adminStyles.root}>
      <RecordHead title={mait.name} onBack={onBack} testID="admin-mait-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        <View style={[styles.banner, { backgroundColor: LOOK[standing].wash, borderColor: LOOK[standing].border }]}>
          <Text style={[styles.bannerLabel, { color: LOOK[standing].tone }]}>
            {t(`admin.maits.standing_${standing}`)}
          </Text>
        </View>
        <Field label={t('admin.maits.fieldCode')} value={mait.sahayak_vendor_code} />
        <Field label={t('admin.maits.fieldMobile')} value={mait.mobile_no || t('admin.maits.noMobile')} />
        <Field label={t('admin.maits.fieldCoverage')} value={t('admin.maits.coverage', { count: mait.mpp_count })} />
        <Field label={t('admin.maits.fieldPoints')} value={mait.mpp_codes.join(', ') || '—'} />
      </ScrollView>
    </View>
  );
}

export default function AdminMaitsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<AdminMait | null>(null);

  const list = useAdminListMaitsQuery({ search });
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
    return <Record mait={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.maits.searchPlaceholder')}
        testID="admin-maits-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.maits.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.maits.noneFound', { query: search }) : t('admin.maits.none')} />
        ) : (
          rows.map(mait => {
            const standing = standingOf(mait);
            return (
              <Pressable
                key={mait.id}
                accessibilityRole="button"
                onPress={() => setOpen(mait)}
                style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
                testID={`admin-mait-${mait.sahayak_vendor_code}`}
              >
                <View style={adminStyles.rowChip}>
                  <Ionicons name="person" size={18} color={colors.info} />
                </View>
                <View style={adminStyles.rowBody}>
                  <Text style={adminStyles.rowName} numberOfLines={1}>
                    {mait.name}
                  </Text>
                  <Text style={adminStyles.rowMeta} numberOfLines={1}>
                    {[mait.sahayak_vendor_code, t('admin.maits.coverage', { count: mait.mpp_count })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={[adminStyles.pill, { backgroundColor: LOOK[standing].wash, borderColor: LOOK[standing].border }]}>
                    <Text style={[adminStyles.pillLabel, { color: LOOK[standing].tone }]}>
                      {t(`admin.maits.standing_${standing}`)}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: spacing[3], borderRadius: radius.md, borderWidth: 1 },
  bannerLabel: { ...typography.bodyStrong },
});
