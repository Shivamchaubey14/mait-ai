/**
 * Dashboard, for an admin — the network at a glance (the portal's home).
 *
 * The numbers an office account opens the app to see: inseminations today and how that compares
 * with yesterday, the week, the month and all time; the conception rate the platform is
 * ultimately judged on; and how many things are wrong right now. Read-only — each figure has a
 * screen behind it (AI events, Pregnancy, Exceptions) for the detail.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminDashboardSummaryQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { adminStyles } from './common';

export default function AdminDashboardScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminDashboardSummaryQuery();
  const d = data.data;

  const exceptionsTotal = d
    ? d.exceptions.pending_payments.count + d.exceptions.failed_otps.count + d.exceptions.low_stock.count
    : 0;

  const delta = d?.today_delta_percent;

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError || !d ? (
          <EmptyState message={t('admin.dashboard.error')} />
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroValue}>{d.today}</Text>
              <Text style={styles.heroLabel}>{t('admin.dashboard.today')}</Text>
              {delta !== null && delta !== undefined && (
                <View style={[styles.delta, delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                  <Ionicons name={delta >= 0 ? 'trending-up' : 'trending-down'} size={13} color={colors.surface} />
                  <Text style={styles.deltaLabel}>{`${delta >= 0 ? '+' : ''}${delta}%`}</Text>
                </View>
              )}
            </View>

            <View style={styles.tiles}>
              <Tile label={t('admin.dashboard.week')} value={d.this_week} />
              <Tile label={t('admin.dashboard.month')} value={d.this_month} />
              <Tile label={t('admin.dashboard.lifetime')} value={d.lifetime} />
            </View>

            <View style={styles.cards}>
              <Card
                icon="heart"
                tint={colors.primaryDark}
                wash={colors.primaryWash}
                title={t('admin.dashboard.conception')}
                value={d.pregnancy.rate !== null ? `${Math.round(d.pregnancy.rate)}%` : '—'}
                meta={t('admin.dashboard.recorded', { count: d.pregnancy.recorded })}
              />
              <Card
                icon="alert-circle"
                tint={exceptionsTotal > 0 ? colors.error : colors.primaryDark}
                wash={exceptionsTotal > 0 ? colors.errorWash : colors.primaryWash}
                title={t('admin.dashboard.exceptions')}
                value={String(exceptionsTotal)}
                meta={exceptionsTotal > 0 ? t('admin.dashboard.needAttention') : t('admin.dashboard.allClear')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Tile({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value.toLocaleString('en-IN')}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function Card({
  icon,
  tint,
  wash,
  title,
  value,
  meta,
}: {
  icon: string;
  tint: string;
  wash: string;
  title: string;
  value: string;
  meta: string;
}): React.JSX.Element {
  return (
    <View style={[styles.card, { backgroundColor: wash }]}>
      <Ionicons name={icon as never} size={20} color={tint} />
      <Text style={[styles.cardValue, { color: tint }]}>{value}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardMeta}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },
  hero: {
    alignItems: 'center',
    padding: spacing[5],
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },
  heroValue: { ...typography.display, fontSize: 56, lineHeight: 62, color: colors.surface },
  heroLabel: { ...typography.body, color: colors.surface, opacity: 0.72 },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  deltaUp: { backgroundColor: colors.primary },
  deltaDown: { backgroundColor: colors.error },
  deltaLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.surface },

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

  cards: { flexDirection: 'row', gap: spacing[2] },
  card: {
    flex: 1,
    padding: spacing[4],
    borderRadius: radius.lg,
    gap: 2,
    alignItems: 'flex-start',
  },
  cardValue: { ...typography.h1 },
  cardTitle: { ...typography.bodyStrong, color: colors.ink },
  cardMeta: { ...typography.caption, color: colors.textMuted },
});
