/**
 * Leaderboard, for an admin — who did the most this period (the portal's W12 screen).
 *
 * Ranked by inseminations, because that is what the dairy counts; the cash each brought in sits
 * beside it so volume is read with what it earned rather than on its own. Read-only. The period
 * is the server's default window; a date picker is a later refinement.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAdminLeaderboardQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, ink, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

function rupees(value: number): string {
  return `₹ ${Math.round(value).toLocaleString('en-IN')}`;
}

export default function AdminLeaderboardScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const board = useAdminLeaderboardQuery();
  const rows = board.data?.results ?? [];

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {board.isLoading ? (
          <Loading />
        ) : board.isError ? (
          <EmptyState message={t('admin.leaderboard.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.leaderboard.none')} />
        ) : (
          rows.map((row, index) => (
            <View key={row.mait_id} style={adminStyles.row} testID={`admin-leader-${row.sahayak_vendor_code}`}>
              <View style={[styles.rank, index < 3 && styles.rankTop]}>
                <Text style={[styles.rankLabel, index < 3 && styles.rankLabelTop]}>{index + 1}</Text>
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[row.sahayak_vendor_code, rupees(row.collected)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={styles.count}>
                <Text style={styles.countValue}>{row.ai_count}</Text>
                <Text style={styles.countLabel}>{t('admin.leaderboard.ai')}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },
  rank: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ink[50],
  },
  rankTop: { backgroundColor: yolk[500] },
  rankLabel: { ...typography.label, color: ink[500] },
  rankLabelTop: { color: colors.ink },
  count: { alignItems: 'flex-end', minWidth: 44 },
  countValue: { ...typography.h2, color: colors.primaryDark },
  countLabel: { ...typography.caption, fontSize: 10, color: colors.textMuted },
});
