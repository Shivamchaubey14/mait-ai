/**
 * The pieces the zonal manager's screens share.
 *
 * Almost nothing, and that is the point: the hero, the pill and the one green action come
 * from `components/frame`, the same frame the Mait's and the keeper's screens wear. What is
 * particular to a manager is small — the word a depot's shelf puts on a request they are
 * about to agree to, and the two-figure tile row every one of their screens opens with.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { ZonalApproval } from '@api/types';
import type { PillTone } from '@/components/frame';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

export { AppHero as ZonalHero, FooterAction as ZonalAction, Pill } from '@/components/frame';
export { frameStyles as zonalStyles } from '@/components/frame';

/**
 * What approving this request would actually get the Mait, as the word on its row.
 *
 * The manager's version of the keeper's readiness pill, and deliberately a different
 * sentence: the keeper is asked *can I hand this over now*, and the manager is asked *if I
 * say yes, will anything arrive*. Green when the depot covers the whole request, amber when
 * it covers some — approving is still right, the rest follows on the next delivery — red when
 * it covers none, and plain when no depot serves this Mait at all, because that last one is
 * not a stock problem and drawing it as one would send somebody to the wrong phone.
 */
export function coveragePill(
  row: ZonalApproval,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; tone: PillTone } {
  if (row.coverage === 'ready') {
    return { label: t('zonal.pillReady'), tone: 'good' };
  }
  if (row.coverage === 'short') {
    return { label: t('zonal.pillShort', { count: row.in_store }), tone: 'waiting' };
  }
  if (row.coverage === 'empty') {
    return { label: t('zonal.pillEmpty'), tone: 'bad' };
  }
  return { label: t('zonal.pillNoStore'), tone: 'plain' };
}

// --------------------------------------------------------------------------------------
// Requests
// --------------------------------------------------------------------------------------
/**
 * How close together a Mait's indents have to be raised to be one request.
 *
 * The Mait's Request Stock screen is a list — straws, sheaths, gloves in one go — but the API
 * takes one item per indent, so the list arrives as several indents a second or two apart. A
 * manager deciding them one row at a time, with the same Mait's name on each, was deciding
 * one request in pieces. Ten minutes is generous for a slow connection and short enough that
 * two separate trips to the screen stay two requests.
 */
export const REQUEST_WINDOW_MS = 10 * 60 * 1000;

/** One Mait's request as they raised it: every item, oldest first. */
export interface IndentGroup {
  /** The first indent's id, which is what the group is known by. */
  key: number;
  rows: ZonalApproval[];
}

/**
 * The queue as requests rather than rows.
 *
 * Chained, not bucketed: each indent joins the Mait's latest group if it was raised within
 * the window of that group's last item, so a list typed slowly still arrives as one request.
 * The groups keep the queue's own order — oldest first, because it is a queue of people.
 */
export function groupIndents(rows: ZonalApproval[]): IndentGroup[] {
  const ordered = [...rows].sort(
    (a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime(),
  );
  const groups: IndentGroup[] = [];
  const latest = new Map<number, IndentGroup>();
  for (const row of ordered) {
    const open = latest.get(row.mait);
    const last = open?.rows[open.rows.length - 1];
    if (
      open &&
      last &&
      new Date(row.requested_at).getTime() - new Date(last.requested_at).getTime() <=
        REQUEST_WINDOW_MS
    ) {
      open.rows.push(row);
      continue;
    }
    const group = { key: row.id, rows: [row] };
    groups.push(group);
    latest.set(row.mait, group);
  }
  return groups;
}

/** "Sunil Kumar" → "SK": enough to tell two Maits apart at a glance down a queue. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Worst first: one empty shelf is the fact about a request, not three ready ones beside it. */
const SEVERITY: ZonalApproval['coverage'][] = ['empty', 'short', 'no-store', 'ready'];

/** The tone a whole request wears: the worst of its items. */
export function groupTone(rows: ZonalApproval[]): TileTone {
  const worst = SEVERITY.find(coverage => rows.some(row => row.coverage === coverage));
  return worst === 'empty'
    ? 'bad'
    : worst === 'short'
      ? 'waiting'
      : worst === 'no-store'
        ? 'info'
        : 'good';
}

/** The glyph for what was asked for: a drop for semen straws, a box for everything else. */
export function itemIcon(row: ZonalApproval): React.ComponentProps<typeof Ionicons>['name'] {
  return row.product_type === 'straw' ? 'water' : 'cube';
}

/**
 * A row of figures under the hero.
 *
 * Green for what is settled, yolk for what is waiting on somebody else, red for what nobody
 * can work around — the same three meanings these colours carry everywhere in the product.
 * Tappable where the figure is a list; inert where it is only a figure, and it does not
 * pretend otherwise.
 */
/**
 * `info` is the fourth, and it is not decoration: this palette's blue is a *fact about the
 * situation* — where the handset was, what came out of the bag — as against green for done,
 * yolk for waiting on somebody and red for wrong. The portal's event screen and the Mait's
 * own draw the same two cards in it, and a manager looking at the same record should be
 * looking at the same colours.
 */
export type TileTone = 'good' | 'waiting' | 'bad' | 'info' | 'plain';

export function Tiles({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={[styles.tiles, styles.tilesStretch]}>{children}</View>;
}

export function Tile({
  label,
  value,
  note,
  icon,
  tone = 'plain',
  selected = false,
  onPress,
  children,
  testID,
}: {
  label: string;
  value?: string | number;
  /**
   * The line of context under the figure — *what* the figure is of.
   *
   * The design system's stat tile is a label, a figure and one line under it, and that line
   * is where a tile stops being a number somebody has to interpret: "₹ 300" over "Deducted
   * from milk payment · Verified" is an answer, and "₹ 300" alone is a prompt to go and look.
   */
  note?: string;
  /** A glyph above the label, on a chip of the tile's own colour. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: TileTone;
  selected?: boolean;
  onPress?: () => void;
  /** In place of `value`, where the figure is a pill rather than a number. */
  children?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const body = (
    <>
      {!!icon && (
        <View style={[styles.tileIcon, styles[`tileIcon_${tone}`]]}>
          <Ionicons name={icon} size={14} color={colors.surface} />
        </View>
      )}
      <Text style={[styles.tileLabel, styles[`tileLabel_${tone}`]]} numberOfLines={2}>
        {label}
      </Text>
      {children ?? (
        <Text style={[styles.tileValue, styles[`tileValue_${tone}`]]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {!!note && (
        <Text style={styles.tileNote} numberOfLines={2}>
          {note}
        </Text>
      )}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.tile, styles[`tile_${tone}`]]} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tile, styles[`tile_${tone}`], selected && styles.tileOn]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

/**
 * A two-way switch over a list — *Maits* or *Depots*, *7 days* or *30*.
 *
 * A rounded-rectangle track with the chosen half filled green in the same shape, never a
 * capsule: every other surface in this app is a rounded rectangle, and a pill here would be
 * the one shape on the screen that belongs to nothing else (docs/DESIGN_SYSTEM.md).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.track} testID={testID}>
      {options.map(option => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.key)}
            style={[styles.segment, on && styles.segmentOn]}
            testID={testID ? `${testID}-${option.key}` : undefined}
          >
            <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A white card that is also a row: title line, meta line, and whatever sits at the right. */
export function Row({
  title,
  meta,
  right,
  onPress,
  testID,
}: {
  title: React.ReactNode;
  meta?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}): React.JSX.Element {
  const body = (
    <>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>{title}</View>
        {!!meta && (
          <Text style={styles.rowMeta} numberOfLines={2}>
            {meta}
          </Text>
        )}
      </View>
      {right}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export const rowStyles = StyleSheet.create({
  title: { ...typography.h3, color: colors.ink },
  section: { ...typography.label, color: colors.textMuted, marginBottom: spacing[2] },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },
});

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Every tile in a row is as tall as the tallest, so a two-line note under one does not
  // leave the others floating half a card above the baseline.
  tilesStretch: { alignItems: 'stretch' },
  tileOn: { borderWidth: 2 },
  tile_plain: { backgroundColor: colors.surface, borderColor: colors.border },
  tile_good: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  tile_waiting: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  tile_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  tile_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  tileIcon_plain: { backgroundColor: colors.textMuted },
  tileIcon_good: { backgroundColor: colors.primary },
  tileIcon_waiting: { backgroundColor: yolk[600] },
  tileIcon_bad: { backgroundColor: colors.error },
  tileIcon_info: { backgroundColor: colors.info },
  tileLabel: { ...typography.caption, textAlign: 'center' },
  tileLabel_plain: { color: colors.textMuted },
  tileLabel_good: { color: colors.primaryDark },
  tileLabel_waiting: { color: yolk[800] },
  tileLabel_bad: { color: colors.error },
  tileLabel_info: { color: colors.info },
  tileValue: { ...typography.h1, marginTop: 2 },
  tileValue_plain: { color: colors.ink },
  tileValue_good: { color: colors.primaryDark },
  tileValue_waiting: { color: colors.ink },
  tileValue_bad: { color: colors.error },
  // Ink on the blue wash, the rule every wash token in this palette is written to: the wash
  // carries the colour and the border states it, and the text stays legible in sunlight.
  tileValue_info: { color: colors.ink },
  tileNote: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },

  track: {
    flexDirection: 'row',
    padding: spacing[1],
    marginBottom: spacing[3],
    borderRadius: radius.md + 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  segmentOn: { backgroundColor: colors.primary },
  segmentLabel: { ...typography.label, color: colors.textMuted },
  segmentLabelOn: { color: colors.surface },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.background },
  rowBody: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[2],
    height: 156,
  },
  barColumn: { flex: 1, alignItems: 'center', height: '100%' },
  barBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginBottom: spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[400],
  },
  barBadgeQuiet: { backgroundColor: yolk[100] },
  // Today's disc carries an Ink ring, the colour today's bar is drawn in.
  barBadgeToday: { borderWidth: 2, borderColor: colors.ink },
  barValue: {
    ...typography.caption,
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
  },
  barValueQuiet: { color: yolk[800] },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: {
    width: '100%',
    borderRadius: radius.sm,
    // A shade darker than the wash the chart card is drawn on, so an ordinary day still
    // stands off the card.
    backgroundColor: green[200],
    borderWidth: 1,
    borderColor: green[300],
  },
  // The day being asked about, in the colour every hero and nav bar in this app is.
  barToday: { backgroundColor: colors.ink, borderColor: colors.ink },
  barBest: { backgroundColor: colors.primary, borderColor: colors.primary },
  barDay: { ...typography.caption, fontSize: 11, color: green[700], marginTop: spacing[1] },
  barDayToday: { color: colors.ink, fontFamily: typography.label.fontFamily },

  leader: {
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  leaderLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rank: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank_warm: { backgroundColor: yolk[500] },
  rank_info: { backgroundColor: colors.info },
  rankLabel: { ...typography.label, color: colors.surface },
  leaderBody: { flex: 1 },
  leaderFact: { ...typography.caption, color: colors.ink, lineHeight: 18 },
  leaderFactLabel: { fontFamily: typography.label.fontFamily },
  leaderFactLabel_warm: { color: yolk[800] },
  leaderFactLabel_info: { color: colors.info },
  leaderFigure: { alignItems: 'center', minWidth: 36 },
  leaderValue: { ...typography.h2 },
  leaderValue_warm: { color: yolk[800] },
  leaderValue_info: { color: colors.info },
  leaderUnit: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.textMuted },
  leaderTrack: {
    height: 6,
    marginTop: spacing[2],
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  leaderTrack_warm: { backgroundColor: yolk[100] },
  leaderTrack_info: { backgroundColor: colors.infoWash },
  leaderFill: { height: '100%', borderRadius: radius.pill },
  leaderFill_warm: { backgroundColor: yolk[500] },
  leaderFill_info: { backgroundColor: colors.info },
});

// --------------------------------------------------------------------------------------
// Trend bars
// --------------------------------------------------------------------------------------
/**
 * A week of work, as bars.
 *
 * Drawn with plain views rather than a charting library: this app ships to handsets where
 * every kilobyte of JavaScript is a second of cold start, and a row of rectangles is a row of
 * rectangles. Seven fit across a phone with the day's name under each.
 *
 * **Every day is a bar, including the empty ones**, and an empty day keeps a visible stub so
 * the row reads as a calendar rather than as a chart with gaps in it. Today is Ink so the eye
 * lands on the day being asked about; the best day in the window is green; the rest are the
 * pale green that means "ordinary work" everywhere else in the product.
 */
export function TrendBars({
  days,
  bestDate,
  testID,
}: {
  days: { date: string; short_label: string; completed: number }[];
  bestDate?: string | null;
  testID?: string;
}): React.JSX.Element {
  const most = Math.max(...days.map(day => day.completed), 1);
  const today = days.length ? days[days.length - 1]?.date : undefined;

  return (
    <View style={styles.bars} testID={testID}>
      {days.map(day => {
        const isToday = day.date === today;
        const isBest = !isToday && !!bestDate && day.date === bestDate;
        return (
          <View key={day.date} style={styles.barColumn} testID={`${testID}-${day.date}`}>
            {/* The day's count on a yolk disc above its bar, so seven small numbers read as
                seven figures rather than as labels. A quiet day keeps a paler disc with its
                zero, so the row stays a row. */}
            <View
              style={[
                styles.barBadge,
                !day.completed && styles.barBadgeQuiet,
                isToday && styles.barBadgeToday,
              ]}
              testID={`${testID}-${day.date}-count`}
            >
              <Text
                style={[styles.barValue, !day.completed && styles.barValueQuiet]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {day.completed}
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  // A floor rather than zero height: a day with no work is a fact about the
                  // day, and a bar of nothing reads as a day the chart forgot.
                  { height: `${Math.max((day.completed / most) * 100, 4)}%` },
                  isToday && styles.barToday,
                  isBest && styles.barBest,
                ]}
              />
            </View>
            <Text style={[styles.barDay, isToday && styles.barDayToday]} numberOfLines={1}>
              {day.short_label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Leader
// --------------------------------------------------------------------------------------
export type LeaderTone = 'warm' | 'info';

/**
 * One row of a "busiest" list: its place, what it is called, its figure, and a bar as long as
 * its share of the leader.
 *
 * Every fact on it carries its label — *Mait name*, *Vendor code* — because a manager reads a
 * code back over the phone and should not have to guess which of two numbers it was. A white
 * row on the card's own wash, with the rank on a disc of the card's colour, so the list reads
 * as a podium rather than as more text.
 *
 * The bar is relative to the busiest row rather than to a target, because the villages in a
 * zone differ by an order of magnitude and there is no per-Mait quota to draw against — a bar
 * that pretended otherwise would be inventing a number.
 */
export function Leader({
  rank,
  facts,
  value,
  unit,
  share,
  tone,
  testID,
}: {
  rank: number;
  facts: { label: string; value: string }[];
  value: number;
  unit: string;
  share: number;
  tone: LeaderTone;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.leader} testID={testID}>
      <View style={styles.leaderLine}>
        <View style={[styles.rank, styles[`rank_${tone}`]]}>
          <Text style={styles.rankLabel}>{rank}</Text>
        </View>
        <View style={styles.leaderBody}>
          {facts.map(fact => (
            <Text key={fact.label} style={styles.leaderFact} numberOfLines={1}>
              <Text style={[styles.leaderFactLabel, styles[`leaderFactLabel_${tone}`]]}>
                {`${fact.label}: `}
              </Text>
              {fact.value || '—'}
            </Text>
          ))}
        </View>
        <View style={styles.leaderFigure}>
          <Text style={[styles.leaderValue, styles[`leaderValue_${tone}`]]}>{value}</Text>
          <Text style={styles.leaderUnit}>{unit}</Text>
        </View>
      </View>
      <View style={[styles.leaderTrack, styles[`leaderTrack_${tone}`]]}>
        <View
          style={[
            styles.leaderFill,
            styles[`leaderFill_${tone}`],
            { width: `${Math.max(share * 100, 3)}%` },
          ]}
        />
      </View>
    </View>
  );
}
