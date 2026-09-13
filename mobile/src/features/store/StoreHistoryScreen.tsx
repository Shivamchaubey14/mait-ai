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
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { shortDate } from '@/features/stock/IndentsScreen';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

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
): { item: string; qty: number }[] {
  const totals = new Map<string, number>();
  rows
    .filter(row => row.state !== 'cancelled')
    .forEach(row => {
      const item = itemLabel(row, language);
      totals.set(item, (totals.get(item) ?? 0) + row.qty);
    });
  return [...totals.entries()].map(([item, qty]) => ({ item, qty })).sort((a, b) => b.qty - a.qty);
}

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
  const [term, setTerm] = useState('');

  const today = localIso(new Date());
  const history = useListStoreHistoryQuery({ from: windowStart(span), to: today });

  const rows = useMemo(
    () => (history.data ?? []).filter(row => matchesHandover(row, term)),
    [history.data, term],
  );
  const totals = totalsByItem(rows, i18n.language);
  const waiting = rows.filter(row => row.state === 'waiting').length;

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

  const handedOver = rows.filter(row => row.state !== 'cancelled').length;

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
        <Text style={styles.dayHeading}>{day.heading}</Text>
        {day.rows.map(row => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            onPress={() => onOpenHandover(row)}
            style={({ pressed }) => [
              styles.row,
              row.state === 'cancelled' && styles.rowPutBack,
              pressed && styles.rowPressed,
            ]}
            testID={`history-row-${row.id}`}
          >
            <Text style={styles.time}>{clock(row.issued_at)}</Text>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {`IND-${row.indent_id} · ${row.mait_name}`}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {t('store.historyWhat', { qty: row.qty, item: itemLabel(row, i18n.language) })}
              </Text>
            </View>
            {statePill(row, t)}
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    ));
  };

  return (
    <View style={storeStyles.root}>
      <StoreHero
        eyebrow={t('store.historyEyebrow')}
        pill={storeName}
        title={t('store.historyTitle', { count: handedOver })}
        subtitle={t(`store.historyWindow_${span}`)}
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
        <View style={styles.windows}>
          {(['today', 'week', 'month'] as HistoryWindow[]).map(key => {
            const on = key === span;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setSpan(key)}
                style={[styles.window, on && styles.windowOn]}
                testID={`history-window-${key}`}
              >
                <Text style={[styles.windowLabel, on && styles.windowLabelOn]}>
                  {t(`store.historyChip_${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
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
            <Text style={styles.totalsLabel}>{t('store.historyTotals')}</Text>
            <Text style={styles.totalsValue}>
              {totals.map(total => `${total.qty} ${total.item}`).join(' · ')}
            </Text>
            {waiting > 0 && (
              <Text style={styles.totalsWaiting}>
                {t('store.historyWaitingCount', { count: waiting })}
              </Text>
            )}
          </View>
        )}

        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  windows: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  window: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Outlined rather than filled, like every filter in the app: choosing what to look at is
  // not an action, and green-filled is kept for the action.
  windowOn: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  windowLabel: { ...typography.label, color: colors.textMuted },
  windowLabelOn: { color: colors.primaryDark },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1, paddingVertical: spacing[2] },

  totals: {
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  totalsLabel: { ...typography.caption, color: colors.primaryDark },
  totalsValue: { ...typography.h3, color: colors.ink, marginTop: 2 },
  totalsWaiting: { ...typography.caption, color: colors.textMuted, marginTop: spacing[1] },

  dayHeading: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing[2],
    marginBottom: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[3],
    paddingLeft: spacing[4],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  rowPutBack: { backgroundColor: colors.background },
  rowPressed: { opacity: 0.85 },
  time: { ...typography.bodyStrong, color: colors.ink, minWidth: 44 },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },
});
