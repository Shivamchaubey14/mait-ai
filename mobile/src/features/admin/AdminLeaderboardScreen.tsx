/**
 * Leaderboard, for an admin — the portal's Mait leaderboard (`leaderboard.html`) on a handset.
 *
 * Ranked by AI count — how many inseminations each Mait actually performed — with collections
 * beside it, because the two together are the only honest reading: a high count with a low
 * cash share means events completed without money landing, which is a problem rather than a
 * performance.
 *
 * **The range is the screen's other half.** "Who is working" is only ever asked about a period,
 * so the two dates are always on screen and always editable, and the presets fill them in rather
 * than replacing them. The dates shown are the ones the server echoes back — it clamps a future
 * day or a span over a year — so the screen says what it counted, not what was asked.
 *
 * Bars are scaled to the leader rather than to a target: villages differ by an order of
 * magnitude, so the comparison that means anything is against the best Mait working the same
 * days. Below half the leader is yellow. Ranks are worked out before a search, so a Mait searched
 * for is still fourth in the district rather than looking like a winner.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import DateRangeSheet, { isoDate, parseIsoDate } from '@/components/dateRange';
import { initials } from '@/components/frame';
import { useAdminLeaderboardQuery } from '@api/endpoints';
import type { LeaderboardRow } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { Disc, FilterChip, Pill, TONE, type ToneName } from './AdminMaitsScreen';

export type Preset = '7' | '30' | '90' | 'this-month' | 'last-month' | 'custom';
const PRESETS: Preset[] = ['7', '30', '90', 'this-month', 'last-month', 'custom'];

/**
 * The two dates a preset stands for. "Last 30 days" includes today, which is why it counts back
 * 29: off-by-one here is a day of somebody's work appearing or vanishing from a board people are
 * judged on. Day zero of this month is the last day of the one before, whatever its length.
 */
export function presetRange(
  preset: Exclude<Preset, 'custom'>,
  today: Date = new Date(),
): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (preset === 'this-month') {
    return { from: isoDate(new Date(y, m, 1)), to: isoDate(today) };
  }
  if (preset === 'last-month') {
    return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
  }
  const days = Number(preset);
  return { from: isoDate(new Date(y, m, today.getDate() - (days - 1))), to: isoDate(today) };
}

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function rupees(value: string | number | null | undefined): string {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

/** "1 Aug 2026 – 31 Aug 2026", or one day where the range is one. */
function rangeLabel(t: TFunction, from: string, to: string): string {
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const day = (iso: string) => {
    const d = parseIsoDate(iso);
    return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
  };
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

/** What share of the money came in cash; null when nothing was collected. */
export function cashShare(row: { amount_collected: string; cod_amount: string }): number | null {
  const total = Number(row.amount_collected) || 0;
  if (!total) {
    return null;
  }
  return Math.round(((Number(row.cod_amount) || 0) / total) * 100);
}

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        testID={`${testID}-value`}
      >
        {value}
      </AppText>
      <AppText style={styles.tileFoot} testID={`${testID}-foot`}>
        {foot}
      </AppText>
    </View>
  );
}

/** The bar against the leader, grown in from zero so a change of range reads as a change. */
function Meter({ percent, behind }: { percent: number; behind: boolean }): React.JSX.Element {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, {
      toValue: percent,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [grow, percent]);
  return (
    <View style={styles.meter}>
      <Animated.View
        style={[
          styles.meterFill,
          {
            backgroundColor: behind ? yolk[400] : colors.primary,
            width: grow.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

/** First, second and third are looked for by position, so they wear the yolk trophy. */
const MEDAL: ToneName[] = ['yolk', 'yolk', 'yolk'];

function MaitRow({
  row,
  rank,
  leader,
}: {
  row: LeaderboardRow;
  rank: number;
  leader: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const relative = leader ? Math.round((row.ai_count / leader) * 100) : 0;
  const behind = relative < 50;
  const share = cashShare(row);
  const tone: ToneName = row.ai_count === 0 ? 'slate' : behind ? 'yolk' : 'green';
  const look = TONE[tone];
  const medal = rank < 3 ? MEDAL[rank] : null;

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-leader-${row.sahayak_vendor_code}`}
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.rank,
            medal
              ? { backgroundColor: TONE[medal].solid, borderColor: TONE[medal].solid }
              : { backgroundColor: colors.surface, borderColor: look.border },
          ]}
          testID={`admin-leader-rank-${row.sahayak_vendor_code}`}
        >
          {medal ? <Ionicons name="trophy" size={11} color={TONE[medal].onSolid} /> : null}
          <AppText style={[styles.rankLabel, { color: medal ? TONE[medal].onSolid : colors.ink }]}>
            {rank + 1}
          </AppText>
        </View>
        <Disc tone={tone} text={initials(row.name)} size={34} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{row.name}</AppText>
          <AppText style={styles.sub}>{row.sahayak_vendor_code}</AppText>
        </View>
        <View style={styles.count}>
          <AppText
            style={[styles.countValue, { color: look.text }]}
            testID={`admin-leader-ai-${row.sahayak_vendor_code}`}
          >
            {num(row.ai_count)}
          </AppText>
          <AppText style={styles.sub}>{t('admin.leaderboard.ai')}</AppText>
        </View>
      </View>

      <View style={styles.inset}>
        <View style={styles.meterRow}>
          <Meter percent={relative} behind={behind} />
          <AppText style={[styles.meterLabel, behind && { color: yolk[800] }]}>
            {t('admin.leaderboard.ofLeader', { n: relative })}
          </AppText>
        </View>
        <View style={[styles.money, styles.rule]}>
          <View style={styles.flex}>
            <AppText style={styles.sub}>{t('admin.leaderboard.collections')}</AppText>
            <AppText
              style={styles.moneyValue}
              testID={`admin-leader-collected-${row.sahayak_vendor_code}`}
            >
              {rupees(row.amount_collected)}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText style={styles.sub}>{t('admin.leaderboard.cashShare')}</AppText>
            <View style={styles.shareRow}>
              <AppText
                style={styles.moneyValue}
                testID={`admin-leader-share-${row.sahayak_vendor_code}`}
              >
                {share === null ? '—' : `${share}%`}
              </AppText>
              {share !== null && (
                <View style={styles.split}>
                  <View style={[styles.splitCash, { flex: share }]} />
                  <View style={[styles.splitOnline, { flex: 100 - share }]} />
                </View>
              )}
            </View>
          </View>
        </View>
      </View>
      {behind && row.ai_count > 0 && <Pill label={t('admin.leaderboard.belowHalf')} tone="yolk" />}
    </View>
  );
}

export default function AdminLeaderboardScreen(): React.JSX.Element {
  const { t } = useTranslation();
  // Shortest first and the one the screen opens on: "who is working" is usually asked about
  // the week just gone.
  const [preset, setPreset] = useState<Preset>('7');
  const [range, setRange] = useState(() => presetRange('7'));
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState('');

  const board = useAdminLeaderboardQuery({ date_from: range.from, date_to: range.to });
  const data = board.data;

  const ranked = useMemo(
    () => (data?.results ?? []).map((entry, rank) => ({ entry, rank })),
    [data],
  );
  const leader = ranked[0]?.entry.ai_count ?? 0;
  const needle = term.trim().toLowerCase();
  const shown = needle
    ? ranked.filter(
        ({ entry }) =>
          entry.name.toLowerCase().includes(needle) ||
          entry.sahayak_vendor_code.toLowerCase().includes(needle),
      )
    : ranked;

  const choose = (next: Preset) => {
    if (next === 'custom') {
      setPicking(true);
      return;
    }
    setPreset(next);
    setRange(presetRange(next));
  };

  // What the server actually counted.
  const from = data?.date_from ?? range.from;
  const to = data?.date_to ?? range.to;
  const totals = data?.totals;
  const aiCount = Number(totals?.ai_count) || 0;
  const days = data?.days || 1;
  const collected = Number(totals?.amount_collected) || 0;
  const cod = Number(totals?.cod_amount) || 0;
  // Across every calendar day, Sundays included — comparable between ranges of any length.
  const perDay = days ? Math.round((aiCount / days) * 10) / 10 : 0;
  const total = data?.count ?? 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={board.isFetching && !board.isLoading}
            onRefresh={() => board.refetch()}
          />
        }
        testID="admin-leaderboard"
      >
        <View>
          <AppText style={styles.period} testID="admin-leaderboard-period">
            {rangeLabel(t, from, to)}
          </AppText>
          <AppText style={styles.sub}>{t('admin.leaderboard.subtitle')}</AppText>
        </View>

        {/* Presets are shortcuts to the one range; they fill the dates rather than hide them. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presets}
        >
          {PRESETS.map(p => (
            <FilterChip
              key={p}
              label={t(`admin.leaderboard.preset_${p.replace('-', '_')}`)}
              icon={p === 'custom' ? 'calendar-outline' : 'time-outline'}
              tone="blue"
              active={preset === p}
              onPress={() => choose(p)}
              testID={`admin-leaderboard-preset-${p}`}
            />
          ))}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.range, pressed && styles.pressed]}
          testID="admin-leaderboard-range"
        >
          <View style={styles.rangeSide}>
            <AppText style={styles.rangeLabel}>{t('admin.leaderboard.from')}</AppText>
            <AppText style={styles.rangeValue} testID="admin-leaderboard-from">
              {rangeLabel(t, from, from)}
            </AppText>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.info} />
          <View style={styles.rangeSide}>
            <AppText style={styles.rangeLabel}>{t('admin.leaderboard.to')}</AppText>
            <AppText style={styles.rangeValue} testID="admin-leaderboard-to">
              {rangeLabel(t, to, to)}
            </AppText>
          </View>
          <Ionicons name="calendar" size={18} color={colors.info} />
        </Pressable>

        {board.isLoading ? (
          <SkeletonRows rows={8} />
        ) : board.isError ? (
          <EmptyState message={t('admin.leaderboard.error')} />
        ) : (
          <>
            {/* What the range holds, before who holds it. */}
            <View style={styles.tiles}>
              <Tile
                tone="green"
                icon="medkit"
                label={t('admin.leaderboard.tileAi')}
                value={num(aiCount)}
                foot={
                  days === 1
                    ? t('admin.leaderboard.onThisDay')
                    : t('admin.leaderboard.acrossDays', { n: num(days) })
                }
                testID="admin-leaderboard-tile-ai"
              />
              <Tile
                tone="blue"
                icon="people"
                label={t('admin.leaderboard.tileMaits')}
                value={num(total)}
                foot={t(total ? 'admin.leaderboard.recordedOne' : 'admin.leaderboard.nobody')}
                testID="admin-leaderboard-tile-maits"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="yolk"
                icon="cash"
                label={t('admin.leaderboard.tileCollected')}
                value={rupees(collected)}
                foot={
                  collected
                    ? t('admin.leaderboard.inCash', { n: Math.round((cod / collected) * 100) })
                    : t('admin.leaderboard.nothingCollected')
                }
                testID="admin-leaderboard-tile-collected"
              />
              <Tile
                tone="slate"
                icon="speedometer"
                label={t('admin.leaderboard.tileAverage')}
                value={aiCount ? String(perDay) : '—'}
                foot={t(aiCount ? 'admin.leaderboard.perDay' : 'admin.leaderboard.noWork')}
                testID="admin-leaderboard-tile-average"
              />
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.leaderboard.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                testID="admin-leaderboard-search"
              />
              {term.length > 0 && (
                <Pressable onPress={() => setTerm('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {shown.length === 0 ? (
              <EmptyState
                message={t(ranked.length ? 'admin.leaderboard.noMatch' : 'admin.leaderboard.none')}
              />
            ) : (
              shown.map(({ entry, rank }) => (
                <MaitRow key={entry.mait_id} row={entry} rank={rank} leader={leader} />
              ))
            )}

            {ranked.length > 0 && (
              <AppText style={styles.foot} testID="admin-leaderboard-foot">
                {t('admin.leaderboard.foot')}
                {/* Said only when true: a capped board that does not say so presents its last
                    row as the bottom of the roster. */}
                {total > ranked.length
                  ? ` ${t('admin.leaderboard.capped', { n: num(ranked.length), total: num(total) })}`
                  : ''}
              </AppText>
            )}
          </>
        )}
      </ScrollView>

      <DateRangeSheet
        visible={picking}
        from={range.from}
        to={range.to}
        onClose={() => setPicking(false)}
        onApply={(f, tt) => {
          // Choosing dates by hand is a range of your own: the preset stops describing it.
          setPreset('custom');
          setRange({ from: f, to: tt });
          setPicking(false);
        }}
        onClear={() => {
          setPreset('7');
          setRange(presetRange('7'));
          setPicking(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  sub: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  period: { ...typography.h3, color: colors.ink },
  presets: { gap: spacing[2], paddingRight: spacing[4] },
  range: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  rangeSide: { flex: 1 },
  rangeLabel: { ...typography.caption, color: colors.info },
  rangeValue: { ...typography.label, color: colors.ink },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tileFoot: { ...typography.caption, color: colors.ink },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 34,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  rankLabel: { ...typography.caption, fontFamily: typography.h3.fontFamily },
  cardName: { ...typography.bodyStrong, color: colors.ink },
  count: { alignItems: 'flex-end' },
  countValue: { ...typography.h2 },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 10 },
  meter: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: ink[50],
  },
  meterFill: { height: '100%', borderRadius: 4 },
  meterLabel: { ...typography.caption, color: colors.textMuted, minWidth: 74, textAlign: 'right' },
  money: { flexDirection: 'row', gap: spacing[3], paddingVertical: 8 },
  moneyValue: { ...typography.label, color: colors.ink },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  split: {
    flex: 1,
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  splitCash: { backgroundColor: colors.primary },
  splitOnline: { backgroundColor: colors.info },
  foot: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
