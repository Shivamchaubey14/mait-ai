/**
 * AI events — every insemination this Mait has recorded, and what is still owed on it (M19).
 *
 * This replaced a plain history list, and the difference is the question it answers. History
 * answered "what did I do"; a Mait already knows what they did. What they cannot know without
 * opening things one at a time is which of the day's captures are *finished* — the server has
 * it, the payment is confirmed, nothing more is owed — and which are sitting half-done with an
 * animal already served.
 *
 * So every row carries its state as a word, and the headline counts the two numbers that
 * matter before any row is read: how many today, and how many are waiting on something. A row
 * needing attention is outlined in red and says what is missing on the row itself, because a
 * Mait scrolling for the one capture they are worried about should not have to open five
 * others to find it.
 *
 * Three live states, not two:
 *
 *   Queued          — done on the handset, not yet on the server. Nothing to do; it sends
 *                     itself. Read out of the offline queue, which is the only place that
 *                     knows — and the reason this screen reads the queue as well as the API.
 *   Needs attention — the server has it and it stopped short. This is work.
 *   Synced          — completed. The straw is deducted and the payment is confirmed.
 *
 * Tapping any row opens it, finished ones included: the commonest reason a Mait opens this
 * screen at all is a farmer standing in front of them asking about last week.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useListAiEventsQuery, useListBreedsQuery } from '@api/endpoints';
import { readQueue } from '@api/queue';
import type { AIEvent } from '@api/types';
import { BrandMark } from '@/components/brand';
import DateRangeSheet, { formatRange } from '@/components/dateRange';
import { whatIsMissing } from '@/features/aiFlow/resume';
import { EmptyState, ErrorState, SkeletonList } from '@/components/states';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

/** How far back the list reaches. Always answered — "All" is a choice, not the absence of one. */
type Range = 'today' | 'week' | 'all';

const RANGES: Range[] = ['today', 'week', 'all'];

/**
 * What a row is, from the Mait's side.
 *
 * Deliberately not the server's six statuses: `draft`, `straw_verified`, `photo_captured` and
 * `payment_pending` are four different places one capture can stop, and the only thing a list
 * has to say is that it stopped. Which one it is becomes the line under the name, and the
 * whole of it is on the detail screen.
 */
type RowState = 'queued' | 'attention' | 'synced' | 'cancelled';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function time(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isToday(iso: string): boolean {
  return new Date(iso).getTime() >= startOfToday();
}

/** Seven days back, not the calendar week — a Monday is not a boundary anybody works to. */
function isThisWeek(iso: string): boolean {
  return new Date(iso).getTime() >= startOfToday() - 6 * 24 * 60 * 60 * 1000;
}

function dayLabel(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  if (isToday(iso)) {
    return t('history.today');
  }
  if (d.getTime() >= startOfToday() - 24 * 60 * 60 * 1000) {
    return t('history.yesterday');
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** The label a state wears. `attention` is two words in the translations, hence the map. */
function stateKey(state: RowState): string {
  return state === 'attention' ? 'history.needsAttention' : `history.${state}`;
}

// --------------------------------------------------------------------------------------
// Pieces
// --------------------------------------------------------------------------------------
/** The state as a word. Colour carries it too, but never alone — this is read in sunlight. */
function StatePill({ state, label }: { state: RowState; label: string }): React.JSX.Element {
  return (
    <View style={[styles.pill, styles[`pill_${state}`]]}>
      <Text style={[styles.pillLabel, styles[`pillLabel_${state}`]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function EventRow({
  event,
  state,
  meta,
  onPress,
}: {
  event: AIEvent;
  state: RowState;
  meta: string;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const needs = state === 'attention';
  const label = t(stateKey(state));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.owner_name} · ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, needs && styles.rowNeeds, pressed && styles.rowPressed]}
      testID={`ai-event-${event.id}`}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {event.owner_name}
        </Text>
        <Text style={[styles.rowMeta, needs && styles.rowMetaNeeds]} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      <StatePill state={state} label={label} />

      {/* Only where something is waiting to be done. On a finished row the pill is the whole
          answer, and an arrow beside it promises a next step that does not exist. */}
      {(needs || state === 'queued') && (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function AiEventsScreen({
  onOpen,
}: {
  onOpen: (event: AIEvent) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>('today');

  /**
   * A range of dates, which is a fourth answer to the same question the chips answer — so
   * choosing one puts the chips out and choosing a chip puts this out. Two filters both
   * claiming to say what the list is showing is a list nobody can read.
   */
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);

  const events = useListAiEventsQuery();
  /**
   * The same list, asked for again with the dates on it.
   *
   * Filtered by the server rather than here, because the chips and the dates reach for
   * different things: `today` and `week` are always inside the page the app already holds,
   * and a range is not — somebody asking for last March is asking for rows this handset has
   * never seen. Skipped entirely until a range exists, so the ordinary case still makes one
   * request.
   */
  const ranged = useListAiEventsQuery(
    { dateFrom: dates?.from, dateTo: dates?.to },
    { skip: !dates },
  );
  const breeds = useListBreedsQuery();

  /**
   * The captures this handset is still holding.
   *
   * Read from the offline queue rather than inferred from a status: a capture whose photo or
   * completion is queued looks exactly like an abandoned one from the server's side, and
   * telling a Mait that work they finished ten minutes ago needs their attention sends them
   * back to a yard they have already left.
   */
  const [queuedIds, setQueuedIds] = useState<number[]>([]);
  const readQueued = useCallback(async () => {
    const jobs = await readQueue();
    setQueuedIds(
      jobs.map(job => job.label?.eventId).filter((id): id is number => typeof id === 'number'),
    );
  }, []);
  useEffect(() => {
    readQueued();
  }, [readQueued]);

  const months = t('calendar.months', { returnObjects: true }) as string[];

  const hindi = i18n.language.startsWith('hi');
  const breedName = (code: string): string => {
    const config = (breeds.data ?? []).find(item => item.code === code);
    return (hindi && config?.name_hi) || config?.name || code;
  };

  const results = useMemo(() => events.data?.results ?? [], [events.data]);

  const stateOf = useCallback(
    (event: AIEvent): RowState => {
      if (event.status === 'cancelled') {
        return 'cancelled';
      }
      if (event.status === 'completed') {
        return 'synced';
      }
      return queuedIds.includes(event.id) ? 'queued' : 'attention';
    },
    [queuedIds],
  );

  /** Both headline numbers come off the whole list, never off the filter in force. */
  const todayCount = results.filter(event => isToday(event.created_at)).length;
  const waiting = results.filter(event => {
    const state = stateOf(event);
    return state === 'attention' || state === 'queued';
  }).length;

  /**
   * The rows on screen — off the dated request when there is one, off the page already held
   * when there is not. Never both: a range and a chip are two answers to one question.
   */
  const shown = dates
    ? (ranged.data?.results ?? [])
    : results.filter(event =>
        range === 'today'
          ? isToday(event.created_at)
          : range === 'week'
            ? isThisWeek(event.created_at)
            : true,
      );

  /** Whichever request the rows came from is the one whose loading and errors are shown. */
  const source = dates ? ranged : events;

  /** Grouped by day, so a week's scroll reads as days rather than as forty rows. */
  const days: { label: string; rows: AIEvent[] }[] = [];
  shown.forEach(event => {
    const label = dayLabel(event.created_at, t);
    const last = days[days.length - 1];
    if (last && last.label === label) {
      last.rows.push(event);
    } else {
      days.push({ label, rows: [event] });
    }
  });

  /**
   * The line under the name.
   *
   * A finished row says what it was and what changed hands. A row that stopped says what is
   * missing instead — the breed is no use to somebody deciding what to do about it, and the
   * missing thing is the only reason that row is being read at all.
   */
  const metaFor = (event: AIEvent, state: RowState): string => {
    const at = time(event.created_at);
    const breed = breedName(event.semen_breed || event.breed);

    if (state === 'attention') {
      return `${at} · ${t(`history.missing_${whatIsMissing(event)}`)}`;
    }
    if (state === 'queued') {
      return `${at} · ${breed} · ${t('history.notSent')}`;
    }
    if (state === 'cancelled') {
      return `${at} · ${breed}`;
    }
    // What she handed over, which for a member is nothing: her rate is deducted from her milk
    // payment by the dairy, and a figure here would read as cash somebody took from her. The
    // charge itself is on the detail screen, where it can say where it goes.
    const collected =
      event.owner_type === 'member'
        ? 0
        : Math.round(Number(event.payment?.amount ?? event.amount_due ?? 0));
    return `${at} · ${breed} · ₹ ${collected}`;
  };

  const empty = dates
    ? { title: t('history.emptyRangeTitle'), body: t('history.emptyRangeBody') }
    : {
        today: { title: t('history.emptyTodayTitle'), body: t('history.emptyTodayBody') },
        week: { title: t('history.emptyWeekTitle'), body: t('history.emptyWeekBody') },
        all: { title: t('history.emptyTitle'), body: t('history.emptyBody') },
      }[range];

  return (
    <View style={styles.root}>
      {/* Full bleed and up under the status bar, like Inventory: this is the top of a place,
          not a card sitting on one. The mark rides in it because a Mait hands this phone to a
          farmer to read a code off, and the app should say whose app it is wherever they are. */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <BrandMark size="small" />
        </View>

        <Text style={styles.heroTitle} testID="ai-events-headline">
          {waiting > 0
            ? t('history.todayWaiting', { count: todayCount, waiting })
            : t('history.todayOnly', { count: todayCount })}
        </Text>
      </View>

      {/* One control, four answers, always carrying a value — a thing already chosen rather
          than a question waiting to be answered.

          The three chips share the row equally. They were content-width before, which set
          "Today" narrower than "This week" and left a ragged gap after "All" — three answers
          to one question, drawn as three different sizes, reading as a sentence that had been
          cut off. Equal thirds say they are alternatives.

          The dates button is the exception and is meant to look like one: it is not a fixed
          answer but the way to ask for another, so it keeps to its content and sits at the end
          of the row. */}
      <View style={styles.rangeWrap}>
        <View style={styles.ranges}>
          {RANGES.map(key => {
            // A chosen range of dates puts all three out: the list is showing neither today,
            // nor the week, nor everything.
            const active = !dates && key === range;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setRange(key);
                  setDates(null);
                }}
                style={[styles.range, active && styles.rangeActive]}
                testID={`ai-events-range-${key}`}
              >
                <Text
                  style={[styles.rangeLabel, active && styles.rangeLabelActive]}
                  numberOfLines={1}
                >
                  {t(`history.range_${key}`)}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: !!dates }}
            accessibilityLabel={t('history.dateRangeTitle')}
            onPress={() => setDatesOpen(true)}
            style={[styles.dateChip, !!dates && styles.rangeActive]}
            testID="ai-events-range-dates"
          >
            {/* The glyph or the dates, never both. They say the same thing, and this chip
                shares a row with three others that have to stay readable — the twenty-odd
                points a redundant calendar icon costs come straight out of "This week". */}
            {dates ? (
              <Text style={[styles.rangeLabel, styles.rangeLabelActive]} numberOfLines={1}>
                {formatRange(dates.from, dates.to, months)}
              </Text>
            ) : (
              <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={source.isFetching && !source.isLoading}
            onRefresh={() => {
              // Both, always: the headline counts come off the unfiltered request even while
              // the rows come off the dated one, and a pull that refreshed only what is on
              // screen would leave the two numbers at the top stale.
              events.refetch();
              if (dates) {
                ranged.refetch();
              }
              readQueued();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {source.isLoading ? (
          <SkeletonList rows={5} />
        ) : source.isError ? (
          <ErrorState
            title={t('history.errorTitle')}
            onRetry={() => source.refetch()}
            busy={source.isFetching}
          />
        ) : shown.length === 0 ? (
          <EmptyState title={empty.title} body={empty.body} />
        ) : (
          days.map(day => (
            <View key={day.label} style={styles.day}>
              {/* Dropped when the filter is already one day: "Today" under a chip that says
                  Today is the same word twice. */}
              {(!!dates || range !== 'today') && (
                <View style={styles.dayHead}>
                  <Text style={styles.dayLabel}>{day.label}</Text>
                  <Text style={styles.dayCount}>{day.rows.length}</Text>
                </View>
              )}

              {day.rows.map(event => {
                const state = stateOf(event);
                return (
                  <EventRow
                    key={event.id}
                    event={event}
                    state={state}
                    meta={metaFor(event, state)}
                    onPress={() => onOpen(event)}
                  />
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <DateRangeSheet
        visible={datesOpen}
        from={dates?.from ?? null}
        to={dates?.to ?? null}
        onClose={() => setDatesOpen(false)}
        onApply={(from, to) => {
          setDates({ from, to });
          setDatesOpen(false);
        }}
        onClear={() => {
          // Back to the chip that was on before the dates were chosen, rather than to a list
          // showing nothing while it waits to be told what to show.
          setDates(null);
          setDatesOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // -- hero ------------------------------------------------------------------------------
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },

  // -- range chips -----------------------------------------------------------------------
  rangeWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  ranges: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  // Equal thirds of whatever the dates chip leaves, so the three read as one control with
  // three settings rather than as three labels that happen to be next to each other.
  range: {
    flex: 1,
    paddingHorizontal: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Content-width, and deliberately not `flex: 1`: it is the way to ask a different question,
  // not a fourth answer to this one. Shrinkable so a long range cannot crush the three.
  dateChip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    // Icon-only it would otherwise be the smallest target on the screen, and it is tapped
    // with the same cold or gloved hands as everything else.
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET - 12,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Outlined rather than filled. Green is this app's one "do this" colour and a filter is not
  // an action — the wash and the ring are enough to say which of the three is on.
  rangeActive: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  rangeLabel: { ...typography.label, color: colors.textMuted },
  rangeLabelActive: { color: colors.primaryDark },

  // -- days ------------------------------------------------------------------------------
  body: { padding: spacing[4] },
  day: { marginBottom: spacing[2] },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
  },
  dayLabel: { ...typography.label, color: colors.textMuted, letterSpacing: 1 },
  dayCount: { ...typography.caption, color: colors.textMuted },

  // -- rows ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.lg,
    ...shadows.card,
  },
  // The whole card, not a stripe down one edge: a thumb covers an edge, and a row read
  // through a thumb then looks finished.
  rowNeeds: { backgroundColor: colors.errorWash, borderColor: colors.error },
  rowPressed: { opacity: 0.85 },
  rowBody: { flex: 1 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowMetaNeeds: { color: colors.error },

  // -- pills -----------------------------------------------------------------------------
  pill: { paddingHorizontal: spacing[3], paddingVertical: 3, borderRadius: radius.pill },
  pill_queued: { backgroundColor: colors.secondaryWash },
  // White on the red wash the row already carries. A second red block inside a red card is
  // one alarm too many; the word is what has to be read.
  pill_attention: { backgroundColor: colors.surface },
  pill_synced: { backgroundColor: colors.primaryWash },
  pill_cancelled: { backgroundColor: colors.background },
  pillLabel: { ...typography.caption },
  pillLabel_queued: { color: yolk[800] },
  pillLabel_attention: { color: colors.error },
  pillLabel_synced: { color: colors.primaryDark },
  pillLabel_cancelled: { color: colors.textMuted },
});
