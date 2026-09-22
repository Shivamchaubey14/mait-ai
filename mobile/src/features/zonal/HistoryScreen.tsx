/**
 * History — every approval and rejection this manager has made.
 *
 * Not a log of actions: a record of **decisions**, which is the only part of the trail a
 * manager is ever asked about. Sign-ins and page reads belong on the portal's Audit log; here
 * they would be ninety rows burying the two that matter.
 *
 * Each row carries the request behind it and, on the right, **where it got to since** —
 * *Waiting at the depot* against something approved three weeks ago is the row somebody opens
 * their own history to find. A rejection reads back the reason the Mait was given, because
 * that is the sentence they will be asked to justify.
 *
 * The two figures at the top count the window rather than the page, so switching the filter
 * does not appear to change what happened.
 *
 * **In the colours every other zonal screen uses**: a green card for an approval and a red one
 * for a rejection, the verdict on a solid disc, the item's glyph beside what was asked for,
 * and — for an approval — the road it has taken since as three steps, *Approved → At the
 * depot → Handed over*, lit as far as it has got. A rejection shows the words the Mait was
 * given instead, on a white inset, because that sentence is what the row is looked up for.
 */

import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import { useGetZonalHistoryQuery } from '@api/endpoints';
import type { ZonalDecision } from '@api/types';
import { clock, itemLabel } from '@/components/frame';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { Pill, Segmented, Tile, Tiles, ZonalHero, zonalStyles } from './parts';
import { useLive } from './live';

type Outcome = 'all' | 'approved' | 'rejected';
type Window_ = '7' | '30' | '90';

function dayKey(iso: string): string {
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '' : date.toDateString();
}

function dayLabel(iso: string, t: (key: string) => string, language: string): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(iso) === now.toDateString()) {
    return t('zonal.today');
  }
  if (dayKey(iso) === yesterday.toDateString()) {
    return t('zonal.yesterday');
  }
  return new Date(iso).toLocaleDateString(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function HistoryScreen({ zoneName }: { zoneName: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();

  const [outcome, setOutcome] = useState<Outcome>('all');
  const [window_, setWindow] = useState<Window_>('30');
  const history = useGetZonalHistoryQuery({ days: Number(window_), outcome }, useLive());

  /** Decisions under the day they were taken. The server already sorts them newest first. */
  const days = useMemo(() => {
    const grouped: { key: string; rows: ZonalDecision[] }[] = [];
    for (const row of history.data?.results ?? []) {
      const key = dayKey(row.when);
      const last = grouped[grouped.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
      } else {
        grouped.push({ key, rows: [row] });
      }
    }
    return grouped;
  }, [history.data]);

  const summary = history.data?.summary;

  /**
   * The road an approval has taken since: approved, then waiting at the depot, then handed
   * over. Lit as far as it has got — the step it is on in yolk, the ones behind it green.
   */
  const journey = (row: ZonalDecision) => {
    const handedOver = row.status === 'issued';
    const backWithOffice = row.status === 'requested';
    const steps = [
      { key: 'approved', label: t('zonal.stepApproved'), icon: 'checkmark' as const },
      { key: 'depot', label: t('zonal.stepAtDepot'), icon: 'storefront' as const },
      { key: 'handed', label: t('zonal.stepHandedOver'), icon: 'cube' as const },
    ];
    const reached = backWithOffice ? 0 : handedOver ? 3 : 1;
    return (
      <View style={styles.journey} testID={`zonal-decision-${row.id}-journey`}>
        {steps.map((step, index) => {
          const done = index < reached;
          const current = index === reached && !handedOver && !backWithOffice;
          return (
            <React.Fragment key={step.key}>
              {index > 0 && <View style={[styles.link, done && styles.linkDone]} />}
              <View style={styles.step}>
                <View
                  style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotNow]}
                >
                  <Ionicons
                    name={step.icon}
                    size={12}
                    color={done ? colors.surface : current ? colors.ink : colors.textMuted}
                  />
                </View>
                <Text
                  style={[
                    styles.stepLabel,
                    done && styles.stepLabelDone,
                    current && styles.stepLabelNow,
                  ]}
                  numberOfLines={1}
                >
                  {step.label}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  const decisionRow = (row: ZonalDecision) => {
    const approved = row.outcome === 'approved';
    const item = row.item_name ? itemLabel(row, i18n.language) : '';
    const issued = row.qty_issued ?? 0;
    return (
      <View
        key={row.id}
        style={[styles.decision, approved ? styles.decisionGood : styles.decisionBad]}
        testID={`zonal-decision-${row.id}`}
      >
        <View style={styles.head}>
          {/* The verdict on a solid disc, so a column of them is scanned without a word. */}
          <View style={[styles.mark, approved ? styles.markGood : styles.markBad]}>
            <Ionicons name={approved ? 'checkmark' : 'close'} size={18} color={colors.surface} />
          </View>
          <View style={styles.headText}>
            <View style={styles.titleLine}>
              <View style={[styles.number, approved ? styles.numberGood : styles.numberBad]}>
                <Text style={styles.numberLabel}>
                  {row.indent_id ? `IND-${row.indent_id}` : t('zonal.goneIndent')}
                </Text>
              </View>
              <Text style={[styles.verdict, approved ? styles.verdictGood : styles.verdictBad]}>
                {t(approved ? 'zonal.youApproved' : 'zonal.youRejected')}
              </Text>
            </View>
            {!!item && (
              <View style={styles.itemLine}>
                <Glyph
                  name={row.product_type === 'consumable' ? 'cube' : STRAW_GLYPH}
                  size={13}
                  color={colors.info}
                />
                <Text style={styles.title} numberOfLines={1}>
                  {t('zonal.qtyItem', { qty: row.qty, item })}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.time}>
            <Ionicons name="time-outline" size={11} color={colors.textMuted} />
            <Text style={styles.timeLabel}>{clock(row.when)}</Text>
          </View>
        </View>

        {/* Who, and where from — each on a white inset with its label. */}
        <View style={styles.inset}>
          <Text style={styles.fact} numberOfLines={1}>
            <Text style={styles.factLabel}>{`${t('zonal.theMait')}: `}</Text>
            {[row.mait_name, row.mait_code].filter(Boolean).join(' · ') || '—'}
          </Text>
          {!!row.store_name && (
            <Text style={styles.fact} numberOfLines={1}>
              <Text style={styles.factLabel}>{`${t('zonal.depotLabel')}: `}</Text>
              {row.store_name}
            </Text>
          )}
        </View>

        {approved ? (
          <>
            {journey(row)}
            {/* Where it got to since — the whole reason to look back at your own decision. */}
            {!!row.status_label && (
              <View style={styles.since}>
                <Pill label={row.status_label} tone={row.status_tone} />
                {issued > 0 && issued < row.qty && (
                  <Text style={styles.sinceNote}>
                    {t('zonal.handedSoFar', { issued, qty: row.qty })}
                  </Text>
                )}
              </View>
            )}
          </>
        ) : (
          !!row.reason && (
            <View style={styles.reason}>
              <Ionicons name="chatbubble-ellipses" size={14} color={colors.error} />
              <Text style={styles.reasonText} numberOfLines={3}>
                {t('zonal.youSaid', { reason: row.reason })}
              </Text>
            </View>
          )
        )}
      </View>
    );
  };

  const body = () => {
    if (history.isLoading) {
      return <SkeletonList rows={5} />;
    }
    if (history.isError) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={history.refetch}
          busy={history.isFetching}
          testID="zonal-history-error"
        />
      );
    }
    if (!days.length) {
      return (
        <EmptyState
          title={t('zonal.historyEmptyTitle')}
          body={t('zonal.historyEmptyBody', { days: window_ })}
          testID="zonal-history-empty"
        />
      );
    }
    return (
      <>
        {days.map(day => (
          <View key={day.key}>
            <View style={styles.dayHead}>
              <View style={styles.dayChip}>
                <Ionicons name="calendar" size={13} color={colors.surface} />
              </View>
              <Text style={styles.day}>{dayLabel(day.rows[0]?.when ?? '', t, i18n.language)}</Text>
              <View style={styles.dayCount}>
                <Text style={styles.dayCountLabel}>{day.rows.length}</Text>
              </View>
            </View>
            {day.rows.map(decisionRow)}
          </View>
        ))}
      </>
    );
  };

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        eyebrow={t('zonal.historyEyebrow')}
        pill={zoneName}
        title={summary ? t('zonal.decisions', { count: summary.total }) : t('zonal.historyEyebrow')}
        subtitle={t('zonal.historySubtitle')}
        testID="zonal-history-hero"
      />

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={history.isFetching && !history.isLoading}
            onRefresh={history.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Tapping a figure filters to it — the shortest sentence for "show me those". */}
        <Tiles>
          <Tile
            icon="list"
            label={t('zonal.allTile')}
            value={summary?.total ?? '—'}
            tone="info"
            selected={outcome === 'all'}
            onPress={() => setOutcome('all')}
            testID="zonal-total-count"
          />
          <Tile
            icon="checkmark-circle"
            label={t('zonal.approvedTile')}
            value={summary?.approved ?? '—'}
            tone="good"
            selected={outcome === 'approved'}
            onPress={() => setOutcome(outcome === 'approved' ? 'all' : 'approved')}
            testID="zonal-approved-count"
          />
          <Tile
            icon="close-circle"
            label={t('zonal.rejectedTile')}
            value={summary?.rejected ?? '—'}
            tone={summary && summary.rejected > 0 ? 'bad' : 'plain'}
            selected={outcome === 'rejected'}
            onPress={() => setOutcome(outcome === 'rejected' ? 'all' : 'rejected')}
            testID="zonal-rejected-count"
          />
        </Tiles>

        <Segmented<Window_>
          value={window_}
          onChange={setWindow}
          testID="zonal-history-window"
          options={[
            { key: '7', label: t('zonal.days', { count: 7 }) },
            { key: '30', label: t('zonal.days', { count: 30 }) },
            { key: '90', label: t('zonal.days', { count: 90 }) },
          ]}
        />

        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // -- a day ------------------------------------------------------------------------------
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[1],
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
  day: { ...typography.h3, color: colors.ink, flex: 1 },
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

  // -- a decision --------------------------------------------------------------------------
  decision: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[2],
  },
  decisionGood: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  decisionBad: { backgroundColor: colors.errorWash, borderColor: colors.error },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGood: { backgroundColor: colors.primary },
  markBad: { backgroundColor: colors.error },
  headText: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  number: { paddingHorizontal: spacing[2], paddingVertical: 1, borderRadius: radius.pill },
  numberGood: { backgroundColor: colors.primaryDark },
  numberBad: { backgroundColor: colors.error },
  numberLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  verdict: { ...typography.caption, fontFamily: typography.label.fontFamily },
  verdictGood: { color: colors.primaryDark },
  verdictBad: { color: colors.error },
  itemLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1 },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  timeLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
  },

  inset: {
    gap: 2,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fact: { ...typography.caption, color: colors.ink, lineHeight: 18 },
  factLabel: { fontFamily: typography.label.fontFamily, color: yolk[800] },

  // -- the road since -------------------------------------------------------------------------
  journey: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  step: { alignItems: 'center', gap: 2, width: 76 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepDotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDotNow: { backgroundColor: yolk[400], borderColor: yolk[600] },
  stepLabel: { ...typography.caption, fontSize: 10, color: colors.textMuted },
  stepLabelDone: { color: colors.primaryDark, fontFamily: typography.label.fontFamily },
  stepLabelNow: { color: yolk[800], fontFamily: typography.label.fontFamily },
  link: {
    flex: 1,
    height: 2,
    marginBottom: 14,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  linkDone: { backgroundColor: colors.primary },

  since: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  sinceNote: { ...typography.caption, color: colors.ink },

  reason: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reasonText: { ...typography.caption, color: colors.ink, flex: 1, fontStyle: 'italic' },
});
