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
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useListAiEventsQuery, useListBreedsQuery } from '@api/endpoints';
import { readQueue } from '@api/queue';
import type { AIEvent } from '@api/types';
import { BrandMark } from '@/components/brand';
import DateRangeSheet, { formatRange } from '@/components/dateRange';
import { Tile, Tiles } from '@/components/frame';
import Glyph, { GlyphName, STRAW_GLYPH } from '@/components/glyph';
import PullToRefresh from '@/components/pullToRefresh';
import { whatIsMissing } from '@/features/aiFlow/resume';
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

/**
 * Each state in its colour and glyph: green done, yolk waiting on the phone, red waiting on
 * the Mait, slate for the trail of a capture called off.
 */
const LOOK: Record<RowState, { icon: GlyphName; solid: string; onSolid: string; word: string }> = {
  synced: {
    icon: 'checkmark-done',
    solid: colors.primary,
    onSolid: colors.surface,
    word: colors.primaryDark,
  },
  queued: { icon: 'cloud-upload', solid: yolk[500], onSolid: colors.ink, word: yolk[800] },
  attention: {
    icon: 'alert-circle',
    solid: colors.error,
    onSolid: colors.surface,
    word: colors.error,
  },
  cancelled: { icon: 'close-circle', solid: ink[400], onSolid: colors.surface, word: ink[500] },
};

/** The three states worth counting, as tiles that also filter the list. */
const COUNTED: { state: RowState; tone: 'good' | 'waiting' | 'bad' }[] = [
  { state: 'synced', tone: 'good' },
  { state: 'queued', tone: 'waiting' },
  { state: 'attention', tone: 'bad' },
];

/** The label a state wears. `attention` is two words in the translations, hence the map. */
function stateKey(state: RowState): string {
  return state === 'attention' ? 'history.needsAttention' : `history.${state}`;
}

// --------------------------------------------------------------------------------------
// Pieces
// --------------------------------------------------------------------------------------
/** The state as a word. Colour carries it too, but never alone — this is read in sunlight. */
function StatePill({ state, label }: { state: RowState; label: string }): React.JSX.Element {
  const look = LOOK[state];
  return (
    <View style={[styles.pill, { backgroundColor: look.solid }]} testID={`ai-event-pill-${state}`}>
      <Text style={[styles.pillLabel, { color: look.onSolid }]} numberOfLines={1}>
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
  const look = LOOK[state];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.owner_name} · ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles[`row_${state}`], pressed && styles.rowPressed]}
      testID={`ai-event-${event.id}`}
    >
      {/* The state's glyph on its colour: the row says what it is before a word is read. */}
      <View style={[styles.chip, { backgroundColor: look.solid }]}>
        <Glyph name={look.icon} size={20} color={look.onSolid} />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {event.owner_name}
        </Text>
        <View style={styles.rowMetaLine}>
          <Glyph
            name={needs ? 'warning' : STRAW_GLYPH}
            size={12}
            color={needs ? colors.error : look.word}
          />
          <Text
            style={[styles.rowMeta, { color: needs ? colors.error : ink[500] }]}
            numberOfLines={1}
          >
            {meta}
          </Text>
        </View>
        <View style={styles.rowFoot}>
          <StatePill state={state} label={label} />
          {/* The kind of owner, so a farmer asking "did I pay" is answered by the row. */}
          <View
            style={[
              styles.owner,
              event.owner_type === 'member' ? styles.owner_member : styles.owner_other,
            ]}
          >
            <Ionicons
              name={event.owner_type === 'member' ? 'people' : 'person'}
              size={11}
              color={event.owner_type === 'member' ? colors.info : yolk[800]}
            />
            <Text
              style={[
                styles.ownerLabel,
                { color: event.owner_type === 'member' ? colors.info : yolk[800] },
              ]}
              numberOfLines={1}
            >
              {t(event.owner_type === 'member' ? 'history.member' : 'history.nonMember')}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.go, { borderColor: look.solid }]}>
        <Ionicons name="chevron-forward" size={16} color={look.word} />
      </View>
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function AiEventsScreen({
  onOpen,
  onSync,
}: {
  onOpen: (event: AIEvent) => void;
  /** Push what is still queued. A pull here means "bring me up to date", both ways. */
  onSync?: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>('today');
  const online = useOnline();

  /**
   * A range of dates, which is a fourth answer to the same question the chips answer — so
   * choosing one puts the chips out and choosing a chip puts this out. Two filters both
   * claiming to say what the list is showing is a list nobody can read.
   */
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const [datesOpen, setDatesOpen] = useState(false);
  /** One state picked off the tiles, or every state. Tapping the picked tile again clears it. */
  const [only, setOnly] = useState<RowState | null>(null);

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

  /** Each state counted over the range in force, before the tiles narrow it further. */
  const counts = COUNTED.map(({ state }) => shown.filter(event => stateOf(event) === state).length);
  const visible = only ? shown.filter(event => stateOf(event) === only) : shown;

  /** Whichever request the rows came from is the one whose loading and errors are shown. */
  const source = dates ? ranged : events;

  /** Grouped by day, so a week's scroll reads as days rather than as forty rows. */
  const days: { label: string; rows: AIEvent[] }[] = [];
  visible.forEach(event => {
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
                <Ionicons
                  name={key === 'today' ? 'today' : key === 'week' ? 'calendar' : 'albums'}
                  size={14}
                  color={active ? colors.surface : colors.info}
                />
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
              <Ionicons name="calendar-number" size={16} color={colors.info} />
            )}
          </Pressable>
        </View>
      </View>

      <PullToRefresh
        onRefresh={async () => {
          onSync?.();
          // Both requests, always: the headline counts come off the unfiltered one even while
          // the rows come off the dated one, and a pull that refreshed only what is on screen
          // would leave the two numbers at the top stale.
          await Promise.all([events.refetch(), dates ? ranged.refetch() : null, readQueued()]);
        }}
        label={t('pull.events')}
        testID="ai-events-pull"
      >
        {scrollProps => (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            {...scrollProps}
          >
            {source.isLoading ? (
              <SkeletonList rows={5} />
            ) : source.isError ? (
              <Problem
                kind={online ? 'server' : 'offline'}
                onRetry={() => source.refetch()}
                busy={source.isFetching}
                testID="events-error"
              />
            ) : shown.length === 0 ? (
              <EmptyState title={empty.title} body={empty.body} />
            ) : (
              <>
                <Tiles>
                  {COUNTED.map(({ state, tone }, index) => (
                    <Tile
                      key={state}
                      label={t(stateKey(state))}
                      value={counts[index]}
                      icon={LOOK[state].icon}
                      tone={tone}
                      selected={only === state}
                      onPress={() => setOnly(current => (current === state ? null : state))}
                      testID={`ai-events-tile-${state}`}
                    />
                  ))}
                </Tiles>
                {visible.length === 0 && (
                  <View style={styles.noneOfState} testID="ai-events-none-of-state">
                    <Ionicons name="checkmark-circle" size={18} color={colors.primaryDark} />
                    <Text style={styles.noneOfStateLabel}>
                      {t('history.noneOfState', { state: t(stateKey(only ?? 'synced')) })}
                    </Text>
                  </View>
                )}
                {days.map(day => (
                  <View key={day.label} style={styles.day}>
                    {/* Dropped when the filter is already one day: "Today" under a chip that says
                  Today is the same word twice. */}
                    {(!!dates || range !== 'today') && (
                      <View style={styles.dayHead}>
                        <View style={styles.dayPill}>
                          <Ionicons name="calendar" size={13} color={colors.info} />
                          <Text style={styles.dayLabel}>{day.label}</Text>
                        </View>
                        <View style={styles.dayCount}>
                          <Text style={styles.dayCountLabel}>{day.rows.length}</Text>
                        </View>
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
                ))}
              </>
            )}
          </ScrollView>
        )}
      </PullToRefresh>

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
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
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
    minHeight: MIN_TOUCH_TARGET - 8,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  // Blue, the colour of a fact rather than of an action: a filter says what is shown, and
  // green is kept for "done".
  rangeActive: { backgroundColor: colors.info, borderColor: colors.info },
  rangeLabel: { ...typography.label, color: colors.info, flexShrink: 1 },
  rangeLabelActive: { color: colors.surface },

  // -- days ------------------------------------------------------------------------------
  body: { padding: spacing[4], gap: spacing[3] },
  day: { marginBottom: spacing[1] },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  dayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  dayLabel: { ...typography.label, color: colors.info },
  dayCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  dayCountLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  noneOfState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
  },
  noneOfStateLabel: { ...typography.body, color: colors.primaryDark, flex: 1 },

  // -- rows ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  // The whole card in the state's wash, not a stripe down one edge: a thumb covers an edge,
  // and a row read through a thumb then looks finished.
  row_synced: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_queued: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  row_attention: { backgroundColor: colors.errorWash, borderColor: colors.error },
  row_cancelled: { backgroundColor: ink[50], borderColor: ink[100] },
  rowPressed: { opacity: 0.85 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMeta: { ...typography.caption, flexShrink: 1 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  // -- pills -----------------------------------------------------------------------------
  pill: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radius.pill },
  pillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  owner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 1,
  },
  owner_member: { backgroundColor: colors.infoWash, borderColor: colors.info },
  owner_other: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  ownerLabel: { ...typography.caption },
});
