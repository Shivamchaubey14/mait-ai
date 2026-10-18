/**
 * Inventory, for an admin — straw holding across every Mait (the portal's oversight screen).
 *
 * The question it answers is who is about to run out: a Mait at zero cannot record an event at
 * all, and one under the threshold cannot start many more. So the summary leads with those two
 * counts and the list is ordered emptiest first — the people to ring are at the top, not buried
 * under whoever happens to be carrying the most.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminInventoryOversightQuery } from '@api/endpoints';
import type { InventoryOversightRow } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

function tone(total: number, threshold: number): { wash: string; border: string; tint: string } {
  if (total === 0) {return { wash: colors.errorWash, border: colors.error, tint: colors.error };}
  if (total <= threshold) {return { wash: colors.secondaryWash, border: yolk[300], tint: yolk[800] };}
  return { wash: colors.primaryWash, border: green[300], tint: colors.primaryDark };
}

function Row({ row, threshold }: { row: InventoryOversightRow; threshold: number }): React.JSX.Element {
  const look = tone(row.total, threshold);
  const breeds = Object.entries(row.by_breed)
    .map(([breed, qty]) => `${breed} ${qty}`)
    .join(' · ');
  return (
    <View style={adminStyles.row} testID={`admin-inventory-${row.sahayak_vendor_code}`}>
      <View style={[styles.count, { backgroundColor: look.wash, borderColor: look.border }]}>
        <Text style={[styles.countValue, { color: look.tint }]}>{row.total}</Text>
      </View>
      <View style={adminStyles.rowBody}>
        <Text style={adminStyles.rowName} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={adminStyles.rowMeta} numberOfLines={1}>
          {breeds || row.sahayak_vendor_code}
        </Text>
      </View>
    </View>
  );
}

export default function AdminInventoryScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminInventoryOversightQuery();
  const summary = data.data?.summary;
  const rows = data.data?.results ?? [];
  const threshold = summary?.low_stock_threshold ?? 0;

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.inventory.error')} />
        ) : (
          <>
            {summary && (
              <View style={styles.tiles}>
                <Tile label={t('admin.inventory.atZero')} value={summary.at_zero} kind="bad" />
                <Tile label={t('admin.inventory.low')} value={summary.low} kind="warn" />
                <Tile label={t('admin.inventory.maits')} value={summary.maits} kind="info" />
                <Tile label={t('admin.inventory.straws')} value={summary.total_straws} kind="good" />
              </View>
            )}
            {rows.length === 0 ? (
              <EmptyState message={t('admin.inventory.none')} />
            ) : (
              rows.map(row => <Row key={row.mait_id} row={row} threshold={threshold} />)
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type TileKind = 'bad' | 'warn' | 'info' | 'good';
const TILE: Record<TileKind, { wash: string; border: string; tint: string; icon: string }> = {
  bad: { wash: colors.errorWash, border: colors.error, tint: colors.error, icon: 'alert-circle' },
  warn: { wash: colors.secondaryWash, border: yolk[300], tint: yolk[800], icon: 'time' },
  info: { wash: colors.infoWash, border: colors.info, tint: colors.info, icon: 'people' },
  good: { wash: colors.primaryWash, border: green[300], tint: colors.primaryDark, icon: 'cube' },
};

function Tile({ label, value, kind }: { label: string; value: number; kind: TileKind }): React.JSX.Element {
  const look = TILE[kind];
  return (
    <View style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}>
      <Ionicons name={look.icon as never} size={16} color={look.tint} />
      <Text style={[styles.tileValue, { color: look.tint }]}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    alignItems: 'flex-start',
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
  },
  tileValue: { ...typography.h1, color: colors.ink },
  tileLabel: { ...typography.caption, color: colors.textMuted },

  count: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countValue: { ...typography.h3, color: ink[500] },
});
