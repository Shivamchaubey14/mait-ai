/**
 * Zones, for an admin — how the network is carved up (the portal's Zones screen).
 *
 * A zone is a set of plants, and what matters about it is how much it holds: the collection
 * points, the members, and the office accounts that see it. The record reads those back, plus
 * the BMC/MCCs it is made of. Read-only — a zone's membership and the accounts on it are a
 * deliberate write that reprices who sees what, and stays on the portal.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListZonesQuery } from '@api/endpoints';
import type { Zone } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, adminStyles } from './common';

function Record({ zone, onBack }: { zone: Zone; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={adminStyles.root}>
      <RecordHead title={zone.name} onBack={onBack} testID="admin-zone-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        <View style={[styles.banner, zone.is_active ? styles.on : styles.off]}>
          <Ionicons
            name={zone.is_active ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={zone.is_active ? colors.primaryDark : ink[500]}
          />
          <Text style={[styles.bannerLabel, { color: zone.is_active ? colors.primaryDark : ink[500] }]}>
            {t(zone.is_active ? 'admin.zones.active' : 'admin.zones.inactive')}
          </Text>
        </View>
        <Field label={t('admin.zones.fieldCode')} value={zone.code} />
        <Field label={t('admin.zones.fieldMpps')} value={String(zone.mpp_count)} />
        <Field label={t('admin.zones.fieldMembers')} value={zone.member_count.toLocaleString('en-IN')} />
        <Field label={t('admin.zones.fieldUsers')} value={String(zone.user_count)} />
        <Field label={t('admin.zones.fieldPlants')} value={zone.plant_names.join(', ')} />
        <Field label={t('admin.zones.fieldNote')} value={zone.description} />
      </ScrollView>
    </View>
  );
}

export default function AdminZonesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Zone | null>(null);
  const list = useAdminListZonesQuery();
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
    return <Record zone={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={[adminStyles.body, styles.body]}>
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.zones.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.zones.none')} />
        ) : (
          rows.map(zone => (
            <Pressable
              key={zone.id}
              accessibilityRole="button"
              onPress={() => setOpen(zone)}
              style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
              testID={`admin-zone-${zone.code}`}
            >
              <View style={adminStyles.rowChip}>
                <Ionicons name="map" size={18} color={colors.info} />
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {zone.name}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[zone.code, t('admin.zones.mpps', { count: zone.mpp_count })].filter(Boolean).join(' · ')}
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
  body: { paddingTop: spacing[4] },
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
});
