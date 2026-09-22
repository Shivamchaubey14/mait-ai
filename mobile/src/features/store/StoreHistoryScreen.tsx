/**
 * History — what went over this store's counter, and when.
 *
 * A keeper is asked two kinds of question about the past: "did Sunil get his Murrah on
 * Tuesday" and "how much did we hand out this week". The list answers the first, one row per
 * handover under the day it happened, with the time, the Mait, what went, and whether they
 * typed the code. The strip under the hero answers the second, per item, for the window chosen.
 *
 * Every row is a handover, not an indent. An indent the store filled in two batches is two
 * rows on two days, because that is what happened at the counter — and the question this
 * screen exists for is what the keeper handed over, not what the office approved.
 *
 * A row put back on the shelf stays, greyed and saying so. It happened, the code was read out,
 * and a history that quietly dropped it would be one the keeper could not reconcile with the
 * slip they printed.
 *
 * **In colour, and over any dates.** Today / 7 days / 30 days are one tap each, and the
 * calendar chip opens the same From–To picker the Mait's list uses, for "what went out in
 * March". Three tiles count what the handovers became — collected, waiting for a code, put
 * back — and tapping one narrows the list to it. Each row is a card in its state's colour,
 * with its verdict on a solid disc and the item's glyph beside what went.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useListStoreHistoryQuery } from '@api/endpoints';
import type { StoreHandover } from '@api/types';
import DateRangeSheet, { formatRange } from '@/components/dateRange';
import { Tile, Tiles } from '@/components/frame';
import type { TileTone } from '@/components/frame';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { shortDate } from '@/features/stock/IndentsScreen';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import { clock, itemLabel, Pill, StoreHero, storeStyles } from './parts';
import { matchesHandover } from './ToIssueScreen';

export type HistoryWindow = 'today' | 'week' | 'month';

const WINDOW_DAYS: Record<HistoryWindow, number> = { today: 1, week: 7, month: 30 };

/** `YYYY-MM-DD` in the handset's own day, which is what the API's `from` and `to` take. */
export function localIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** The first day of a window, counting today as one of its days. */
export function windowStart(window: HistoryWindow, today = new Date()): string {
  const start = new Date(today);
  start.setDate(start.getDate() - (WINDOW_DAYS[window] - 1));
  return localIso(start);
}

/** "Today", "Yesterday", or the date — the heading a day's handovers sit under. */
export function dayHeading(iso: string, t: TFunction, today = new Date()): string {
  const day = localIso(new Date(iso));
  if (day === localIso(today)) {
    return t('store.historyToday');
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localIso(yesterday)) {
    return t('store.historyYesterday');
  }
  return shortDate(iso);
}

/**
 * How much of each item went over the counter.
 *
 * Put-back handovers are left out: nothing left the store. Waiting ones are counted, because
 * the stock is promised and set aside — the keeper handed it over, whether or not the Mait has
 * typed the code yet.
 */
export function totalsByItem(
  rows: StoreHandover[],
  language: string,
): { item: string; qty: number; straw: boolean }[] {
  const totals = new Map<string, { qty: number; straw: boolean }>();
  rows
    .filter(row => row.state !== 'cancelled')
    .forEach(row => {
      const item = itemLabel(row, language);
      const had = totals.get(item);
      totals.set(item, {
        qty: (had?.qty ?? 0) + row.qty,
        straw: row.product_type === 'straw',
      });
    });
  return [...totals.entries()]
    .map(([item, total]) => ({ item, ...total }))
    .sort((a, b) => b.qty - a.qty);
}

/** What a handover became, as the colour and glyph its card wears. */
const STATE_LOOK: Record<
  StoreHandover['state'],
  { tone: TileTone; icon: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  collected: { tone: 'good', icon: 'checkmark' },
  waiting: { tone: 'waiting', icon: 'key' },
  cancelled: { tone: 'plain', icon: 'return-down-back' },
};

function statePill(row: StoreHandover, t: TFunction) {
  if (row.state === 'collected') {
    return (
      <Pill label={t('store.historyCollected', { time: clock(row.collected_at) })} tone="good" />
    );
  }
  if (row.state === 'cancelled') {
    return <Pill label={t('store.historyPutBack')} tone="plain" />;
  }
  return <Pill label={t('store.historyWaiting')} tone="waiting" />;
}

export default function StoreHistoryScreen({
  storeName,
  onOpenHandover,
  initialWindow = 'week',
}: {
  storeName: string;
  onOpenHandover: (handover: StoreHandover) => void;
  initialWindow?: HistoryWindow;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const [span, setSpan] = useState<HistoryWindow>(initialWindow);
  /** A range of dates, which puts the three quick windows out while it is in force. */
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const [picking, setPicking] = useState(false);
  /** One state at a time, or all of them. */
  const [only, setOnly] = useState<StoreHandover['state'] | null>(null);
  const [term, setTerm] = useState('');

  const today = localIso(new Date());
  const history = useListStoreHistoryQuery(
    dates ? { from: dates.from, to: dates.to } : { from: windowStart(span), to: today },
  );

  const found = useMemo(
    () => (history.data ?? []).filter(row => matchesHandover(row, term)),
    [history.data, term],
  );
  const rows = useMemo(
    () => (only ? found.filter(row => row.state === only) : found),
    [found, only],
  );
  const totals = totalsByItem(found, i18n.language);
  const count = (state: StoreHandover['state']) => found.filter(row => row.state === state).length;
  const waiting = count('waiting');
  const months = t('calendar.months', { returnObjects: true }) as string[];

  /** Rows under their day, newest day first — the order the server already sends them in. */
  const days = useMemo(() => {
    const grouped: { day: string; heading: string; rows: StoreHandover[] }[] = [];
    rows.forEach(row => {
      const day = localIso(new Date(row.issued_at));
      const last = grouped[grouped.length - 1];
      if (last && last.day === day) {
        last.rows.push(row);
      } else {
        grouped.push({ day, heading: dayHeading(row.issued_at, t), rows: [row] });
      }
    });
    return grouped;
  }, [rows, t]);

  const handedOver = found.filter(row => row.state !== 'cancelled').length;

  const body = () => {
    if (history.isLoading) {
      return <SkeletonList rows={5} />;
    }
    if (history.isError) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={() => history.refetch()}
          busy={history.isFetching}
          testID="history-error"
        />
      );
    }
    if (!rows.length) {
      return term ? (
        <Text style={styles.quiet} testID="history-find-none">
          {t('store.findNone', { term })}
        </Text>
      ) : (
        <EmptyState title={t('store.historyEmptyTitle')} body={t('store.historyEmptyBody')} />
      );
    }
    return days.map(day => (
      <View key={day.day} testID={`history-day-${day.day}`}>
        <View style={styles.dayHead}>
          <View style={styles.dayChip}>
            <Ionicons name="calendar" size={13} color={colors.surface} />
          </View>
          <Text style={styles.dayHeading}>{day.heading}</Text>
          <View style={styles.dayCount}>
            <Text style={styles.dayCountLabel}>{day.rows.length}</Text>
          </View>
        </View>
        {day.rows.map(row => {
          const look = STATE_LOOK[row.state];
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              onPress={() => onOpenHandover(row)}
              style={({ pressed }) => [
                styles.row,
                styles[`row_${look.tone}`],
                pressed && styles.rowPressed,
              ]}
              testID={`history-row-${row.id}`}
            >
              <View style={[styles.verdict, styles[`solid_${look.tone}`]]}>
                <Ionicons
                  name={look.icon}
                  size={17}
                  color={look.tone === 'waiting' ? colors.ink : colors.surface}
                />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.titleLine}>
                  <View style={[styles.number, styles[`solid_${look.tone}`]]}>
                    <Text style={[styles.numberLabel, look.tone === 'waiting' && styles.inkText]}>
                      {`IND-${row.indent_id}`}
                    </Text>
                  </View>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {row.mait_name}
                  </Text>
                </View>
                <View style={styles.whatLine}>
                  <Glyph
                    name={row.product_type === 'straw' ? STRAW_GLYPH : 'cube'}
                    size={13}
                    color={colors.info}
                  />
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {t('store.historyWhat', { qty: row.qty, item: itemLabel(row, i18n.language) })}
                  </Text>
                </View>
                <View style={styles.stateLine}>
                  {statePill(row, t)}
                  <View style={styles.time}>
                    <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                    <Text style={styles.timeLabel}>{clock(row.issued_at)}</Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={SOLID[look.tone]} />
            </Pressable>
          );
        })}
      </View>
    ));
  };

  return (
    <View style={storeStyles.root}>
      <StoreHero
        eyebrow={t('store.historyEyebrow')}
        pill={storeName}
        title={t('store.historyTitle', { count: handedOver })}
        subtitle={
          dates
            ? t('store.historyRange', { range: formatRange(dates.from, dates.to, months) })
            : t(`store.historyWindow_${span}`)
        }
        testID="history-hero"
      />

      <ScrollView
        contentContainerStyle={storeStyles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={history.isFetching && !history.isLoading}
            onRefresh={history.refetch}
            tintColor={colors.primary}
          />
        }
        testID="history-scroll"
      >
        {/* The window: three quick answers and a calendar for any other. A range of dates
            puts the three out, and choosing one of them puts the range away. */}
        <View style={styles.windows}>
          {(['today', 'week', 'month'] as HistoryWindow[]).map(key => {
            const on = !dates && key === span;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setSpan(key);
                  setDates(null);
                }}
                style={[styles.window, on && styles.windowOn]}
                testID={`history-window-${key}`}
              >
                <Text style={[styles.windowLabel, on && styles.windowLabelOn]}>
                  {t(`store.historyChip_${key}`)}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: !!dates }}
            accessibilityLabel={t('history.dateRangeTitle')}
            onPress={() => setPicking(true)}
            style={[styles.window, styles.dates, !!dates && styles.windowOn]}
            testID="history-window-dates"
          >
            <Ionicons name="calendar" size={16} color={dates ? colors.surface : colors.info} />
            {!!dates && (
              <Text style={[styles.windowLabel, styles.windowLabelOn]} numberOfLines={1}>
                {formatRange(dates.from, dates.to, months)}
              </Text>
            )}
          </Pressable>
        </View>

        {/* What the handovers became, a tile each — and the filter: tap one for only those. */}
        <Tiles>
          {(['collected', 'waiting', 'cancelled'] as StoreHandover['state'][]).map(state => (
            <Tile
              key={state}
              icon={STATE_LOOK[state].icon}
              label={t(`store.historyTile_${state}`)}
              value={history.data ? count(state) : '—'}
              tone={STATE_LOOK[state].tone}
              selected={only === state}
              onPress={() => setOnly(only === state ? null : state)}
              testID={`history-tile-${state}`}
            />
          ))}
        </Tiles>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.primary} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('store.findPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            testID="history-find"
          />
        </View>

        {/* How much of each thing went, for the window — the second question a keeper is asked,
            answered without adding the rows up by eye. */}
        {totals.length > 0 && (
          <View style={styles.totals} testID="history-totals">
            <View style={styles.totalsHead}>
              <View style={styles.totalsChip}>
                <Ionicons name="arrow-up-circle" size={15} color={colors.surface} />
              </View>
              <Text style={styles.totalsLabel}>{t('store.historyTotals')}</Text>
            </View>
            <View style={styles.totalsItems}>
              {totals.map(total => (
                <View key={total.item} style={styles.totalItem}>
                  <Glyph
                    name={total.straw ? STRAW_GLYPH : 'cube'}
                    size={13}
                    color={colors.surface}
                  />
                  <Text style={styles.totalItemLabel}>{`${total.qty} ${total.item}`}</Text>
                </View>
              ))}
            </View>
            {waiting > 0 && (
              <Text style={styles.totalsWaiting}>
                {t('store.historyWaitingCount', { count: waiting })}
              </Text>
            )}
          </View>
        )}

        {body()}
      </ScrollView>

      <DateRangeSheet
        visible={picking}
        from={dates?.from ?? null}
        to={dates?.to ?? null}
        onClose={() => setPicking(false)}
        onApply={(from, to) => {
          setDates({ from, to });
          setPicking(false);
        }}
        onClear={() => {
          setDates(null);
          setPicking(false);
        }}
      />
    </View>
  );
}

/** The solid colour of each tone — a glyph or a word on a wash. */
const SOLID: Record<TileTone, string> = {
  good: colors.primaryDark,
  waiting: yolk[800],
  bad: colors.error,
  info: colors.info,
  plain: ink[500],
};

const styles = StyleSheet.create({
  // -- the window ------------------------------------------------------------------------------
  windows: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  window: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: MIN_TOUCH_TARGET - 10,
    paddingHorizontal: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  // The calendar keeps to its content; the three quick answers share the rest.
  dates: { flex: 0, minWidth: MIN_TOUCH_TARGET, flexShrink: 1 },
  windowOn: { backgroundColor: colors.info, borderColor: colors.info },
  windowLabel: { ...typography.label, color: colors.info },
  windowLabelOn: { color: colors.surface },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1, paddingVertical: spacing[2] },

  // -- what went out ---------------------------------------------------------------------------
  totals: {
    gap: spacing[2],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
  },
  totalsHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  totalsChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  totalsLabel: { ...typography.h3, color: colors.primaryDark },
  totalsItems: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  totalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDark,
  },
  totalItemLabel: { ...typography.label, color: colors.surface },
  totalsWaiting: {
    ...typography.caption,
    color: yolk[800],
    fontFamily: typography.label.fontFamily,
  },

  // -- a day ---------------------------------------------------------------------------------
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    marginBottom: spacing[2],
  },
  dayChip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  dayHeading: { ...typography.h3, color: colors.ink, flex: 1 },
  dayCount: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  dayCountLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },

  // -- a handover ----------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  row_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  // Put back: slate rather than white — it happened, and it is still read, but nothing left.
  row_plain: { backgroundColor: ink[50], borderColor: ink[200] },
  rowPressed: { opacity: 0.85 },
  verdict: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solid_good: { backgroundColor: colors.primary },
  // Ink on yolk, never white — yolk fails contrast under white text.
  solid_waiting: { backgroundColor: yolk[500] },
  solid_bad: { backgroundColor: colors.error },
  solid_info: { backgroundColor: colors.info },
  solid_plain: { backgroundColor: ink[400] },
  rowBody: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  number: { paddingHorizontal: spacing[2], paddingVertical: 1, borderRadius: radius.pill },
  numberLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  inkText: { color: colors.ink },
  rowTitle: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1 },
  whatLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMeta: { ...typography.caption, color: colors.ink },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  timeLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textMuted,
  },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },
});
