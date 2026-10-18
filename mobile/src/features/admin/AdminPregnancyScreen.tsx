/**
 * Pregnancy, for an admin — conception and the checks nobody has walked (the portal's screen).
 *
 * The other half of how a Mait is judged: the leaderboard counts what was sold, this counts
 * what it achieved. The summary leads with what is overdue, because an unwalked check is work
 * not done; the per-Mait rows are ordered most-overdue first. Read-only.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminPregnancyOversightQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

function pct(pregnant: number, recorded: number): string {
  if (!recorded) {return '—';}
  return `${Math.round((pregnant / recorded) * 100)}%`;
}

export default function AdminPregnancyScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminPregnancyOversightQuery();
  const summary = data.data?.summary;
  const rows = data.data?.results ?? [];

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.pregnancy.error')} />
        ) : !summary ? (
          <EmptyState message={t('admin.pregnancy.none')} />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label={t('admin.pregnancy.overdue')} value={String(summary.overdue)} kind="bad" />
              <Tile label={t('admin.pregnancy.open')} value={String(summary.open)} kind="warn" />
              <Tile label={t('admin.pregnancy.recorded')} value={String(summary.recorded)} kind="info" />
              <Tile label={t('admin.pregnancy.conception')} value={pct(summary.pregnant, summary.recorded)} kind="good" />
            </View>

            {rows.map(row => (
              <View key={row.mait_id} style={adminStyles.row} testID={`admin-pregnancy-${row.sahayak_vendor_code}`}>
                <View style={adminStyles.rowBody}>
                  <Text style={adminStyles.rowName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={adminStyles.rowMeta} numberOfLines={1}>
                    {[
                      t('admin.pregnancy.overdueN', { count: row.overdue }),
                      t('admin.pregnancy.openN', { count: row.open }),
                      t('admin.pregnancy.conceptionN', { pct: pct(row.pregnant, row.recorded) }),
                    ].join(' · ')}
                  </Text>
                </View>
                {row.overdue > 0 && (
                  <View style={styles.badge}>
                    <Ionicons name="alert-circle" size={13} color={colors.error} />
                    <Text style={styles.badgeLabel}>{row.overdue}</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type Kind = 'bad' | 'warn' | 'info' | 'good';
const TILE: Record<Kind, { wash: string; border: string; tint: string }> = {
  bad: { wash: colors.errorWash, border: colors.error, tint: colors.error },
  warn: { wash: colors.secondaryWash, border: yolk[300], tint: yolk[800] },
  info: { wash: colors.infoWash, border: colors.info, tint: colors.info },
  good: { wash: colors.primaryWash, border: green[300], tint: colors.primaryDark },
};

function Tile({ label, value, kind }: { label: string; value: string; kind: Kind }): React.JSX.Element {
  const look = TILE[kind];
  return (
    <View style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}>
      <Text style={[styles.tileValue, { color: look.tint }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
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
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  tileValue: { ...typography.h1, color: colors.ink },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.errorWash,
    borderWidth: 1,
    borderColor: colors.error,
  },
  badgeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.error },
});
