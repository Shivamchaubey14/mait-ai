/**
 * History — everything this Mait has recorded, newest first.
 *
 * Grouped by day rather than shown as one long list: a Mait looking something up is answering
 * "what did I do at Bhojipura on Tuesday", and a flat list of four hundred rows makes them
 * count backwards to find it.
 *
 * Shows what is still queued alongside what the server has, because from the Mait's side both
 * are work they did. The difference is marked on the row, not by hiding one of them.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListAiEventsQuery } from '@api/endpoints';
import type { AIEvent } from '@api/types';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList } from '@/components/states';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (dayKey(iso) === dayKey(now.toISOString())) {
    return t('history.today');
  }
  if (dayKey(iso) === dayKey(yesterday.toISOString())) {
    return t('history.yesterday');
  }
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

function time(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function HistoryScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const events = useListAiEventsQuery();

  const results = events.data?.results ?? [];

  // Grouped in order. The API already returns newest first, so the days fall out in order
  // without a second sort.
  const days: { label: string; rows: AIEvent[] }[] = [];
  results.forEach(event => {
    const label = dayLabel(event.created_at, t);
    const last = days[days.length - 1];
    if (last && last.label === label) {
      last.rows.push(event);
    } else {
      days.push({ label, rows: [event] });
    }
  });

  return (
    <View style={styles.root}>
      <PageHero
        title={t('history.title')}
        subtitle={t('history.subtitle', { count: events.data?.count ?? 0 })}
      />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={events.isFetching}
            onRefresh={events.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {events.isLoading ? (
          <SkeletonList rows={5} />
        ) : events.isError ? (
          <ErrorState
            title={t('history.errorTitle')}
            onRetry={() => events.refetch()}
            busy={events.isFetching}
          />
        ) : results.length === 0 ? (
          <EmptyState title={t('history.emptyTitle')} body={t('history.emptyBody')} />
        ) : (
          days.map(day => (
            <View key={day.label} style={styles.day}>
              <View style={styles.dayHead}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <Text style={styles.dayCount}>{day.rows.length}</Text>
              </View>

              {day.rows.map(event => {
                const done = event.status === 'completed';
                const cancelled = event.status === 'cancelled';
                return (
                  <View key={event.id} style={styles.row} testID={`history-${event.id}`}>
                    <View
                      style={[
                        styles.swatch,
                        done && styles.swatchDone,
                        cancelled && styles.swatchCancelled,
                      ]}
                    >
                      <Ionicons
                        name={done ? 'checkmark' : cancelled ? 'close' : 'time-outline'}
                        size={16}
                        color={
                          done
                            ? colors.primaryDark
                            : cancelled
                              ? colors.error
                              : colors.secondaryPressed
                        }
                      />
                    </View>

                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {event.owner_name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {event.breed} · {event.mpp_name} · {time(event.created_at)}
                      </Text>
                    </View>

                    <Text style={styles.rowStraw} numberOfLines={1}>
                      {event.straw_unique_no || '—'}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  day: { marginBottom: spacing[4] },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  dayLabel: { ...typography.label, color: colors.ink },
  dayCount: { ...typography.caption, color: colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondaryWash,
  },
  swatchDone: { backgroundColor: colors.primaryWash },
  swatchCancelled: { backgroundColor: colors.errorWash },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowStraw: { ...typography.caption, color: colors.textMuted, maxWidth: 96 },
});
