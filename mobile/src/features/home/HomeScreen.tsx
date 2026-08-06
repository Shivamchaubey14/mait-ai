/**
 * Home (M0) — where a Mait lands after signing in.
 *
 * Answers the three questions they have before starting a round, in the order they have them:
 * has my work left the phone, how many straws do I hold, and what have I done today. Only then
 * the action, because "Start new AI" is meaningless if the answer to the second question is
 * zero.
 *
 * Every list here has four states and all four are built: loading, empty, error, and loaded.
 * The error state says the queued records are safe, since on a handset holding unsent
 * inseminations that is the actual question rather than what the server did.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListAiEventsQuery } from '@api/endpoints';
import { pendingCount, readQueue } from '@api/queue';
import type { AIEvent } from '@api/types';
import { BrandMark } from '@/components/brand';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList, SyncBanner } from '@/components/states';
import { useAppSelector } from '@/store';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

interface Props {
  onOpenStock: () => void;
  /** Live from NetInfo, so the banner reflects the radio rather than the last failed call. */
  online: boolean;
  pending: number;
  onSync: () => void;
  lastSyncAt: string | null;
}

function isToday(iso: string): boolean {
  const then = new Date(iso);
  const now = new Date();
  return (
    then.getDate() === now.getDate() &&
    then.getMonth() === now.getMonth() &&
    then.getFullYear() === now.getFullYear()
  );
}

export default function HomeScreen({
  onOpenStock,
  online,
  pending,
  onSync,
  lastSyncAt,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const user = useAppSelector(state => state.auth.user);

  const [queuedNames, setQueuedNames] = useState<number>(0);

  const stock = useGetInventorySummaryQuery();
  const events = useListAiEventsQuery();

  useEffect(() => {
    readQueue().then(jobs => setQueuedNames(jobs.length));
    pendingCount().then(() => undefined);
  }, [pending]);

  const refresh = useCallback(() => {
    stock.refetch();
    events.refetch();
    onSync();
  }, [events, onSync, stock]);

  const today = (events.data?.results ?? []).filter(event => isToday(event.created_at));

  return (
    <View style={styles.root}>
      <PageHero
        top={<BrandMark size="small" />}
        title={t('home.greeting', { name: user?.fullName ?? '' })}
        subtitle={t('home.subtitle')}
      />

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing[6] }]}
        refreshControl={
          <RefreshControl
            refreshing={events.isFetching}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Where the work is. First, because it is the first thing they want to know. */}
        {!online && pending > 0 && (
          <SyncBanner
            tone="offline"
            title={t('home.offlineQueued', { count: pending })}
            body={t('home.offlineQueuedBody')}
            action={{ label: t('home.view'), onPress: onSync }}
            testID="sync-offline"
          />
        )}
        {!online && pending === 0 && (
          <SyncBanner
            tone="offline"
            title={t('home.offline')}
            body={t('home.offlineBody')}
            testID="sync-offline-idle"
          />
        )}
        {online && pending > 0 && (
          <SyncBanner
            tone="queued"
            title={t('home.queued', { count: pending })}
            body={t('home.queuedBody')}
            action={{ label: t('home.sendNow'), onPress: onSync }}
            testID="sync-queued"
          />
        )}
        {online && pending === 0 && queuedNames === 0 && (
          <SyncBanner
            tone="synced"
            title={t('home.allSent')}
            body={
              lastSyncAt ? t('home.allSentBody', { time: lastSyncAt }) : t('home.allSentBodyPlain')
            }
            testID="sync-synced"
          />
        )}

        {/* Stock, because it decides whether the day can start at all. */}
        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t('home.strawsHeld')}</Text>
            {stock.isLoading ? (
              <View style={styles.tileSkeleton} />
            ) : (
              <Text
                style={[
                  styles.tileValue,
                  (stock.data?.total_straws ?? 0) === 0 && styles.tileValueBad,
                ]}
              >
                {stock.isError ? '—' : (stock.data?.total_straws ?? 0)}
              </Text>
            )}
            <Text style={styles.tileFoot}>
              {stock.data?.is_low_stock ? t('home.lowStock') : t('home.inYourFlask')}
            </Text>
          </View>

          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t('home.doneToday')}</Text>
            {events.isLoading ? (
              <View style={styles.tileSkeleton} />
            ) : (
              <Text style={styles.tileValue}>{today.length}</Text>
            )}
            <Text style={styles.tileFoot}>{t('home.sinceMorning')}</Text>
          </View>
        </View>

        {/* Stock failing is worth its own state: a Mait who cannot see their balance does not
            know whether they can work, and the answer is not "reload the app". */}
        {stock.isError && (
          <ErrorState
            title={t('home.stockErrorTitle')}
            onRetry={() => stock.refetch()}
            busy={stock.isFetching}
            testID="stock-error"
          />
        )}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{t('home.todaysEvents')}</Text>
          {today.length > 0 && <Text style={styles.sectionCount}>{today.length}</Text>}
        </View>

        {events.isLoading ? (
          <SkeletonList rows={3} />
        ) : events.isError ? (
          <ErrorState
            title={t('home.eventsErrorTitle')}
            onRetry={() => events.refetch()}
            busy={events.isFetching}
            testID="events-error"
          />
        ) : today.length === 0 ? (
          <EmptyState title={t('home.noEventsTitle')} body={t('home.noEventsBody')} />
        ) : (
          today.map(event => <EventRow key={event.id} event={event} />)
        )}

        {(stock.data?.total_straws ?? 0) === 0 && !stock.isLoading && (
          <SyncBanner
            tone="offline"
            title={t('home.noStrawsTitle')}
            body={t('home.noStrawsBody')}
            action={{ label: t('home.seeStock'), onPress: onOpenStock }}
            testID="no-straws"
          />
        )}
      </ScrollView>
    </View>
  );
}

/** One event, in the words a Mait would use for it. */
function EventRow({ event }: { event: AIEvent }): React.JSX.Element {
  const { t } = useTranslation();
  const queued = event.status !== 'completed' && event.status !== 'cancelled';

  return (
    <View style={styles.row} testID={`event-${event.id}`}>
      <View style={[styles.rowDot, queued ? styles.rowDotQueued : styles.rowDotDone]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {event.owner_name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {event.breed} · {event.straw_unique_no || t('home.noStrawYet')}
        </Text>
      </View>
      <Text style={[styles.rowStatus, queued && styles.rowStatusQueued]}>
        {queued ? t('home.waiting') : t('home.recorded')}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  body: { padding: spacing[5] },

  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  tile: {
    flex: 1,
    padding: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileValue: { ...typography.display, color: colors.ink },
  tileValueBad: { color: colors.error },
  tileFoot: { ...typography.caption, color: colors.textMuted },
  tileSkeleton: {
    width: 64,
    height: 30,
    marginVertical: spacing[1],
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  sectionTitle: { ...typography.h3, color: colors.ink },
  sectionCount: { ...typography.label, color: colors.textMuted },

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
  rowDot: { width: 10, height: 10, borderRadius: 5 },
  rowDotDone: { backgroundColor: colors.primary },
  rowDotQueued: { backgroundColor: colors.secondary },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowStatus: { ...typography.caption, color: colors.primaryDark },
  rowStatusQueued: { color: colors.secondaryPressed },
});
