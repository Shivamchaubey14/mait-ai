/**
 * The zone, as a manager opens the app to see it.
 *
 * Their first question is not *what is waiting on me* — that is the Indents tab, one tap away
 * with the count on it. Their first question is **is my zone working**, and it has an answer
 * with a shape: how much happened today, this week and this month, and where the week is
 * heading. So the screen is arranged as that question being answered, from the three figures
 * down to the individual captures landing at the bottom.
 *
 * **Live, like the portal's dashboard.** It re-reads itself every half minute while it is on
 * screen and at once when the app comes back to the front (`./live`), and the hero says when
 * the figures last landed — a number with no age on it is a number nobody can trust.
 *
 * Four bands:
 *
 * 1. **The hero** names the zone and says how fresh the figures are. Tapping that line
 *    fetches now, for somebody who does not want to wait out the beat.
 * 2. **Three tiles** — today, this week, this month — each in a colour of its own, each
 *    with the line under it that says what it is counted against.
 * 3. **The last seven days**, as bars on a green card. Today is Ink, the best day is green.
 * 4. **Who and where**, then **what just happened** — the feed of the last few captures,
 *    which is what makes a zone feel like a place with people in it rather than a total.
 *    Each is a colour of its own — yolk for the people, blue for the places, green for the
 *    work landing — and every name on them carries its code, labelled, because a code is
 *    what a manager reads back over the phone.
 */

import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import { useGetZonalDashboardQuery } from '@api/endpoints';
import { clock } from '@/components/frame';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { useLive } from './live';
import { Leader, rowStyles, Tile, Tiles, TrendBars, ZonalHero, zonalStyles } from './parts';

/** A week of bars: seven fit across a handset with room for the day's name under each. */
const TREND_DAYS = 7;

/** Today, yesterday, or the date — the way somebody says when something happened. */
function whenLabel(iso: string, t: (key: string) => string, language: string): string {
  const then = new Date(iso);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) {
    return clock(iso);
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (then.toDateString() === yesterday.toDateString()) {
    return t('zonal.yesterday');
  }
  return then.toLocaleDateString(language, { day: 'numeric', month: 'short' });
}

export default function DashboardScreen({
  zoneName,
  onOpenEvent,
}: {
  zoneName: string;
  /** A row in the feed is a door onto the whole record — straw, photo, place, trail. */
  onOpenEvent: (eventId: number) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();

  const board = useGetZonalDashboardQuery({ days: TREND_DAYS }, useLive());

  const refreshing = board.isFetching && !board.isLoading;
  const refresh = () => {
    board.refetch();
  };

  const data = board.data;
  const delta = data?.on_yesterday ?? 0;
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const now = new Date();

  /**
   * How fresh the figures are, in the words the portal's indicator uses. Yolk when the last
   * beat failed and what is on screen is older than it looks.
   */
  const landed = board.fulfilledTimeStamp
    ? clock(new Date(board.fulfilledTimeStamp).toISOString())
    : '';
  const stale = board.isError && !!data;
  const liveLabel = board.isFetching
    ? t('zonal.liveUpdating')
    : stale
      ? t('zonal.liveStale', { time: landed })
      : landed
        ? t('zonal.liveUpdated', { time: landed })
        : t('zonal.liveUpdating');

  const body = () => {
    if (board.isLoading) {
      return <SkeletonList rows={5} />;
    }
    if (board.isError || !data) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={refresh}
          busy={board.isFetching}
          testID="zonal-dashboard-error"
        />
      );
    }

    return (
      <>
        {/* The zone's three spans, a colour each: green for today's work, blue for the week,
            yolk for the month. The line under each says what the figure is counted against —
            today against yesterday, which is the comparison somebody asks for next. */}
        <Tiles>
          <Tile
            label={t('zonal.today')}
            value={data.today}
            note={
              delta === 0
                ? t('zonal.sameAsYesterday')
                : delta > 0
                  ? t('zonal.upOnYesterday', { count: delta })
                  : t('zonal.downOnYesterday', { count: -delta })
            }
            tone="good"
            testID="zonal-today"
          />
          <Tile
            label={t('zonal.thisWeek')}
            value={data.week}
            note={t('zonal.thisWeekShort')}
            tone="info"
            testID="zonal-week"
          />
          <Tile
            label={t('zonal.thisMonth')}
            value={data.month}
            note={`${months[now.getMonth()] ?? ''} ${now.getFullYear()}`}
            tone="waiting"
            testID="zonal-month"
          />
        </Tiles>

        <View style={[zonalStyles.card, styles.chartCard]} testID="zonal-trend-card">
          <View style={styles.cardHead}>
            <Text style={[zonalStyles.cardTitle, styles.chartTitle]}>
              {t('zonal.lastSevenDays')}
            </Text>
            <Text style={[zonalStyles.cardMeta, styles.chartMeta]}>
              {data.best_day
                ? t('zonal.bestDay', {
                    count: data.best_day.completed,
                    day: data.best_day.label,
                  })
                : t('zonal.noWorkYet')}
            </Text>
          </View>
          <TrendBars days={data.trend} bestDate={data.best_day?.date} testID="zonal-trend" />
        </View>

        {/* Still on somebody's handset or waiting on money. Its own line, in yolk, because it
            is not work done and counting it as such would overstate the zone every day. */}
        {data.in_progress > 0 && (
          <View style={styles.aside} testID="zonal-in-progress">
            <Ionicons name="hourglass-outline" size={18} color={colors.secondaryPressed} />
            <Text style={styles.asideText}>
              {t('zonal.inProgress', { count: data.in_progress })}
            </Text>
          </View>
        )}

        {!!data.busiest_maits.length && (
          <View style={[zonalStyles.card, styles.cardWarm]} testID="zonal-busiest-maits">
            <View style={styles.cardHead}>
              <View style={styles.headTitle}>
                <View style={[styles.headChip, styles.headChipWarm]}>
                  <Ionicons name="people" size={15} color={colors.surface} />
                </View>
                <Text style={[zonalStyles.cardTitle, styles.titleWarm]}>
                  {t('zonal.busiestMaits')}
                </Text>
              </View>
              <Text style={[zonalStyles.cardMeta, styles.metaWarm]}>
                {t('zonal.thisWeekShort')}
              </Text>
            </View>
            {data.busiest_maits.map((row, index) => (
              <Leader
                key={row.mait_id ?? row.name}
                rank={index + 1}
                facts={[
                  { label: t('zonal.maitNameLabel'), value: row.name },
                  { label: t('zonal.vendorCodeLabel'), value: row.code ?? '' },
                ]}
                value={row.events}
                unit={t('zonal.aiUnit')}
                share={row.share}
                tone="warm"
                testID={`zonal-top-mait-${row.mait_id}`}
              />
            ))}
          </View>
        )}

        {!!data.busiest_villages.length && (
          <View style={[zonalStyles.card, styles.cardInfo]} testID="zonal-busiest-villages">
            <View style={styles.cardHead}>
              <View style={styles.headTitle}>
                <View style={[styles.headChip, styles.headChipInfo]}>
                  <Ionicons name="location" size={15} color={colors.surface} />
                </View>
                <Text style={[zonalStyles.cardTitle, styles.titleInfo]}>
                  {t('zonal.busiestVillages')}
                </Text>
              </View>
              <Text style={[zonalStyles.cardMeta, styles.metaInfo]}>
                {t('zonal.thisWeekShort')}
              </Text>
            </View>
            {data.busiest_villages.map((row, index) => (
              <Leader
                key={row.mpp_code ?? row.name}
                rank={index + 1}
                facts={[
                  { label: t('zonal.mppLabel'), value: `${row.name} · ${row.mpp_code}` },
                  { label: t('zonal.plantLabel'), value: row.plant_name ?? '' },
                ]}
                value={row.events}
                unit={t('zonal.aiUnit')}
                share={row.share}
                tone="info"
                testID={`zonal-top-village-${row.mpp_code}`}
              />
            ))}
          </View>
        )}

        <View style={styles.sectionHead}>
          <View style={[styles.headChip, styles.headChipGreen]}>
            <Ionicons name="flash" size={14} color={colors.surface} />
          </View>
          <Text style={styles.sectionTitle}>{t('zonal.justHappened')}</Text>
        </View>
        {data.happening.length ? (
          data.happening.map(capture => (
            <Pressable
              key={capture.id}
              accessibilityRole="button"
              accessibilityLabel={t('zonal.openCapture', {
                breed: capture.breed || t('zonal.unknownBreed'),
                mpp: capture.mpp_name,
              })}
              onPress={() => onOpenEvent(capture.id)}
              style={({ pressed }) => [styles.capture, pressed && styles.capturePressed]}
              testID={`zonal-capture-${capture.id}`}
            >
              <View style={styles.captureDisc}>
                <Glyph name={STRAW_GLYPH} size={16} color={colors.surface} />
              </View>
              <View style={styles.captureBody}>
                <Text style={styles.captureTitle} numberOfLines={1}>
                  {capture.breed || t('zonal.unknownBreed')}
                </Text>
                <Text style={styles.captureMeta} numberOfLines={1}>
                  <Text style={styles.captureLabel}>{`${t('zonal.mppLabel')}: `}</Text>
                  {[capture.mpp_name, capture.mpp_code].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.captureMeta} numberOfLines={1}>
                  <Text style={styles.captureLabel}>{`${t('zonal.theMait')}: `}</Text>
                  {[capture.mait_name, capture.mait_code].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={styles.captureWhen}>
                <Text style={styles.captureWhenLabel}>
                  {whenLabel(capture.when, t, i18n.language)}
                </Text>
              </View>
              {/* The chevron is what says these rows open. Without it a manager reads them
                  as a ticker and never finds the record behind them. */}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        ) : (
          <Text style={rowStyles.quiet}>{t('zonal.nothingHappened')}</Text>
        )}
      </>
    );
  };

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        eyebrow={t('zonal.dashboardEyebrow')}
        title={zoneName || t('zonal.dashboardEyebrow')}
        testID="zonal-dashboard-hero"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('zonal.liveRefresh')}
          onPress={refresh}
          style={({ pressed }) => [styles.live, pressed && styles.livePressed]}
          testID="zonal-live"
        >
          <View style={[styles.liveDot, stale && styles.liveDotStale]} />
          <Text style={styles.liveLabel}>{liveLabel}</Text>
          <Ionicons name="refresh" size={14} color={colors.surface} />
        </Pressable>
      </ZonalHero>

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginBottom: spacing[3],
  },

  // The portal's indicator, on the Ink: a green dot while the beat is landing, yolk when the
  // last one failed and the figures are older than they look.
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  livePressed: { backgroundColor: 'rgba(255,255,255,0.24)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: green[400] },
  liveDotStale: { backgroundColor: yolk[500] },
  liveLabel: { ...typography.caption, color: colors.surface },

  // The chart on the green wash it is drawn in, so the week reads as the zone's work rather
  // than as one more white panel.
  chartCard: { backgroundColor: colors.primaryWash, borderColor: green[200] },
  chartTitle: { color: colors.primaryDark },
  chartMeta: { color: green[700] },

  aside: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.secondaryWash,
  },
  asideText: { ...typography.caption, color: colors.ink, flex: 1 },

  // The two "busiest" cards, each on its own wash with its glyph on a solid chip of the
  // same colour: yolk for the people, blue for the places.
  cardWarm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  cardInfo: { backgroundColor: colors.infoWash, borderColor: colors.info },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  headChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headChipWarm: { backgroundColor: yolk[500] },
  headChipInfo: { backgroundColor: colors.info },
  headChipGreen: { backgroundColor: colors.primary },
  titleWarm: { color: yolk[900] },
  metaWarm: { color: yolk[800] },
  titleInfo: { color: colors.info },
  metaInfo: { color: colors.info },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  sectionTitle: { ...typography.h3, color: colors.ink },

  // Each capture on the green that means "work done" everywhere in this product.
  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.primaryWash,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: green[200],
  },
  capturePressed: { backgroundColor: green[100] },
  captureDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  captureBody: { flex: 1 },
  captureTitle: { ...typography.bodyStrong, color: colors.primaryDark },
  captureMeta: { ...typography.caption, color: colors.ink, marginTop: 1 },
  captureLabel: { fontFamily: typography.label.fontFamily, color: green[700] },
  captureWhen: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  captureWhenLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.primaryDark,
  },
});
