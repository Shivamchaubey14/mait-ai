/**
 * Every insemination in the zone, opened from Profile, narrowed by a range of dates.
 *
 * The dashboard's feed is the last few captures — a glance. This is where a manager comes
 * looking for one: the farmer who rang about last Tuesday, the Mait whose week they want to
 * read. So every status is here, not only completed, and every row says who, where and by
 * whom with the codes a manager reads back over the phone.
 *
 * **Never all of it.** The server answers a page at a time, newest first, and the screen asks
 * for the next page only when somebody presses *Load more*. Each page is its own component
 * holding its own request, so a page already on screen is never fetched again to add another
 * under it, and a change of dates starts again from the first.
 *
 * **Every row is the colour of its state** — green done, yolk waiting on money, blue part of
 * the way, red cancelled — as a wash with a matching border, the rule every card on the event
 * screen is drawn to, so the list and the record it opens look like the same thing.
 */

import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListZonalEventsQuery } from '@api/endpoints';
import type { ZonalEventRow } from '@api/types';
import DateRangeSheet, { parseIsoDate } from '@/components/dateRange';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
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

import { Pill, ZonalAction, ZonalHero, zonalStyles } from './parts';
import { useLive } from './live';
import type { PillTone } from '@/components/frame';

const PAGE = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type RowTone = 'good' | 'waiting' | 'info' | 'bad';

/** The portal's table again: yolk is waiting, not wrong, and only a cancelled row is red. */
const STATUS_TONE: Record<string, RowTone> = {
  completed: 'good',
  payment_pending: 'waiting',
  photo_captured: 'info',
  straw_verified: 'info',
  draft: 'info',
  cancelled: 'bad',
};

const PILL_TONE: Record<RowTone, PillTone> = {
  good: 'good',
  waiting: 'waiting',
  info: 'plain',
  bad: 'bad',
};

/** "18 Sep 2026, 10:43" — the date in full, because this list reaches back months. */
function stamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** "18 Sep 2026" off a `YYYY-MM-DD`, read at local midnight. */
function dayOf(iso: string): string {
  const d = parseIsoDate(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function EventRow({
  row,
  onPress,
}: {
  row: ZonalEventRow;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = STATUS_TONE[row.status] ?? 'info';
  const member = row.owner_type === 'member';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('zonal.openEvent', { name: row.owner_name, id: row.id })}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles[`row_${tone}`], pressed && styles.rowPressed]}
      testID={`zonal-events-row-${row.id}`}
    >
      <View style={styles.rowTop}>
        <View style={[styles.number, styles[`number_${tone}`]]}>
          <Text style={styles.numberLabel}>{`#${row.id}`}</Text>
        </View>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.owner_name || t('zonal.notRecorded')}
        </Text>
        <Pill
          label={t(member ? 'zonal.member' : 'zonal.nonMember')}
          tone={member ? 'good' : 'waiting'}
        />
      </View>

      <View style={styles.rowFacts}>
        <Text style={styles.rowFact} numberOfLines={1}>
          <Text style={[styles.rowFactLabel, styles.labelInfo]}>{`${t('zonal.mppLabel')}: `}</Text>
          {[row.mpp_name, row.mpp_code].filter(Boolean).join(' · ')}
        </Text>
        <Text style={styles.rowFact} numberOfLines={1}>
          <Text style={[styles.rowFactLabel, styles.labelWarm]}>{`${t('zonal.theMait')}: `}</Text>
          {[row.mait_name, row.mait_code].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View style={styles.rowFoot}>
        <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
        <Text style={styles.rowWhen} numberOfLines={1}>
          {[stamp(row.created_at), row.breed].filter(Boolean).join(' · ')}
        </Text>
        <Pill label={row.status_display} tone={PILL_TONE[tone]} />
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

/**
 * One page of the list and, if it is the last one asked for, the way to the next.
 *
 * Its own request, so the pages above it are never refetched to add it.
 */
function EventPage({
  offset,
  dateFrom,
  dateTo,
  last,
  onMore,
  onOpen,
}: {
  offset: number;
  dateFrom?: string;
  dateTo?: string;
  last: boolean;
  onMore: () => void;
  onOpen: (id: number) => void;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const page = useListZonalEventsQuery({ dateFrom, dateTo, offset, limit: PAGE });

  if (page.isLoading) {
    return <SkeletonList rows={3} />;
  }
  if (page.isError || !page.data) {
    return (
      <ZonalAction
        label={t('zonal.loadMoreFailed')}
        tone="outline"
        icon="refresh"
        onPress={page.refetch}
        testID={`zonal-events-retry-${offset}`}
      />
    );
  }

  return (
    <>
      {page.data.results.map(row => (
        <EventRow key={row.id} row={row} onPress={() => onOpen(row.id)} />
      ))}
      {last && page.data.has_more && (
        <ZonalAction
          label={t('zonal.loadMore')}
          tone="outline"
          icon="chevron-down"
          onPress={onMore}
          testID="zonal-events-more"
        />
      )}
    </>
  );
}

/**
 * Left by the handset's back or the Profile tab, like the event it opens: no back arrow in the
 * hero, so the zone's pill has the corner to itself.
 */
export default function AllEventsScreen({
  zoneName,
  onOpen,
}: {
  zoneName: string;
  onOpen: (id: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const online = useOnline();
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [pages, setPages] = useState(1);

  // The first page carries the count for the whole range, and the headline reads it.
  // Live while only the first page is open. Once more pages are on screen the beat stops:
  // an event landing at the top would shift every later page by one, and a page below that
  // was not refetched would silently lose its last row.
  const live = useLive();
  const first = useListZonalEventsQuery(
    { dateFrom: dates?.from, dateTo: dates?.to, offset: 0, limit: PAGE },
    { ...live, pollingInterval: pages === 1 ? live.pollingInterval : 0 },
  );

  const choose = (next: { from: string; to: string } | null) => {
    setDates(next);
    // A new range is a new list: back to its first page.
    setPages(1);
    setPicking(false);
  };

  const body = () => {
    if (first.isLoading) {
      return <SkeletonList rows={5} />;
    }
    if (first.isError || !first.data) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={first.refetch}
          busy={first.isFetching}
          testID="zonal-events-error"
        />
      );
    }
    if (!first.data.count) {
      return (
        <EmptyState
          title={t('zonal.eventsEmptyTitle')}
          body={t(dates ? 'zonal.eventsEmptyRange' : 'zonal.eventsEmptyBody')}
        />
      );
    }
    return Array.from({ length: pages }, (_, index) => (
      <EventPage
        key={`${dates?.from ?? ''}-${dates?.to ?? ''}-${index}`}
        offset={index * PAGE}
        dateFrom={dates?.from}
        dateTo={dates?.to}
        last={index === pages - 1}
        onMore={() => setPages(count => count + 1)}
        onOpen={onOpen}
      />
    ));
  };

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        eyebrow={t('zonal.allEventsEyebrow')}
        pill={zoneName}
        title={
          first.data
            ? t('zonal.eventsCount', { count: first.data.count })
            : t('zonal.allEventsTitle')
        }
        subtitle={
          dates
            ? t('zonal.eventsBetween', { from: dayOf(dates.from), to: dayOf(dates.to) })
            : t('zonal.eventsNewestFirst')
        }
        testID="zonal-events-hero"
      />

      {/* From and To, as two boxes that say what is in force — tapping either opens the same
          month grid the Mait's list uses, where the first tap is From and the second is To. */}
      <View style={styles.filter}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('zonal.pickDates')}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.dates, pressed && styles.datesPressed]}
          testID="zonal-events-dates"
        >
          <View style={styles.dateBox}>
            <Text style={styles.dateLabel}>{t('zonal.fromDate')}</Text>
            <Text style={[styles.dateValue, !dates && styles.dateEmpty]} numberOfLines={1}>
              {dates ? dayOf(dates.from) : t('zonal.anyDate')}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.info} />
          <View style={styles.dateBox}>
            <Text style={styles.dateLabel}>{t('zonal.toDate')}</Text>
            <Text style={[styles.dateValue, !dates && styles.dateEmpty]} numberOfLines={1}>
              {dates ? dayOf(dates.to) : t('zonal.anyDate')}
            </Text>
          </View>
          <View style={styles.calendarChip}>
            <Ionicons name="calendar" size={16} color={colors.surface} />
          </View>
        </Pressable>
        {!!dates && (
          <Pressable
            accessibilityRole="button"
            onPress={() => choose(null)}
            style={styles.clear}
            testID="zonal-events-clear"
          >
            <Ionicons name="close-circle" size={16} color={colors.error} />
            <Text style={styles.clearLabel}>{t('zonal.clearDates')}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={first.isFetching && !first.isLoading}
            onRefresh={() => {
              setPages(1);
              first.refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {body()}
      </ScrollView>

      <DateRangeSheet
        visible={picking}
        from={dates?.from ?? null}
        to={dates?.to ?? null}
        onClose={() => setPicking(false)}
        onApply={(from, to) => choose({ from, to })}
        onClear={() => choose(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // -- the filter --------------------------------------------------------------------------
  filter: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  dates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  datesPressed: { opacity: 0.85 },
  dateBox: { flex: 1 },
  dateLabel: { ...typography.caption, fontSize: 11, color: colors.info },
  dateValue: { ...typography.bodyStrong, color: colors.ink },
  dateEmpty: { color: colors.textMuted },
  calendarChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET - 12,
    paddingHorizontal: spacing[2],
  },
  clearLabel: { ...typography.label, color: colors.error },

  // -- a row -------------------------------------------------------------------------------
  row: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[2],
  },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  row_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  rowPressed: { opacity: 0.85 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  number: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  number_good: { backgroundColor: colors.primary },
  number_waiting: { backgroundColor: yolk[600] },
  number_info: { backgroundColor: colors.info },
  number_bad: { backgroundColor: colors.error },
  numberLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  rowName: { ...typography.h3, color: colors.ink, flex: 1 },
  // The facts on a white inset, so the codes stay legible on any of the four washes.
  rowFacts: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  rowFact: { ...typography.caption, color: colors.ink, lineHeight: 18 },
  rowFactLabel: { fontFamily: typography.label.fontFamily },
  labelInfo: { color: colors.info },
  labelWarm: { color: yolk[800] },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowWhen: { ...typography.caption, color: ink[500], flex: 1 },
});
