/**
 * Assignment, for an admin — who covers which collection point (the portal's Assignment screen).
 *
 * The bulk Mait ↔ MPP sheet is an .xlsx round-trip and stays on the portal; a note says so. What
 * the handset gives is the picture that sheet is edited against: the coverage summary, and the
 * points that need a decision, led from the top — because a point nobody covers, or one a Mait
 * covers but cannot sign in to serve, is the whole reason to open this, not the ones already
 * humming along.
 *
 * Zero coverage has three causes and three fixes, and the row says which it is: nobody assigned,
 * somebody assigned who cannot log in, or assigned-and-able-but-not-serving-yet. The screen
 * cannot tell them apart without the Mait's name and activation, so both ride on every row.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminMppCoverageQuery } from '@api/endpoints';
import type { MppCoverageRow } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, ink, radius, spacing, typography, yolk } from '@theme/tokens';

import { SearchBar, adminStyles, useDebounced } from './common';

type Standing = 'unassigned' | 'inactive' | 'served' | 'idle';

function standingOf(row: MppCoverageRow): Standing {
  if (!row.mait_name) {return 'unassigned';}
  if (!row.mait_activated) {return 'inactive';}
  return row.members_served > 0 ? 'served' : 'idle';
}

const LOOK: Record<Standing, { wash: string; tint: string; icon: string }> = {
  unassigned: { wash: colors.errorWash, tint: colors.error, icon: 'person-remove' },
  inactive: { wash: colors.secondaryWash, tint: yolk[800], icon: 'alert-circle' },
  idle: { wash: ink[50], tint: ink[500], icon: 'time' },
  served: { wash: colors.primaryWash, tint: colors.primaryDark, icon: 'checkmark-circle' },
};

// Actionable first: nobody on it, then assigned-but-locked-out, then assigned-and-idle, then the
// ones already working. Within a band, the thinnest coverage leads.
const RANK: Record<Standing, number> = { unassigned: 0, inactive: 1, idle: 2, served: 3 };

export default function AdminAssignmentScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim().toLowerCase());
  const data = useAdminMppCoverageQuery();
  const d = data.data;

  const rows = useMemo(() => {
    const all = d?.results ?? [];
    const filtered = search
      ? all.filter(r =>
          [r.mpp_name, r.mpp_code, r.mait_name, r.mait_code].join(' ').toLowerCase().includes(search),
        )
      : all;
    return [...filtered].sort((a, b) => {
      const byBand = RANK[standingOf(a)] - RANK[standingOf(b)];
      return byBand !== 0 ? byBand : a.coverage_percent - b.coverage_percent;
    });
  }, [d?.results, search]);

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={adminStyles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError || !d ? (
          <EmptyState message={t('admin.assignment.error')} />
        ) : (
          <>
            <View style={styles.tiles}>
              <Tile label={t('admin.assignment.points')} value={d.summary.mpps} />
              <Tile
                label={t('admin.assignment.coverage')}
                value={`${Math.round(d.summary.coverage_percent)}%`}
                tint={colors.primaryDark}
              />
              <Tile
                label={t('admin.assignment.atZero')}
                value={d.summary.mpps_at_zero}
                tint={d.summary.mpps_at_zero > 0 ? colors.error : colors.ink}
              />
            </View>

            <View style={styles.note}>
              <Ionicons name="desktop-outline" size={16} color={colors.info} />
              <Text style={styles.noteText}>{t('admin.assignment.deskNote')}</Text>
            </View>

            <SearchBar
              value={term}
              onChange={setTerm}
              placeholder={t('admin.assignment.searchPlaceholder')}
              testID="admin-assignment-search"
            />

            {rows.length === 0 ? (
              <EmptyState message={search ? t('admin.assignment.noneFound', { query: term.trim() }) : t('admin.assignment.none')} />
            ) : (
              rows.map(row => <Row key={row.mpp_code} row={row} />)
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ row }: { row: MppCoverageRow }): React.JSX.Element {
  const { t } = useTranslation();
  const standing = standingOf(row);
  const l = LOOK[standing];
  const holder =
    standing === 'unassigned'
      ? t('admin.assignment.nobody')
      : [row.mait_name, row.mait_code].filter(Boolean).join(' · ');

  return (
    <View style={adminStyles.row} testID={`admin-assignment-${row.mpp_code}`}>
      <View style={[adminStyles.rowChip, { backgroundColor: l.wash }]}>
        <Ionicons name={l.icon as never} size={18} color={l.tint} />
      </View>
      <View style={adminStyles.rowBody}>
        <Text style={adminStyles.rowName} numberOfLines={1}>
          {row.mpp_name}
        </Text>
        <Text style={adminStyles.rowMeta} numberOfLines={1}>
          {holder}
        </Text>
        <View style={styles.pills}>
          <View style={[styles.pill, { backgroundColor: l.wash }]}>
            <Text style={[styles.pillLabel, { color: l.tint }]}>{t(`admin.assignment.standing_${standing}`)}</Text>
          </View>
          <Text style={styles.served}>
            {t('admin.assignment.servedOf', { served: row.members_served, total: row.total_members })}
          </Text>
        </View>
      </View>
      <Text style={[styles.percent, { color: l.tint }]}>{Math.round(row.coverage_percent)}%</Text>
    </View>
  );
}

function Tile({ label, value, tint }: { label: string; value: number | string; tint?: string }): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, tint ? { color: tint } : null]} numberOfLines={1} adjustsFontSizeToFit>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: {
    flex: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
  },
  tileValue: { ...typography.h2, color: colors.ink },
  tileLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
  },
  noteText: { ...typography.caption, color: colors.info, flex: 1 },

  pills: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] },
  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },
  served: { ...typography.caption, color: colors.textMuted },
  percent: { ...typography.h3, alignSelf: 'center' },
});
