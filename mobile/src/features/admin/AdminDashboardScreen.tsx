/**
 * The admin's dashboard on a handset — the portal's front page (index.html), where an office
 * account lands after signing in.
 *
 * The same three reads the portal makes: the summary (the counts, the conception rate and the
 * exception queues), the daily trend, and each zone's share. Read in that order of importance
 * down the page: how much was done today and over time; whether it worked; how the days and
 * the zones compare; and what needs a person now.
 *
 * The chart is plain views — a row of bars is a row of rectangles, and a charting library is a
 * second of cold start on the handsets this runs on.
 */

import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import {
  useAdminDashboardSummaryQuery,
  useAdminDashboardTrendsQuery,
  useAdminZonePerformanceQuery,
} from '@api/endpoints';
import type { DashboardExceptions, DashboardTrendDay, ExceptionGroup } from '@api/types';
import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonBoard } from '@/components/skeleton';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

/** The windows the chart and the zones can be read over. */
const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

/** The queues, in the order the portal lists them: money first, then the field, then checks. */
const QUEUES: { key: keyof DashboardExceptions; icon: string }[] = [
  { key: 'pending_payments', icon: 'cash' },
  { key: 'failed_otps', icon: 'warning' },
  { key: 'low_stock', icon: 'cube' },
  { key: 'stale_indents', icon: 'clipboard' },
  { key: 'overdue_checks', icon: 'heart-dislike' },
  { key: 'declined_checks', icon: 'close-circle' },
];

/** As many of a queue's rows as a card shows before "+N more". */
const ROWS_SHOWN = 2;

const CHART_HEIGHT = 120;

export default function AdminDashboardScreen({
  onOpenExceptions,
}: {
  /** Opens the Exceptions section, where every row of every queue is listed. */
  onOpenExceptions?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [days, setDays] = useState<Range>(7);

  const summary = useAdminDashboardSummaryQuery();
  const trends = useAdminDashboardTrendsQuery({ days });
  const zones = useAdminZonePerformanceQuery({ days });
  const d = summary.data;

  const refreshing = summary.isFetching || trends.isFetching || zones.isFetching;
  const refresh = () => {
    summary.refetch();
    trends.refetch();
    zones.refetch();
  };

  if (summary.isLoading) {
    return (
      <View style={adminStyles.root}>
        <SkeletonBoard />
      </View>
    );
  }

  // A summary without its pregnancy block is a server this build does not understand (an older
  // one mid-rollout, say). Said as a failed load rather than read into, which threw during
  // render and took the whole app down with this one screen.
  if (summary.isError || !d || !d.pregnancy) {
    return (
      <View style={adminStyles.root}>
        <EmptyState message={t('admin.dashboard.error')} />
      </View>
    );
  }

  const delta = d.today_delta_percent;
  const rate = d.pregnancy.conception_rate;

  return (
    <View style={adminStyles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        testID="admin-dashboard"
      >
        {/* Today, which is the number this product exists to produce. */}
        <View style={styles.hero}>
          <AppText style={styles.heroLabel}>{t('admin.dashboard.aiToday')}</AppText>
          <AppText style={styles.heroValue} testID="dashboard-today">
            {d.today.toLocaleString('en-IN')}
          </AppText>
          {delta !== null && delta !== undefined && (
            <View style={[styles.delta, delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
              <Ionicons
                name={delta >= 0 ? 'trending-up' : 'trending-down'}
                size={13}
                color={colors.surface}
              />
              <AppText style={styles.deltaLabel}>
                {t('admin.dashboard.vsYesterday', { delta: `${delta >= 0 ? '+' : ''}${delta}%` })}
              </AppText>
            </View>
          )}
        </View>

        {/* Over time, and whether it worked. */}
        <View style={styles.tiles}>
          <Tile
            icon="calendar"
            tone="info"
            label={t('admin.dashboard.week')}
            value={d.this_week.toLocaleString('en-IN')}
            testID="dashboard-week"
          />
          <Tile
            icon="calendar-number"
            tone="info"
            label={t('admin.dashboard.month')}
            value={d.this_month.toLocaleString('en-IN')}
            testID="dashboard-month"
          />
        </View>
        <View style={styles.tiles}>
          <Tile
            icon="infinite"
            tone="plain"
            label={t('admin.dashboard.lifetime')}
            value={d.lifetime.toLocaleString('en-IN')}
            foot={d.since ? t('admin.dashboard.since', { since: d.since }) : undefined}
            testID="dashboard-lifetime"
          />
          <Tile
            icon="heart"
            tone="good"
            label={t('admin.dashboard.conception')}
            value={rate !== null && rate !== undefined ? `${Math.round(rate)}%` : '—'}
            foot={
              d.pregnancy.decided > 0
                ? t('admin.dashboard.conceivedOf', {
                    conceived: d.pregnancy.conceived,
                    decided: d.pregnancy.decided,
                  })
                : t('admin.dashboard.noChecks')
            }
            testID="dashboard-conception"
          />
        </View>

        {/* The window the chart and the zones are both read over. */}
        <View style={styles.ranges}>
          {RANGES.map(range => (
            <Pressable
              key={range}
              accessibilityRole="button"
              accessibilityState={{ selected: range === days }}
              onPress={() => setDays(range)}
              style={[styles.range, range === days && styles.rangeOn]}
              testID={`dashboard-range-${range}`}
            >
              <AppText style={[styles.rangeLabel, range === days && styles.rangeLabelOn]}>
                {t('admin.dashboard.days', { count: range })}
              </AppText>
            </Pressable>
          ))}
        </View>

        <Panel title={t('admin.dashboard.trendTitle')} icon="bar-chart">
          {trends.data ? (
            <Chart days={trends.data.results} />
          ) : (
            <View style={styles.chartPlaceholder} />
          )}
          <View style={styles.legend}>
            <Swatch color={colors.primary} label={t('admin.dashboard.completed')} />
            <Swatch color={yolk[400]} label={t('admin.dashboard.pending')} />
          </View>
          {!!d.highest_day && (
            <AppText style={styles.panelFoot}>
              {t('admin.dashboard.bestDay', {
                value: d.highest_day.value,
                label: d.highest_day.label,
              })}
            </AppText>
          )}
        </Panel>

        <Panel title={t('admin.dashboard.zonesTitle')} icon="map">
          {(zones.data?.results ?? []).length === 0 ? (
            <AppText style={styles.panelFoot}>{t('admin.dashboard.noZones')}</AppText>
          ) : (
            (zones.data?.results ?? []).map(zone => (
              <View key={zone.code} style={styles.zone} testID={`dashboard-zone-${zone.code}`}>
                <View style={styles.zoneHead}>
                  <AppText style={styles.zoneName}>{zone.name}</AppText>
                  <AppText style={styles.zoneCount}>
                    {t('admin.dashboard.zoneEvents', { count: zone.events })}
                  </AppText>
                </View>
                <View style={styles.zoneTrack}>
                  <View
                    style={[styles.zoneFill, { width: `${Math.max(0, zone.share_percent)}%` }]}
                  />
                </View>
              </View>
            ))
          )}
        </Panel>

        {/* What needs a person now. */}
        <View style={styles.attentionHead}>
          <AppText style={styles.sectionTitle}>{t('admin.dashboard.attentionTitle')}</AppText>
          {!!onOpenExceptions && (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenExceptions}
              testID="dashboard-open-exceptions"
            >
              <AppText style={styles.link}>{t('admin.dashboard.openExceptions')}</AppText>
            </Pressable>
          )}
        </View>
        <View style={styles.queues}>
          {QUEUES.map(({ key, icon }) => {
            const group = d.exceptions[key];
            return group ? (
              <Queue
                key={key}
                title={t(`admin.exceptions.${key}`)}
                icon={icon}
                group={group}
                onPress={onOpenExceptions}
                testID={`dashboard-queue-${key}`}
              />
            ) : null;
          })}
        </View>
      </ScrollView>
    </View>
  );
}

type Tone = 'good' | 'info' | 'plain';

const TONES: Record<Tone, { wash: string; border: string; tint: string }> = {
  good: { wash: colors.primaryWash, border: green[300], tint: colors.primaryDark },
  info: { wash: colors.infoWash, border: colors.info, tint: colors.info },
  plain: { wash: colors.surface, border: colors.border, tint: colors.ink },
};

function Tile({
  icon,
  tone,
  label,
  value,
  foot,
  testID,
}: {
  icon: string;
  tone: Tone;
  label: string;
  value: string;
  foot?: string;
  testID?: string;
}): React.JSX.Element {
  const palette = TONES[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: palette.wash, borderColor: palette.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <Ionicons name={icon as never} size={15} color={palette.tint} />
        <AppText style={[styles.tileLabel, { color: palette.tint }]}>{label}</AppText>
      </View>
      <AppText style={[styles.tileValue, { color: palette.tint }]}>{value}</AppText>
      {!!foot && <AppText style={styles.tileFoot}>{foot}</AppText>}
    </View>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Ionicons name={icon as never} size={16} color={colors.info} />
        <AppText style={styles.sectionTitle}>{title}</AppText>
      </View>
      {children}
    </View>
  );
}

/** One bar per day: completed at the foot in green, still open on top in yolk. */
function Chart({ days }: { days: DashboardTrendDay[] }): React.JSX.Element {
  const most = Math.max(1, ...days.map(day => day.completed + day.pending));
  // A label under every bar for a week; every few for a month, or they run into each other.
  const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5;
  return (
    <View testID="dashboard-chart">
      <View style={styles.chart}>
        {days.map(day => {
          const total = day.completed + day.pending;
          return (
            <View key={day.date} style={styles.barSlot} testID={`dashboard-bar-${day.date}`}>
              {total > 0 && <AppText style={styles.barValue}>{total}</AppText>}
              <View
                style={[
                  styles.bar,
                  { height: Math.max(total > 0 ? 3 : 0, (total / most) * CHART_HEIGHT) },
                ]}
              >
                {day.pending > 0 && <View style={[styles.barPart, { flex: day.pending }]} />}
                {day.completed > 0 && (
                  <View style={[styles.barPart, styles.barDone, { flex: day.completed }]} />
                )}
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        {days.map((day, index) => (
          <AppText key={day.date} style={styles.axisLabel} numberOfLines={1}>
            {index % every === 0 ? (days.length <= 7 ? day.short_label : day.label) : ''}
          </AppText>
        ))}
      </View>
    </View>
  );
}

function Swatch({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.swatch}>
      <View style={[styles.swatchDot, { backgroundColor: color }]} />
      <AppText style={styles.swatchLabel}>{label}</AppText>
    </View>
  );
}

/** The wash, edge and dot of a queue row, by how bad the server says it is. */
function severityOf(severity: string): { wash: string; border: string; tint: string } {
  if (severity === 'error') {
    return { wash: colors.errorWash, border: colors.error, tint: colors.error };
  }
  if (severity === 'warning') {
    return { wash: colors.secondaryWash, border: yolk[300], tint: yolk[700] };
  }
  return { wash: colors.infoWash, border: colors.info, tint: colors.info };
}

function Queue({
  title,
  icon,
  group,
  onPress,
  testID,
}: {
  title: string;
  icon: string;
  group: ExceptionGroup;
  onPress?: () => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const empty = group.count === 0;
  const worst = group.rows.find(row => row.severity === 'error')
    ? 'error'
    : group.rows.find(row => row.severity === 'warning')
      ? 'warning'
      : 'info';
  const palette = empty
    ? { wash: colors.primaryWash, border: green[300], tint: colors.primaryDark }
    : severityOf(worst);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={!onPress}
      style={[styles.queue, { backgroundColor: palette.wash, borderColor: palette.border }]}
      testID={testID}
    >
      <View style={styles.queueHead}>
        <View style={[styles.queueIcon, { backgroundColor: palette.tint }]}>
          <Ionicons name={(empty ? 'checkmark' : icon) as never} size={14} color={colors.surface} />
        </View>
        <AppText style={styles.queueTitle}>{title}</AppText>
        <AppText style={[styles.queueCount, { color: palette.tint }]}>{group.count}</AppText>
      </View>
      {empty ? (
        <AppText style={styles.queueRow}>{t('admin.exceptions.clear')}</AppText>
      ) : (
        <>
          {group.rows.slice(0, ROWS_SHOWN).map((row, index) => (
            <View key={index} style={styles.queueLine}>
              <View style={[styles.queueDot, { backgroundColor: severityOf(row.severity).tint }]} />
              <View style={styles.queueText}>
                <AppText style={styles.queueRow}>{row.label}</AppText>
                {!!row.meta && <AppText style={styles.queueMeta}>{row.meta}</AppText>}
              </View>
            </View>
          ))}
          {group.count > ROWS_SHOWN && (
            <AppText style={styles.queueMore}>
              {t('admin.exceptions.more', { count: group.count - ROWS_SHOWN })}
            </AppText>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },

  hero: {
    alignItems: 'center',
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },
  // Full width and centred in it, not a box sized to the text: Hindi on Android carries a
  // trailing space that pushed the words off centre.
  heroLabel: {
    ...typography.bodyStrong,
    color: colors.surface,
    opacity: 0.8,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  heroValue: {
    ...typography.display,
    fontSize: 52,
    lineHeight: 60,
    color: colors.surface,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  deltaUp: { backgroundColor: colors.primary },
  deltaDown: { backgroundColor: colors.error },
  deltaLabel: { ...typography.label, color: colors.surface },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: {
    flex: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  tileLabel: { ...typography.label, flex: 1 },
  tileValue: { ...typography.h1, marginTop: spacing[1] },
  tileFoot: { ...typography.caption, color: colors.textMuted },

  ranges: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
  range: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rangeOn: { backgroundColor: colors.info, borderColor: colors.info },
  rangeLabel: { ...typography.label, color: colors.textMuted },
  rangeLabelOn: { color: colors.surface },

  panel: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelFoot: { ...typography.caption, color: colors.textMuted },
  sectionTitle: { ...typography.h3, color: colors.ink, flex: 1 },

  chart: {
    height: CHART_HEIGHT + 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  chartPlaceholder: { height: CHART_HEIGHT + 34 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.textMuted },
  bar: {
    width: '80%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  barPart: { width: '100%', backgroundColor: yolk[400] },
  barDone: { backgroundColor: colors.primary },
  axis: { flexDirection: 'row', gap: 3, marginTop: 4 },
  axisLabel: {
    flex: 1,
    ...typography.caption,
    fontSize: 10,
    lineHeight: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  legend: { flexDirection: 'row', gap: spacing[4] },
  swatch: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  swatchDot: { width: 10, height: 10, borderRadius: 3 },
  swatchLabel: { ...typography.caption, color: colors.ink },

  zone: { gap: 4 },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  zoneName: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  zoneCount: { ...typography.label, color: colors.info },
  zoneTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    overflow: 'hidden',
  },
  zoneFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.info },

  attentionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  link: { ...typography.label, color: colors.info },
  queues: { gap: spacing[2] },
  queue: {
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[2],
  },
  queueHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  queueIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueTitle: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  queueCount: { ...typography.h2 },
  queueLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  queueDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  queueText: { flex: 1 },
  queueRow: { ...typography.caption, color: colors.ink },
  queueMeta: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  queueMore: { ...typography.caption, color: colors.textMuted },
});
