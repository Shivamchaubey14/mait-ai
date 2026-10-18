/**
 * Exceptions, for an admin — the queues of things that are wrong right now (portal W-exceptions).
 *
 * Read off the dashboard summary, the same source the portal's cards use, so a count here and
 * the screen behind it cannot drift apart. Each queue is a card: how many, and a sample of
 * where to start. Read-only — acting on one is done on its own screen (a payment, an indent).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminDashboardSummaryQuery } from '@api/endpoints';
import type { DashboardExceptions, ExceptionGroup } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

const ORDER: { key: keyof DashboardExceptions; icon: string }[] = [
  { key: 'pending_payments', icon: 'cash' },
  { key: 'failed_otps', icon: 'warning' },
  { key: 'low_stock', icon: 'cube' },
  { key: 'stale_indents', icon: 'clipboard' },
  { key: 'overdue_checks', icon: 'heart-dislike' },
  { key: 'declined_checks', icon: 'close-circle' },
];

function sev(severity: string): { wash: string; border: string; tint: string } {
  if (severity === 'error') {return { wash: colors.errorWash, border: colors.error, tint: colors.error };}
  return { wash: colors.secondaryWash, border: yolk[300], tint: yolk[800] };
}

function Group({ group, title, icon }: { group: ExceptionGroup; title: string; icon: string }): React.JSX.Element {
  const { t } = useTranslation();
  const empty = group.count === 0;
  return (
    <View style={[styles.card, empty && styles.cardEmpty]} testID={`admin-exceptions-${title}`}>
      <View style={styles.cardHead}>
        <View style={[styles.cardChip, { backgroundColor: empty ? green[300] : colors.ink }]}>
          <Ionicons name={(empty ? 'checkmark' : icon) as never} size={16} color={colors.surface} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={[styles.cardCount, empty && styles.cardCountClear]}>
          <Text style={[styles.cardCountLabel, empty && styles.cardCountLabelClear]}>{group.count}</Text>
        </View>
      </View>
      {empty ? (
        <Text style={styles.clear}>{t('admin.exceptions.clear')}</Text>
      ) : (
        <>
          {group.rows.map((row, i) => (
            <View key={i} style={styles.rowLine}>
              <View style={[styles.dot, { backgroundColor: sev(row.severity).tint }]} />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {row.meta}
                </Text>
              </View>
            </View>
          ))}
          {group.more > 0 && <Text style={styles.more}>{t('admin.exceptions.more', { count: group.more })}</Text>}
        </>
      )}
    </View>
  );
}

export default function AdminExceptionsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminDashboardSummaryQuery();
  const exceptions = data.data?.exceptions;

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError ? (
          <EmptyState message={t('admin.exceptions.error')} />
        ) : !exceptions ? (
          <EmptyState message={t('admin.exceptions.none')} />
        ) : (
          ORDER.map(({ key, icon }) => {
            const group = exceptions[key];
            if (!group) {
              return null;
            }
            return <Group key={key} group={group} title={t(`admin.exceptions.${key}`)} icon={icon} />;
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },
  card: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[2],
  },
  cardEmpty: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...typography.h3, color: colors.ink, flex: 1 },
  cardCount: {
    minWidth: 28,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  cardCountClear: { backgroundColor: colors.primary },
  cardCountLabel: { ...typography.label, color: colors.surface },
  cardCountLabelClear: { color: colors.surface },
  clear: { ...typography.caption, color: colors.primaryDark },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowBody: { flex: 1 },
  rowLabel: { ...typography.body, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  more: { ...typography.caption, color: colors.textMuted, marginLeft: spacing[4] },
});
