/**
 * MPPs, for an admin — the portal's collection-point roster on a handset.
 *
 * Search by TR code or name; the record reads the point back whole, the Mait that holds it
 * included, because "who covers this point" is the question a reassignment turns on and the one
 * this screen most often answers. Read-only — moving a point is the zonal manager's write, and
 * the Assignment screen's, and comes in a later round.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useGetMppQuery, useListMppsQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, SearchBar, adminStyles, useDebounced } from './common';

function Record({ mppId, onBack }: { mppId: number; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetMppQuery(mppId);
  const mpp = detail.data;
  return (
    <View style={adminStyles.root}>
      <RecordHead title={mpp?.mpp_name ?? t('admin.mpps.record')} onBack={onBack} testID="admin-mpp-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        {detail.isLoading ? (
          <Loading />
        ) : !mpp ? (
          <EmptyState message={t('admin.mpps.recordMissing')} />
        ) : (
          <>
            <View style={[styles.banner, mpp.is_active ? styles.bannerOn : styles.bannerOff]}>
              <Ionicons
                name={mpp.is_active ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={mpp.is_active ? colors.primaryDark : ink[500]}
              />
              <Text style={[styles.bannerLabel, { color: mpp.is_active ? colors.primaryDark : ink[500] }]}>
                {t(mpp.is_active ? 'admin.mpps.active' : 'admin.mpps.inactive')}
              </Text>
            </View>
            <Field label={t('admin.mpps.fieldCode')} value={mpp.mpp_code} />
            <Field label={t('admin.mpps.fieldPlant')} value={[mpp.plant_name, mpp.plant_code].filter(Boolean).join(' · ')} />
            <Field label={t('admin.mpps.fieldMait')} value={mpp.mait_name || t('admin.mpps.noMait')} />
            <Field label={t('admin.mpps.fieldMembers')} value={String(mpp.member_count)} />
            <Field label={t('admin.mpps.fieldMobile')} value={mpp.mobile_no} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AdminMppsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<number | null>(null);

  const list = useListMppsQuery(search ? { search } : undefined);
  const rows = list.data?.results ?? [];

  useEffect(() => {
    if (open === null) {return;}
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open !== null) {
    return <Record mppId={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.mpps.searchPlaceholder')}
        testID="admin-mpps-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.mpps.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.mpps.noneFound', { query: search }) : t('admin.mpps.none')} />
        ) : (
          rows.map(mpp => (
            <Pressable
              key={mpp.id}
              accessibilityRole="button"
              onPress={() => setOpen(mpp.id)}
              style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
              testID={`admin-mpp-${mpp.mpp_code}`}
            >
              <View style={adminStyles.rowChip}>
                <Ionicons name="location" size={18} color={colors.info} />
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {mpp.mpp_name}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[mpp.mpp_code, mpp.mait_name || t('admin.mpps.noMait')].filter(Boolean).join(' · ')}
                </Text>
              </View>
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
  bannerOn: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  bannerOff: { backgroundColor: ink[50], borderColor: ink[200] },
  bannerLabel: { ...typography.bodyStrong },
});
