/**
 * Your indents — what has been asked for, and what is waiting at the depot (M22).
 *
 * Reached from Profile. It used to hang off Inventory, which was the wrong place for it:
 * Inventory answers "what is in my flask right now", and an indent is by definition stock
 * that is not in it yet. Two lists of things that look like stock, one of which is not, on
 * one tab.
 *
 * The screen answers one question — is anything waiting for me to collect — and the headline
 * answers it before a single row is read. Every row then says what was asked for, where it
 * has got to, and what the Mait should do about it in words rather than in a status code.
 *
 * **Issued is not received.** The dairy's system marks an indent issued when the depot packs
 * it; the stock becomes the Mait's when they pick it up and confirm, and only then does the
 * count on Inventory move. A Mait who reads "issued" as "in my flask" will start a round they
 * cannot finish, so the screen says the difference at the foot rather than leaving it to be
 * learned once, expensively.
 *
 * The search box is gone and the status chips are back. The two were removed together on one
 * argument — a Mait has tens of indents, not hundreds, and the controls cost more room than
 * the rows they filtered — but that argument only ever held for the search box. Status is the
 * axis this screen is actually asked about ("was anything turned down", "what have I already
 * collected"), the chips carry their counts so the common questions are answered without a
 * tap, and the row scrolls sideways instead of taking a second line.
 */

import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useListBreedsQuery, useListIndentsQuery } from '@api/endpoints';
import type { Indent } from '@api/types';
import Glyph, { GlyphName, STRAW_GLYPH } from '@/components/glyph';
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** 24-hour, because a Mait reading a timeline wants the order, not the am/pm puzzle. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Where an indent has actually got to, from the Mait's side.
 *
 * Five states, not the server's four. `received_at` is the difference: once a Mait has
 * collected, the server still calls the indent `issued` — correctly, since issuing is the last
 * thing *it* did — and the row was saying "Issued" underneath a line reading "Collected 18 Aug
 * · it is in your stock". The status word is the thing being scanned down a list of twenty, so
 * it has to be the one that is true.
 */
export type IndentState = 'requested' | 'approved' | 'issued' | 'collected' | 'rejected';

export const INDENT_STATES: IndentState[] = [
  'requested',
  'approved',
  'issued',
  'collected',
  'rejected',
];

export function indentState(indent: Indent): IndentState {
  // Anything at a counter waiting on the Mait reads as issued, whatever the indent's own
  // status: a store short of stock hands over part of an approval, and those straws are just
  // as much a trip to the depot as a whole issue is.
  if ((indent.qty_to_collect ?? 0) > 0) {
    return 'issued';
  }
  return indent.received_at ? 'collected' : indent.status;
}

/**
 * The colour a state wears, in this product's own vocabulary.
 *
 * Green is done, amber is waiting on you, blue is a fact about where it has got to, red is
 * refused, grey is nothing has happened yet. `issued` is amber rather than green for the
 * reason the footnote at the bottom of this screen exists: issued is a trip to the depot, not
 * an ending, and drawing it in the colour of "finished" is the exact mistake being warned
 * against.
 */
export type IndentTone = 'plain' | 'info' | 'waiting' | 'good' | 'bad';

const TONES: Record<IndentState, IndentTone> = {
  requested: 'plain',
  approved: 'info',
  issued: 'waiting',
  collected: 'good',
  rejected: 'bad',
};

/**
 * Each tone as paint: the solid for a chip or a pill, what goes on it, the word colour on a
 * wash, and the wash and edge of a card. Exported so the detail screen wears the same.
 */
export const TONE_PAINT: Record<
  IndentTone,
  { solid: string; onSolid: string; word: string; wash: string; edge: string }
> = {
  plain: {
    solid: ink[400],
    onSolid: colors.surface,
    word: ink[600],
    wash: ink[50],
    edge: ink[100],
  },
  info: {
    solid: colors.info,
    onSolid: colors.surface,
    word: colors.info,
    wash: colors.infoWash,
    edge: colors.info,
  },
  waiting: {
    solid: yolk[500],
    onSolid: colors.ink,
    word: yolk[800],
    wash: colors.secondaryWash,
    edge: yolk[300],
  },
  good: {
    solid: colors.primary,
    onSolid: colors.surface,
    word: colors.primaryDark,
    wash: colors.primaryWash,
    edge: green[300],
  },
  bad: {
    solid: colors.error,
    onSolid: colors.surface,
    word: colors.error,
    wash: colors.errorWash,
    edge: colors.error,
  },
};

/** Each state's glyph: sent, agreed, at the counter, in the flask, turned down. */
export const STATE_GLYPH: Record<IndentState, GlyphName> = {
  requested: 'paper-plane',
  approved: 'thumbs-up',
  issued: 'storefront',
  collected: 'checkmark-done',
  rejected: 'close-circle',
};

export function toneOf(state: IndentState): IndentTone {
  return TONES[state];
}

/**
 * The state as a word and a colour, ready to draw.
 *
 * Translated rather than taken from the server's `status_display`, which is English-only and
 * has no word at all for the state the app adds. A screen that says "Issued" in the middle of
 * a Hindi sentence is a screen that has given up halfway.
 */
export function statusTone(indent: Indent, t: TFunction): { label: string; tone: IndentTone } {
  const state = indentState(indent);
  return { label: t(`indents.state_${state}`), tone: TONES[state] };
}

/**
 * What is outstanding on this indent, in the words a Mait would use.
 *
 * The status word alone says who is holding it; this says what happens next and who has to
 * do it. "Issued" is the one that matters — it reads like an ending and is a trip to the
 * depot.
 */
function nextStep(indent: Indent, t: TFunction): string {
  if (indent.received_at) {
    return t('indents.lineCollected', { date: shortDate(indent.received_at) });
  }
  if ((indent.qty_to_collect ?? 0) > 0) {
    return t('indents.lineIssued', {
      date: shortDate(indent.issued_at ?? indent.requested_at),
    });
  }
  // Part of it handed over and collected, the rest still owed by the store.
  if (indent.status === 'approved' && indent.qty_issued > 0) {
    return t('indents.linePart', { issued: indent.qty_issued, qty: indent.qty_requested });
  }
  switch (indent.status) {
    case 'issued':
      return t('indents.lineIssued', {
        date: shortDate(indent.issued_at ?? indent.requested_at),
      });
    case 'approved':
      return t('indents.lineApproved', { date: shortDate(indent.requested_at) });
    case 'rejected':
      return t('indents.lineRejected', { date: shortDate(indent.requested_at) });
    default:
      return t('indents.lineRequested', { date: shortDate(indent.requested_at) });
  }
}

export default function IndentsScreen({
  onOpen,
  onBack,
}: {
  onOpen: (indent: Indent) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<IndentState | 'all'>('all');
  const online = useOnline();

  const indents = useListIndentsQuery();
  const breeds = useListBreedsQuery();

  const hindi = i18n.language.startsWith('hi');
  const breedName = (code: string): string => {
    const config = (breeds.data ?? []).find(item => item.code === code);
    return (hindi && config?.name_hi) || config?.name || code;
  };

  const all = indents.data?.results ?? [];
  /** The only count worth a headline: what a Mait could go and fetch today. */
  const waiting = all.filter(indent => indentState(indent) === 'issued').length;

  /**
   * How many indents sit in each state, counted once off the whole list.
   *
   * On the chips rather than left to be discovered by tapping: the reason to filter by
   * "Rejected" at all is to find out whether anything was, and a chip that answers that
   * without being tapped has saved the tap.
   */
  const counts = all.reduce<Record<string, number>>((tally, indent) => {
    const state = indentState(indent);
    return { ...tally, [state]: (tally[state] ?? 0) + 1 };
  }, {});

  const rows = filter === 'all' ? all : all.filter(indent => indentState(indent) === filter);

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="indents-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
          {/* Where this was opened from, so a Mait three screens deep knows which way is out. */}
          <Text style={styles.eyebrow}>{t('nav.settings')}</Text>
        </View>

        <Text style={styles.heroTitle}>{t('indents.title')}</Text>
        <Text
          style={[styles.heroSubtitle, waiting > 0 && styles.heroSubtitleWaiting]}
          testID="indents-headline"
        >
          {waiting > 0
            ? t('indents.waitingToCollect', { count: waiting })
            : rows.length
              ? t('indents.nothingToCollect', { count: rows.length })
              : ''}
        </Text>
      </View>

      {/* Status chips, back after being taken out.

          They were removed on the grounds that a Mait has tens of indents rather than
          hundreds, and that the control cost more room than the rows it filtered. That holds
          for a *search box*; it does not hold for status, which is the one axis anybody
          actually asks this screen about — "was anything turned down", "what have I already
          collected". The chips carry their counts, so the common questions are answered
          without a tap, and the row scrolls sideways rather than wrapping to a second line
          and taking the height the old argument was about. */}
      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {(['all', ...INDENT_STATES] as const).map(key => {
            const active = key === filter;
            const count = key === 'all' ? all.length : (counts[key] ?? 0);
            // "All" in the ink of the header; each state in its own colour, filled when on.
            const paint =
              key === 'all'
                ? {
                    solid: colors.ink,
                    onSolid: colors.surface,
                    word: colors.ink,
                    wash: colors.surface,
                    edge: ink[300],
                  }
                : TONE_PAINT[TONES[key]];
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(key)}
                style={[
                  styles.filter,
                  active
                    ? { backgroundColor: paint.solid, borderColor: paint.solid }
                    : { backgroundColor: paint.wash, borderColor: paint.edge },
                ]}
                testID={`indent-filter-${key}`}
              >
                <Glyph
                  name={key === 'all' ? 'albums' : STATE_GLYPH[key]}
                  size={14}
                  color={active ? paint.onSolid : paint.word}
                />
                <Text
                  style={[styles.filterLabel, { color: active ? paint.onSolid : paint.word }]}
                  numberOfLines={1}
                >
                  {key === 'all' ? t('indents.filterAll') : t(`indents.state_${key}`)}
                </Text>
                {/* Only where there is something to count. A grey nought beside every unused
                    status turns the row into a report nobody asked for. */}
                {count > 0 && (
                  <View
                    style={[
                      styles.filterCount,
                      { backgroundColor: active ? colors.surface : paint.solid },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterCountLabel,
                        { color: active ? paint.word : paint.onSolid },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={indents.isFetching && !indents.isLoading}
            onRefresh={indents.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {indents.isLoading ? (
          <SkeletonList rows={4} />
        ) : indents.isError ? (
          <Problem
            kind={online ? 'server' : 'offline'}
            onRetry={() => indents.refetch()}
            busy={indents.isFetching}
            testID="indents-error"
          />
        ) : rows.length === 0 ? (
          // Two different nothings. "You have never raised one" and "none of yours are in
          // this state" want different answers, and only one of them is worth a way out.
          all.length > 0 ? (
            <EmptyState
              title={t('indents.emptyFilterTitle', { status: t(`indents.state_${filter}`) })}
              body={t('indents.emptyFilterBody')}
            />
          ) : (
            <EmptyState title={t('indents.emptyTitle')} body={t('indents.emptyBody')} />
          )
        ) : (
          rows.map(indent => {
            const status = statusTone(indent, t);
            const state = indentState(indent);
            const collectable = state === 'issued';
            const paint = TONE_PAINT[status.tone];
            return (
              <Pressable
                key={indent.id}
                accessibilityRole="button"
                accessibilityLabel={`IND-${indent.id} · ${status.label}`}
                onPress={() => onOpen(indent)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: paint.wash, borderColor: paint.edge },
                  pressed && styles.rowPressed,
                ]}
                testID={`indent-${indent.id}`}
              >
                {/* What was asked for, on the colour of where it has got to. */}
                <View style={[styles.chip, { backgroundColor: paint.solid }]}>
                  <Glyph
                    name={indent.breed ? STRAW_GLYPH : 'flask'}
                    size={20}
                    color={paint.onSolid}
                  />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {t('stock.indentLine', {
                      id: indent.id,
                      item: indent.breed ? breedName(indent.breed) : indent.item,
                      qty: indent.qty_requested,
                    })}
                  </Text>
                  <Text
                    style={[styles.rowMeta, { color: collectable ? yolk[800] : paint.word }]}
                    numberOfLines={2}
                  >
                    {nextStep(indent, t)}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: paint.solid }]}>
                    <Glyph name={STATE_GLYPH[state]} size={11} color={paint.onSolid} />
                    <Text style={[styles.pillLabel, { color: paint.onSolid }]} numberOfLines={1}>
                      {status.label}
                    </Text>
                  </View>
                </View>

                <View style={[styles.go, { borderColor: paint.solid }]}>
                  <Ionicons name="chevron-forward" size={16} color={paint.word} />
                </View>
              </Pressable>
            );
          })
        )}

        {/* The sentence this whole screen exists to prevent somebody learning the hard way. */}
        {rows.length > 0 && filter !== 'collected' && filter !== 'rejected' && (
          <View style={styles.footnote} testID="indents-footnote">
            <View style={[styles.chipSmall, { backgroundColor: yolk[500] }]}>
              <Ionicons name="warning" size={16} color={colors.ink} />
            </View>
            <Text style={styles.footnoteText}>{t('indents.issuedIsNotReceived')}</Text>
          </View>
        )}
      </ScrollView>
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
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  eyebrow: { ...typography.label, color: colors.surface, opacity: 0.72 },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  // Yolk on the dark header: something is at a counter waiting for them.
  heroSubtitleWaiting: {
    alignSelf: 'flex-start',
    opacity: 1,
    color: colors.ink,
    backgroundColor: yolk[500],
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    marginTop: spacing[2],
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...typography.label,
  },

  // -- rows ------------------------------------------------------------------------------
  body: { padding: spacing[4] },
  // Every row in the wash of where it has got to, the colour of its pill.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowPressed: { opacity: 0.85 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSmall: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  // -- status chips ----------------------------------------------------------------------
  filterWrap: { paddingTop: spacing[4] },
  // The padding lives on the content rather than on the ScrollView, so the first chip starts
  // at the gutter and the last one can still scroll clear of the edge.
  filters: { paddingHorizontal: spacing[4], gap: spacing[2] },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET - 8,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  filterLabel: { ...typography.label },
  filterCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: yolk[300],
  },
  footnoteText: { ...typography.caption, color: yolk[800], flex: 1 },
});
