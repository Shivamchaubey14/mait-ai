/**
 * Stores, for an admin — the depots an approved indent goes to, and who stands at the counter.
 *
 * Search by name or code; the record reads back which BMC/MCCs the depot serves, who keeps it,
 * and how many indents are waiting there. Read-only — setting which plants a store serves, and
 * who keeps it, is a desk action for a later round.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListStoresQuery } from '@api/endpoints';
import type { StoreAdmin } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, SearchBar, adminStyles, useDebounced } from './common';

function Record({ store, onBack }: { store: StoreAdmin; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const keepers = store.keepers.map(k => k.full_name).filter(Boolean).join(', ');
  return (
    <View style={adminStyles.root}>
      <RecordHead title={store.name} onBack={onBack} testID="admin-store-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        <View style={[styles.banner, store.is_active ? styles.on : styles.off]}>
          <Ionicons
            name={store.is_active ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={store.is_active ? colors.primaryDark : ink[500]}
          />
          <Text style={[styles.bannerLabel, { color: store.is_active ? colors.primaryDark : ink[500] }]}>
            {t(store.is_active ? 'admin.stores.active' : 'admin.stores.inactive')}
          </Text>
        </View>
        <Field label={t('admin.stores.fieldCode')} value={store.code} />
        <Field label={t('admin.stores.fieldZone')} value={store.zone_name} />
        <Field label={t('admin.stores.fieldPlants')} value={store.plant_names.join(', ')} />
        <Field label={t('admin.stores.fieldMpps')} value={String(store.mpp_count)} />
        <Field label={t('admin.stores.fieldKeepers')} value={keepers || t('admin.stores.noKeepers')} />
        <Field label={t('admin.stores.fieldOpen')} value={String(store.open_indents)} />
        <Field label={t('admin.stores.fieldNote')} value={store.description} />
      </ScrollView>
    </View>
  );
}

export default function AdminStoresScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<StoreAdmin | null>(null);

  const list = useAdminListStoresQuery(search ? { search } : undefined);
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
    return <Record store={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.stores.searchPlaceholder')}
        testID="admin-stores-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.stores.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.stores.noneFound', { query: search }) : t('admin.stores.none')} />
        ) : (
          rows.map(store => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              onPress={() => setOpen(store)}
              style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
              testID={`admin-store-${store.code}`}
            >
              <View style={adminStyles.rowChip}>
                <Ionicons name="storefront" size={18} color={colors.info} />
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {store.name}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[store.code, store.zone_name, t('admin.stores.mpps', { count: store.mpp_count })]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {store.open_indents > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{store.open_indents}</Text>
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
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondary,
  },
  badgeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },
});
