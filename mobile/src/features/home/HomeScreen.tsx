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
 */

import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListAiEventsQuery } from '@api/endpoints';
import { LanguageToggle } from '@/components/brand';
import PageHero from '@/components/hero';
import Problem from '@/components/problem';
import PullToRefresh from '@/components/pullToRefresh';
import { EmptyState, SkeletonList } from '@/components/states';
import { useAppSelector } from '@/store';
import { colors, radius, spacing, typography } from '@theme/tokens';

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

/** Initials for the avatar. Two at most — three letters in a circle stop being readable. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) {
    return '?';
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (first.charAt(0) + (last ? last.charAt(0) : '')).toUpperCase();
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
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const user = useAppSelector(state => state.auth.user);
  const mppCodes = useAppSelector(state => state.auth.assignedMppCodes);

  const stock = useGetInventorySummaryQuery();
  const events = useListAiEventsQuery();

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
    await Promise.all([stock.refetch(), events.refetch()]);
  }, [events, onSync, stock]);

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

  // The Sahayak vendor code, which is what a Mait is known by on their paperwork, in the
  // portal and in SAP. This used to print `maitId` — a row id that matches nothing anywhere
  // outside this database — under a "MAIT" label, which is worse than showing nothing: a Mait
  // reading it out to the office would be read back a blank look. Falls back to nothing at
  // all rather than to the row id.
  const meta = [
    user?.sahayakVendorCode ? t('home.maitCode', { code: user.sahayakVendorCode }) : null,
    t('home.mppCount', { count: mppCodes.length }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.root}>
      <PageHero
        title={user?.fullName ?? ''}
        subtitle={meta}
        top={
          <>
            <LanguageToggle variant="compact" />
            <View style={styles.avatar}>
              <Text style={styles.avatarLabel}>{initialsOf(user?.fullName ?? '')}</Text>
            </View>
          </>
        }
      />

      {/* Where the work is, before anything else. A Mait who does not know whether today's
          records left the phone cannot judge anything else on this screen. */}
      {!online && (
        <View style={styles.offline} testID="sync-offline">
          <Ionicons name="cloud-offline-outline" size={17} color={colors.surface} />
          <Text style={styles.offlineLabel}>{t('home.offlineStrip')}</Text>
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
          <View style={styles.tiles}>
            <View style={[styles.tile, styles.tileDone]}>
              <View style={styles.tileHead}>
                <View style={[styles.tileIcon, styles.tileIconDone]}>
                  <Ionicons name="checkmark" size={13} color={colors.surface} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {t('home.today')}
                </Text>
              </View>
              {events.isLoading ? (
                <View style={styles.tileSkeleton} />
              ) : (
                <Text style={[styles.tileValue, styles.tileValueDone]}>{today.length}</Text>
              )}
              <Text style={styles.tileFoot} numberOfLines={1}>
                {t('home.inseminationsRecorded')}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onOpenQueue}
              style={[styles.tile, styles.tileWaiting]}
              testID="tile-waiting"
            >
              <View style={styles.tileHead}>
                <Ionicons name="time-outline" size={17} color={colors.secondaryPressed} />
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {t('home.waiting')}
                </Text>
              </View>
              <Text style={[styles.tileValue, styles.tileValueWaiting]}>{pending}</Text>
              <Text style={styles.tileFoot} numberOfLines={1}>
                {pending > 0
                  ? t('home.eventsToSync')
                  : lastSyncAt
                    ? t('home.allSentBody', { time: lastSyncAt })
                    : t('home.allSentBodyPlain')}
              </Text>
            </Pressable>
          </View>

          {/* Stock, because it decides whether the day can start at all. */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('home.strawsWithYou')}</Text>
              {!stock.isLoading && !stock.isError && (
                <Text style={styles.cardMeta}>{t('home.totalStraws', { count: totalStraws })}</Text>
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
                    <View key={breed} style={styles.breedRow} testID={`breed-${breed}`}>
                      <View style={[styles.dot, low && styles.dotLow]} />
                      <Text style={styles.breedName} numberOfLines={1}>
                        {breed}
                      </Text>
                      {low && (
                        <View style={[styles.lowBadge, styles.lowBadgeOnWash]}>
                          <Text style={styles.lowLabel}>{t('home.low')}</Text>
                        </View>
                      )}
                      <Text style={styles.breedCount}>{count}</Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>

          {unfinished.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenUnfinished}
              style={({ pressed }) => [styles.unfinished, pressed && styles.unfinishedPressed]}
              testID="resume-unfinished"
            >
              <Ionicons name="create-outline" size={17} color={colors.secondaryPressed} />
              <Text style={styles.unfinishedLabel} numberOfLines={1}>
                {unfinished.length === 1 && unfinished[0]
                  ? t('home.unfinished', { name: unfinished[0].owner_name })
                  : t('unfinished.openList', { count: unfinished.length })}
              </Text>
              <Text style={styles.resume}>{t('home.resume')}</Text>
            </Pressable>
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
            accessibilityState={{ disabled: totalStraws === 0 && !stock.isLoading }}
            onPress={totalStraws === 0 && !stock.isLoading ? onOpenStock : onStartCapture}
            style={({ pressed }) => [
              styles.cta,
              totalStraws === 0 && !stock.isLoading ? styles.ctaEmpty : styles.ctaReady,
              pressed && styles.ctaPressed,
            ]}
            testID="home-start-ai"
          >
            <Ionicons
              name={totalStraws === 0 && !stock.isLoading ? 'cube-outline' : 'add'}
              size={20}
              color={colors.surface}
            />
            <Text style={styles.ctaLabel}>
              {totalStraws === 0 && !stock.isLoading ? t('home.seeStock') : t('home.startNewAi')}
            </Text>
          </Pressable>
        </View>
      </PullToRefresh>
    </View>
  );
}

/** At or below this, a breed is called out. One straw is a coincidence; two is a warning. */
const LOW_BREED_STRAWS = 2;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing[5], paddingBottom: spacing[4] },

  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { ...typography.label, color: colors.surface },

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
  offlineLabel: { ...typography.label, color: colors.surface },

  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  // Centred, the way the portal's stat tile is. Two figures read as a pair are scanned left
  // to right, and centring puts them on one sightline instead of two ragged left edges — and
  // the number is the thing being read, so it belongs under the middle of its own card.
  tile: {
    flex: 1,
    alignItems: 'center',
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  tileDone: { backgroundColor: colors.successWash, borderColor: colors.primary },
  tileWaiting: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  tileIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIconDone: { backgroundColor: colors.primary },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  // Two figures, two colours, both already meaning this elsewhere in the product: green is
  // done, yellow is pending.
  tileValue: { ...typography.display, marginTop: spacing[2], textAlign: 'center' },
  tileValueDone: { color: colors.primaryDark },
  tileValueWaiting: { color: colors.secondaryPressed },
  // One line, always. Wrapped to two it made one tile taller than the other, so a pair meant
  // to be read side by side sat at different heights.
  tileFoot: { ...typography.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  tileSkeleton: {
    width: 48,
    height: 36,
    marginTop: spacing[2],
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  // The breed rows sit on the wash now, so the "Low" badge needs a ground of its own to stay
  // legible — amber on pale blue is a badge that has stopped being a badge.
  lowBadgeOnWash: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.secondary,
  },

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
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  cardTitle: { ...typography.h3, color: colors.ink },
  cardMeta: { ...typography.caption, color: colors.textMuted },

  breedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  dotLow: { backgroundColor: colors.secondary },
  breedName: { ...typography.body, color: colors.text, flex: 1 },
  lowBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.secondaryWash,
  },
  lowLabel: { ...typography.caption, fontSize: 11, color: colors.secondaryPressed },
  breedCount: { ...typography.bodyStrong, color: colors.ink, minWidth: 24, textAlign: 'right' },

  unfinished: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[4],
    marginBottom: spacing[4],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.secondary,
    backgroundColor: colors.secondaryWash,
  },
  unfinishedPressed: { opacity: 0.7 },
  unfinishedLabel: { ...typography.body, color: colors.ink, flex: 1 },
  resume: { ...typography.bodyStrong, color: colors.primaryDark },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.md,
    // `auto` on top, so the button sits just above the tab bar whatever is above it: it takes
    // the slack on a day with three breeds, and takes none on a day with fifteen because the
    // flask has already used it. This is what the old spacer view did, without the view. The
    // gap over it belongs to the cards above, which still have theirs when the slack is zero.
    marginTop: 'auto',
  },
  ctaReady: { backgroundColor: colors.primary },
  // Not greyed out: at zero straws the button still has somewhere useful to send them.
  ctaEmpty: { backgroundColor: colors.textMuted },
  ctaPressed: { opacity: 0.85 },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
});
