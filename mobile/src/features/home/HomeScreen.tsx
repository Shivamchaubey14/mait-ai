/**
 * Home (M0) — where a Mait lands after signing in.
 *
 * Answers the questions they have before starting a round, in the order they have them: has my
 * work left the phone, what did I do today, how many straws do I hold, and is anything half
 * finished. Only then the action, because "Start new AI" is meaningless if the answer to the
 * straw question is zero.
 *
 * Every list here has four states and all four are built: loading, empty, error, and loaded.
 * The error state says the queued records are safe, since on a handset holding unsent
 * inseminations that is the actual question rather than what the server did.
 *
 * **In the product's colours** (docs/DESIGN_SYSTEM.md, *Coloured screen pattern*): green for
 * the day's work, yolk for what is waiting, blue for the straws — each with its glyph on a
 * solid chip, and a straw drawn as a syringe. Every breed is a row of its own, tinted yolk
 * when it is running low, and the count sits on a badge rather than floating at the edge.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListAiEventsQuery } from '@api/endpoints';
import AppText from '@/components/AppText';
import { LanguageToggle } from '@/components/brand';
import DateRangeSheet, { formatRange } from '@/components/dateRange';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import PageHero from '@/components/hero';
import Problem from '@/components/problem';
import PullToRefresh from '@/components/pullToRefresh';
import { useReducedMotion } from '@/components/reducedMotion';
import { EmptyState, SkeletonList } from '@/components/states';
import { useAppSelector } from '@/store';
import { colors, green, ink, radius, spacing, typography, yolk } from '@theme/tokens';

interface Props {
  onOpenStock: () => void;
  onStartCapture: () => void;
  /** Picks a half-finished event back up at the step it stopped at. */
  /** Opens the list of captures still owed a finish. */
  onOpenUnfinished: () => void;
  /** Live from NetInfo, so the banner reflects the radio rather than the last failed call. */
  online: boolean;
  pending: number;
  /**
   * Push what is queued, staying on this screen.
   *
   * Separate from `onOpenQueue` because pull-to-refresh calls it. The two used to be one prop,
   * so tugging the page down to reload it navigated away to the waiting list — a gesture that
   * everywhere else in the world means "show me this screen again" was the one way to leave it.
   */
  onSync: () => void;
  /** Open the waiting list. The yellow tile, and only the yellow tile. */
  onOpenQueue: () => void;
  lastSyncAt: string | null;
  /**
   * How many things on this phone need the Mait (`NeedsAttentionScreen`) — refused records,
   * payment codes owed, office codes not on record, unfinished captures.
   *
   * Given, the red card counts all of them and opens that list; it used to count only the
   * unfinished captures, and the rest had no way onto Home at all. Absent, it falls back to
   * the unfinished count and list.
   */
  attentionCount?: number;
  onOpenAttention?: () => void;
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

/** By the hour on the handset, the way the Indent app greets the same people. */
function greeting(now = new Date()): {
  key: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
} {
  const hour = now.getHours();
  // The sun where it is: coming up over the horizon, high, going down.
  if (hour < 12) {
    return { key: 'home.goodMorning', icon: 'weather-sunset-up' };
  }
  if (hour < 17) {
    return { key: 'home.goodAfternoon', icon: 'white-balance-sunny' };
  }
  return { key: 'home.goodEvening', icon: 'weather-sunset-down' };
}

export default function HomeScreen({
  onOpenStock,
  onStartCapture,
  onOpenUnfinished,
  online,
  pending,
  onSync,
  onOpenQueue,
  lastSyncAt,
  attentionCount,
  onOpenAttention,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const user = useAppSelector(state => state.auth.user);
  const mppCodes = useAppSelector(state => state.auth.assignedMppCodes);

  const stock = useGetInventorySummaryQuery();
  const events = useListAiEventsQuery();

  // Every insemination this Mait has finished through the app — all time, or over the dates
  // they pick. Read off the server's `count`, not the rows: the list above is one page, and a
  // Mait with four hundred inseminations should not download four hundred to see a number.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [pickingDates, setPickingDates] = useState(false);
  const total = useListAiEventsQuery({
    status: 'completed',
    dateFrom: range?.from,
    dateTo: range?.to,
  });
  const months = t('calendar.months', { returnObjects: true }) as string[];

  /**
   * What a pull means here: the holding, the day's events, and a shove at whatever is still
   * stuck on the phone.
   *
   * Awaited rather than fired and forgotten, so the dots stop when the work does. The queue
   * flush is deliberately not awaited *for its result* — it can fail all it likes; a pull with
   * no signal still finishes with a tick, and the offline strip above is what explains it.
   */
  const refresh = useCallback(async () => {
    onSync();
    await Promise.all([stock.refetch(), events.refetch(), total.refetch()]);
  }, [events, onSync, stock, total]);

  const today = (events.data?.results ?? []).filter(event => isToday(event.created_at));

  // Everything still owed a finish, whatever step it stopped on and whatever day it was
  // started. This used to be one event — a straw verified today whose photo never arrived —
  // and every other abandoned capture was simply invisible, which for work already done is
  // the worst kind of missing record. The list itself lives on its own screen; what Home
  // carries is the count and the way in.
  const unfinished = (events.data?.results ?? []).filter(
    event => !['completed', 'cancelled'].includes(event.status),
  );

  const byBreed = Object.entries(stock.data?.by_breed ?? {}).sort((a, b) => b[1] - a[1]);
  const totalStraws = stock.data?.total_straws ?? 0;
  /** Nothing in the flask, so the button sends the Mait to stock instead of into a capture. */
  const noStraws = totalStraws === 0 && !stock.isLoading;

  // The Sahayak vendor code, which is what a Mait is known by on their paperwork, in the
  // portal and in SAP. This used to print `maitId` — a row id that matches nothing anywhere
  // outside this database — under a "MAIT" label, which is worse than showing nothing: a Mait
  // reading it out to the office would be read back a blank look. Falls back to nothing at
  // all rather than to the row id.
  const hello = greeting();
  const mpps = t('home.mppCount', { count: mppCodes.length });
  const code = user?.sahayakVendorCode ?? null;

  return (
    <View style={styles.root}>
      {/* Who this is, said the way the Indent app says it: a greeting, the name, and what
          they are known by as chips. The initials circle that sat in the corner repeated the
          name in two letters and said nothing else. */}
      <PageHero
        eyebrow={t(hello.key)}
        eyebrowIcon={<MaterialCommunityIcons name={hello.icon} size={26} color={yolk[400]} />}
        title={user?.fullName ?? ''}
        top={<LanguageToggle variant="inline" />}
      >
        <View style={styles.chips} testID="home-identity">
          {!!code && (
            <View style={styles.chip}>
              <Ionicons name="id-card" size={13} color={colors.primary} />
              {/* The label and the number as two pieces, not one string. Android measures a
                  line of Hindi narrower than it draws it, so "मैत कोड: 5500000054" as one
                  string wrapped at the space and the number fell outside the chip. Digits on
                  their own are measured exactly. */}
              <AppText style={styles.chipLabel}>{t('home.maitCodeLabel')}</AppText>
              <AppText style={styles.chipLabel} testID="home-mait-code">
                {code}
              </AppText>
            </View>
          )}
          <View style={styles.chip}>
            <Ionicons name="location" size={13} color={colors.primary} />
            <AppText style={styles.chipLabel}>{mpps}</AppText>
          </View>
        </View>
      </PageHero>

      {/* Where the work is, before anything else. A Mait who does not know whether today's
          records left the phone cannot judge anything else on this screen. */}
      {!online && (
        <View style={styles.offline} testID="sync-offline">
          <View style={styles.offlineChip}>
            <Ionicons name="cloud-offline" size={15} color={colors.ink} />
          </View>
          <AppText style={styles.offlineLabel}>{t('home.offlineStrip')}</AppText>
        </View>
      )}

      {/* The page does not scroll. Everything on it is something a Mait reads before starting
          a round — how the day is going, whether the work has gone up, whether they hold
          enough straws to begin — and the button that begins it. A screen where the button
          moves off the bottom as soon as a twelfth breed arrives is a screen where the answer
          to "can I start" depends on how far you have scrolled.

          So the frame is fixed and the one part that grows is the part that can afford to:
          the flask. Its card takes what is left after the tiles, the unfinished row and the
          button have had theirs, and the breeds scroll inside it. */}
      <PullToRefresh onRefresh={refresh} label={t('pull.holding')} testID="home-pull">
        <View style={styles.body}>
          {/* One slim row rather than two tall tiles: the number is the whole message, so it
              sits in a pill at the end of a line that says what it counts, and the flask under
              it keeps the room. */}
          <View style={styles.tiles}>
            <View style={styles.today} testID="tile-today">
              <View style={styles.todayIcon}>
                <Ionicons name="checkmark" size={16} color={colors.surface} />
              </View>
              <AppText style={styles.todayLabel} numberOfLines={1}>
                {t('home.todayCount')}
              </AppText>
              {events.isLoading ? (
                <View style={styles.countSkeleton} />
              ) : (
                <View style={styles.todayCount}>
                  <AppText style={styles.todayCountLabel} testID="tile-today-count">
                    {today.length}
                  </AppText>
                </View>
              )}
            </View>

            {/* Only while something is actually waiting to go. A capture now goes up the moment
                it is recorded, so "0 waiting" on every visit was a box about nothing. */}
            {pending > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${pending} ${t('home.eventsToSync')}`}
                onPress={onOpenQueue}
                style={({ pressed }) => [styles.waiting, pressed && styles.waitingPressed]}
                testID="tile-waiting"
              >
                <Ionicons name="time" size={15} color={colors.ink} />
                <AppText style={styles.waitingCount}>{pending}</AppText>
                <AppText style={styles.waitingLabel}>{t('home.waiting')}</AppText>
              </Pressable>
            )}
          </View>

          {/* The whole of the work, under the day's share of it. Slate, a colour of its own:
              green is today, yolk is waiting, blue is the flask — this is the record. */}
          <View style={styles.total} testID="tile-total">
            <View style={styles.totalIcon}>
              <Ionicons name="ribbon" size={18} color={colors.ink} />
            </View>
            <View style={styles.totalText}>
              <AppText style={styles.totalLabel} numberOfLines={1}>
                {t('home.totalAi')}
              </AppText>
              <AppText style={styles.totalRange} numberOfLines={1} testID="tile-total-range">
                {range
                  ? t('home.totalRange', { range: formatRange(range.from, range.to, months) })
                  : t('home.totalAllTime')}
              </AppText>
            </View>
            {total.isLoading || (total.isFetching && !total.data) ? (
              <View style={styles.totalSkeleton} />
            ) : (
              <AppText style={styles.totalCount} testID="tile-total-count">
                {total.isError ? '—' : (total.data?.count ?? 0).toLocaleString('en-IN')}
              </AppText>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('home.pickDates')}
              onPress={() => setPickingDates(true)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.totalDates,
                !!range && styles.totalDatesOn,
                pressed && styles.waitingPressed,
              ]}
              testID="tile-total-dates"
            >
              <Ionicons name="calendar" size={18} color={range ? colors.ink : yolk[400]} />
            </Pressable>
          </View>

          {/* Stock, because it decides whether the day can start at all. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardChip}>
                <Glyph name={STRAW_GLYPH} size={16} color={colors.surface} />
              </View>
              <AppText style={styles.cardTitle}>{t('home.strawsWithYou')}</AppText>
              {!stock.isLoading && !stock.isError && (
                <View style={styles.cardTotal} testID="home-straw-total">
                  <AppText style={styles.cardTotalLabel}>
                    {t('home.totalStraws', { count: totalStraws })}
                  </AppText>
                </View>
              )}
            </View>

            {/* The only scrolling thing on the screen, and where pull-to-refresh now lives —
              the gesture belongs to the list it reloads. */}
            <ScrollView
              style={styles.breeds}
              contentContainerStyle={styles.breedsContent}
              showsVerticalScrollIndicator={false}
            >
              {stock.isLoading ? (
                <SkeletonList rows={3} />
              ) : stock.isError ? (
                // Worth its own state: a Mait who cannot see their balance does not know whether
                // they can work, and the answer to that is not "reload the app".
                <Problem
                  // The cause, not the screen. "Could not load your holding" names our
                  // problem; a Mait needs to know whether to walk somewhere with signal or
                  // to carry on working, and those are different answers.
                  kind={online ? 'server' : 'offline'}
                  onRetry={() => stock.refetch()}
                  busy={stock.isFetching}
                  pending={pending}
                  lastReachedAt={lastSyncAt}
                  testID="stock-error"
                />
              ) : byBreed.length === 0 ? (
                <EmptyState title={t('home.noStrawsTitle')} body={t('home.noStrawsBody')} />
              ) : (
                byBreed.map(([breed, count]) => {
                  // Per breed, not against the flask total: eight straws is a comfortable day
                  // unless they are the only Murrah left and the next three farmers keep buffalo.
                  const low = count <= LOW_BREED_STRAWS;
                  return (
                    <View
                      key={breed}
                      style={[styles.breedRow, low && styles.breedRowLow]}
                      testID={`breed-${breed}`}
                    >
                      <View style={[styles.breedChip, low && styles.breedChipLow]}>
                        <Glyph
                          name={STRAW_GLYPH}
                          size={13}
                          color={low ? colors.ink : colors.surface}
                        />
                      </View>
                      <AppText style={styles.breedName} numberOfLines={1}>
                        {breed}
                      </AppText>
                      {low && (
                        <View style={styles.lowBadge}>
                          <Ionicons name="warning" size={11} color={colors.ink} />
                          <AppText style={styles.lowLabel}>{t('home.low')}</AppText>
                        </View>
                      )}
                      <View style={[styles.breedCountBadge, low && styles.breedCountBadgeLow]}>
                        <AppText style={[styles.breedCount, low && styles.breedCountLow]}>
                          {count}
                        </AppText>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>

          {attentionCount !== undefined && onOpenAttention
            ? attentionCount > 0 && (
                <UnfinishedWarning
                  count={attentionCount}
                  title={t('home.attentionWarning')}
                  detail={t('home.attentionDetail', { count: attentionCount })}
                  onPress={onOpenAttention}
                />
              )
            : unfinished.length > 0 && (
                <UnfinishedWarning
                  count={unfinished.length}
                  detail={
                    unfinished.length === 1 && unfinished[0]
                      ? t('home.unfinishedFor', { name: unfinished[0].owner_name })
                      : t('unfinished.openList', { count: unfinished.length })
                  }
                  onPress={onOpenUnfinished}
                />
              )}

          {events.isError && (
            <Problem
              kind={online ? 'server' : 'offline'}
              onRetry={() => events.refetch()}
              busy={events.isFetching}
              pending={pending}
              lastReachedAt={lastSyncAt}
              testID="events-error"
            />
          )}

          {/* The screen's one action, at the foot of the screen's own content rather than
            floating in the tab bar. Disabled at zero straws, because the flow would stop dead
            at the scan step with an animal already served. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: noStraws }}
            onPress={noStraws ? onOpenStock : onStartCapture}
            style={({ pressed }) => [
              styles.cta,
              noStraws ? styles.ctaEmpty : styles.ctaReady,
              pressed && styles.ctaPressed,
            ]}
            testID="home-start-ai"
          >
            {/* Words alone, either way: the label says what the button does, and an icon beside
                it said nothing more. */}
            <AppText style={styles.ctaLabel}>
              {noStraws ? t('home.seeStock') : t('home.startNewAi')}
            </AppText>
          </Pressable>
        </View>
      </PullToRefresh>

      <DateRangeSheet
        visible={pickingDates}
        from={range?.from ?? null}
        to={range?.to ?? null}
        onClose={() => setPickingDates(false)}
        onApply={(from, to) => {
          setRange({ from, to });
          setPickingDates(false);
        }}
        onClear={() => {
          setRange(null);
          setPickingDates(false);
        }}
      />
    </View>
  );
}

/**
 * A capture left half done, said as a fault to put right rather than a note.
 *
 * Solid red, and glowing: an AI recorded on the animal and not on the books is a farmer who
 * will be asked about a service she already had, and a straw the flask is short of tonight.
 * It was a quiet yellow row that a Mait read past. The glow is a halo behind the card rather
 * than the card itself moving, so the words never shift under a thumb — and it holds still
 * for a handset that has asked for less motion.
 */
function UnfinishedWarning({
  count,
  title,
  detail,
  onPress,
}: {
  count: number;
  /** The headline; the unfinished-capture wording unless the card is counting more than that. */
  title?: string;
  detail: string;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      glow.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: GLOW_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: GLOW_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, reduced]);

  return (
    <View style={styles.warnWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.warnGlow,
          {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }),
            transform: [
              { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
            ],
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t('home.resume')}
        onPress={onPress}
        style={({ pressed }) => [styles.warn, pressed && styles.warnPressed]}
        testID="resume-unfinished"
      >
        <View style={styles.warnChip}>
          {/* A siren, not a triangle: the warning triangle is on every notice in the app, and
              this is the one thing on Home that is a fault the Mait has to go back and fix. */}
          <MaterialCommunityIcons name="alarm-light" size={18} color={colors.error} />
          {count > 1 && (
            <View style={styles.warnCount}>
              <AppText style={styles.warnCountLabel}>{count}</AppText>
            </View>
          )}
        </View>
        <View style={styles.warnBody}>
          {/* One line: it is a headline, and two lines of it pushed the flask off the screen. */}
          <AppText style={styles.warnTitle} numberOfLines={1}>
            {title ?? t('home.unfinishedWarning')}
          </AppText>
          <AppText style={styles.warnDetail} numberOfLines={1}>
            {detail}
          </AppText>
        </View>
        {/* A chevron rather than a "Resume" pill: the whole card is the button, and the pill took
            the width the warning needs to stay on one line. */}
        <Ionicons name="chevron-forward" size={20} color={colors.surface} />
      </Pressable>
    </View>
  );
}

/** One breath of the glow, in and out again. Slow enough to read as a warning, not a fault. */
const GLOW_MS = 900;

/** At or below this, a breed is called out. One straw is a coincidence; two is a warning. */
const LOW_BREED_STRAWS = 2;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing[5], paddingBottom: spacing[4] },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  chipLabel: { ...typography.label, color: colors.surface },

  // Squared and full width, sitting tight under the hero — it is a condition the whole screen
  // is in, not a card inside it.
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[5],
    backgroundColor: colors.ink,
  },
  offlineChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[400],
  },
  offlineLabel: { ...typography.label, color: colors.surface, flex: 1 },

  tiles: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  today: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingLeft: spacing[2],
    paddingRight: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.successWash,
  },
  todayIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  // Across the space left, so a Hindi label is never measured short and cut.
  todayLabel: { ...typography.bodyStrong, color: colors.primaryDark, flex: 1 },
  todayCount: {
    minWidth: 40,
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  todayCountLabel: { ...typography.h2, color: colors.surface },
  countSkeleton: {
    width: 40,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  // Slate, the dark of the hero, so the record reads apart from the day's green tile above
  // it and the flask's blue below. A rounded square, the number large in white.
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  totalIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[400],
  },
  totalText: { flex: 1, gap: 2 },
  totalLabel: { ...typography.bodyStrong, color: colors.surface },
  totalRange: { ...typography.caption, color: ink[200] },
  totalCount: { ...typography.h1, color: colors.surface },
  totalSkeleton: {
    width: 56,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: ink[500],
  },
  totalDates: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ink[400],
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  totalDatesOn: { backgroundColor: yolk[400], borderColor: yolk[400] },
  // Yolk, for what is waiting on the network — the colour the waiting list already uses.
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.secondary,
    backgroundColor: colors.secondaryWash,
  },
  waitingPressed: { opacity: 0.75 },
  waitingCount: { ...typography.h3, color: colors.ink },
  waitingLabel: { ...typography.label, color: colors.ink },

  // `flexShrink`, never `flexGrow`: with three breeds the card is the height of three breeds,
  // and with fifteen it is as tall as the space left and no taller. Growing it would strand a
  // white pane of nothing under a short flask.
  card: {
    flexShrink: 1,
    // The same light blue the location card on an AI event wears. Blue is this product's
    // "here is a fact about your situation" colour — green is the action, amber is what is
    // waiting on you, red is what is wrong — and the flask is exactly that: not a thing to do,
    // but the fact everything else on this screen depends on. On white it was furniture, and
    // sat flat between two coloured tiles above it and a green button below.
    backgroundColor: colors.infoWash,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  // Also shrink-only, and it is what gives the ScrollView inside a bounded height to scroll
  // against — without it the list reports its full content height and nothing ever scrolls.
  breeds: { flexShrink: 1 },
  breedsContent: { flexGrow: 1 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  cardChip: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  cardTitle: { ...typography.h3, color: colors.info, flex: 1 },
  cardTotal: {
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  cardTotalLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // A breed is a row of its own, paper on the blue — and yolk once it is running low.
  breedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  breedRowLow: {
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: yolk[300],
  },
  breedChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  breedChipLow: { backgroundColor: yolk[500] },
  breedName: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  lowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: yolk[400],
  },
  lowLabel: {
    ...typography.caption,
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
  },
  breedCountBadge: {
    minWidth: 36,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignItems: 'center',
    backgroundColor: colors.infoWash,
  },
  breedCountBadgeLow: { backgroundColor: yolk[500] },
  breedCount: { ...typography.h3, color: colors.info },
  breedCountLow: { color: colors.ink },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    // `auto` on top, so the button sits just above the tab bar whatever is above it: it takes
    // the slack on a day with three breeds, and takes none on a day with fifteen because the
    // flask has already used it. This is what the old spacer view did, without the view. The
    // gap over it belongs to the cards above, which still have theirs when the slack is zero.
    marginTop: 'auto',
  },
  ctaReady: { backgroundColor: colors.primary },
  // Blue, not grey: at zero straws the button still has somewhere useful to send them, and
  // grey read as a button that was switched off.
  ctaEmpty: { backgroundColor: colors.info },
  ctaPressed: { opacity: 0.85 },
  // Across the button rather than sized to itself: Android measures a Hindi label narrower
  // than it draws it, and a label sized to that measurement wraps.
  ctaLabel: { ...typography.bodyStrong, color: colors.surface, flex: 1, textAlign: 'center' },

  // The halo sits under the card and only its opacity and size move, on the native driver.
  // Tight above and below: Home does not scroll, and every point this takes comes off the
  // flask card under it.
  warnWrap: { marginTop: spacing[2], marginBottom: spacing[3] },
  warnGlow: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    shadowColor: colors.error,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.error,
    // Above the halo on Android, where elevation decides what is drawn on top.
    elevation: 11,
  },
  warnPressed: { backgroundColor: colors.errorPressed },
  warnChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  // How many, on the chip's corner: one capture and five are different mornings.
  warnCount: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  warnCountLabel: {
    ...typography.caption,
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  warnBody: { flex: 1 },
  warnTitle: { ...typography.label, color: colors.surface },
  warnDetail: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    color: colors.surface,
    opacity: 0.85,
  },
});
