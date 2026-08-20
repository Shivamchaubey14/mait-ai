/**
 * Moving between pages.
 *
 * A Mait taps Inventory on a handset that takes most of a second to draw it, and until it
 * arrives the screen still says Home. There is nothing to tell them the tap registered, so
 * they tap again — and nothing to tell them they hit the wrong tab, which they only learn
 * once the wrong screen finally appears. The card fixes the second problem more than the
 * first: the destination is legible immediately, so a mistap is caught in the moment rather
 * than after the wait.
 *
 * It is not decoration and it is deliberately not everywhere. Steps inside the capture flow
 * get a plain slide, a sheet slides over its parent, and going back gets no card at all —
 * arriving somewhere is what wants announcing; returning is reversal, and a Mait going back
 * already knows where they are going.
 *
 * ---
 *
 * **Timing, 700ms.** Exit 0–125, hold 125–500, the card leaves 500–620, the new screen
 * settles 500–700. The route commits at 500 rather than when the screen is ready, because a
 * card that flashes for eighty milliseconds on a fast handset is worse than no card: it reads
 * as a glitch. The hold is the whole point of the thing.
 *
 * **The commit is timed, not hung off the animation.** `useNativeDriver` delivers its
 * completion callback from the native side, which does not exist under Jest and cannot be
 * relied on to arrive at all — a route that never commits is a Mait stuck on the screen they
 * left. `sheetMotion.ts` reached the same conclusion for the same reason.
 *
 * **Nothing here blocks input.** The scrim and the card are `pointerEvents="none"`, and a
 * second tap mid-flight cancels the transition outright and starts the new one. Never a
 * queue: two queued transitions mean a Mait watches a screen they have already changed their
 * mind about.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useReducedMotion } from '@/components/reducedMotion';
import { ROUTES, announces } from '@/navigation/routes';
import type { RouteKey } from '@/navigation/routes';
import { colors, fonts, ink, radius, spacing } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------------------
const EXIT_MS = 125;
/** When the route actually changes. The hold is the 375ms between the exit and this. */
const COMMIT_MS = 500;
const CARD_OUT_MS = 120;
const SETTLE_MS = 200;

/** Back is reversal: the exit and the settle, with the card's hold taken out between them. */
const BACK_COMMIT_MS = EXIT_MS;

/** A step inside the capture flow. Short, horizontal, and no card. */
const SLIDE_MS = 190;
const SLIDE_DISTANCE = 28;

/** Reduced motion: no scrim, no scale, no card — the two screens simply cross-fade. */
const REDUCED_MS = 120;

const EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const BAR_EASE = Easing.bezier(0.3, 0.7, 0.3, 1);

/** How far the outgoing screen goes, and how far the incoming one rises from. */
const DIM_TO = 0.55;
const SCALE_TO = 0.965;
const RISE_FROM = 10;
const SCRIM_TO = 0.34;

/** The card's own exit. */
const CARD_RISE = 10;
const CARD_SCALE_TO = 0.97;

type Mode = 'card' | 'back' | 'slideForward' | 'slideBack';

export interface RouteTransition {
  /** Announce a destination, then commit. Falls back to an instant commit if it is not one. */
  go: (to: RouteKey, commit: () => void) => void;
  /** Reversal. Exit and settle, no card. */
  back: (commit: () => void) => void;
  /** A step inside the capture flow. Horizontal slide, no card. */
  slide: (direction: 'forward' | 'back', commit: () => void) => void;
  /** No animation at all — for anything that is the same page under a different tab. */
  jump: (commit: () => void) => void;
  /**
   * The destination while one is in flight, so the tab bar can light before the screen
   * changes. Null once committed.
   */
  pending: RouteKey | null;
  /** Everything the host needs to draw. Not for callers. */
  readonly internals: Internals;
}

interface Internals {
  screen: Animated.Value;
  scrim: Animated.Value;
  card: Animated.Value;
  progress: Animated.Value;
  phase: 'idle' | 'leaving' | 'arriving';
  mode: Mode;
  showing: RouteKey | null;
  reduced: boolean;
}

export function useRouteTransition(): RouteTransition {
  const reduced = useReducedMotion();

  const screen = useRef(new Animated.Value(0)).current;
  const scrim = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  const [pending, setPending] = useState<RouteKey | null>(null);
  const [phase, setPhase] = useState<Internals['phase']>('idle');
  const [mode, setMode] = useState<Mode>('card');
  /** The route named on the card. Held past `pending` so the card can finish leaving. */
  const [showing, setShowing] = useState<RouteKey | null>(null);

  const running = useRef<Animated.CompositeAnimation | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    running.current?.stop();
    running.current = null;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Nothing may outlive the navigator. A commit fired after unmount sets state on a component
  // that is gone, and a stopped app is exactly when that goes unnoticed.
  useEffect(() => clear, [clear]);

  const reset = useCallback(() => {
    screen.setValue(0);
    scrim.setValue(0);
    card.setValue(0);
    progress.setValue(0);
    setPhase('idle');
    setPending(null);
    setShowing(null);
  }, [card, progress, screen, scrim]);

  /**
   * The one path every mode goes through.
   *
   * `leave` runs, the route changes at `commitAt`, then the new screen settles. Cancelling is
   * the first thing it does, which is what makes a second tap replace the first rather than
   * join a queue.
   */
  const run = useCallback(
    (next: Mode, to: RouteKey | null, commit: () => void) => {
      clear();

      if (reduced) {
        // A cross-fade and nothing else. No scrim, no scale, no card.
        setMode(next);
        setPhase('leaving');
        setPending(to);
        Animated.timing(screen, {
          toValue: 1,
          duration: REDUCED_MS / 2,
          useNativeDriver: true,
        }).start();
        after(REDUCED_MS / 2, () => {
          commit();
          setPending(null);
          setPhase('arriving');
          screen.setValue(1);
          Animated.timing(screen, {
            toValue: 0,
            duration: REDUCED_MS / 2,
            useNativeDriver: true,
          }).start(() => setPhase('idle'));
        });
        return;
      }

      const carded = next === 'card';
      const sliding = next === 'slideForward' || next === 'slideBack';
      const commitAt = carded ? COMMIT_MS : sliding ? 0 : BACK_COMMIT_MS;

      setMode(next);
      setPhase('leaving');
      setPending(to);
      setShowing(carded ? to : null);

      screen.setValue(0);
      scrim.setValue(0);
      card.setValue(0);
      progress.setValue(0);

      if (sliding) {
        /**
         * A step slides in; it does not slide out first.
         *
         * The shell renders one screen at a time, so a true push — two screens moving
         * together, one leaving as the other arrives — would mean mounting both and is a
         * bigger change than a step transition is worth. What is here is the arriving half:
         * the new step comes in from the side it came from. It is honest about direction,
         * which is the part that carries meaning, and it commits immediately, so no step in
         * the flow is slower to answer than it was before.
         */
        commit();
        setPending(null);
        setPhase('arriving');
        screen.setValue(1);
        running.current = Animated.timing(screen, {
          toValue: 0,
          duration: SLIDE_MS,
          easing: EASE,
          useNativeDriver: true,
        });
        running.current.start();
        after(SLIDE_MS, reset);
        return;
      }

      const leaving: Animated.CompositeAnimation[] = [
        Animated.timing(screen, {
          toValue: 1,
          duration: EXIT_MS,
          easing: EASE,
          useNativeDriver: true,
        }),
        Animated.timing(scrim, {
          toValue: 1,
          duration: EXIT_MS,
          easing: EASE,
          useNativeDriver: true,
        }),
      ];

      if (carded) {
        leaving.push(
          Animated.timing(card, {
            toValue: 1,
            duration: EXIT_MS,
            easing: EASE,
            useNativeDriver: true,
          }),
          // Starts where the card settles and runs the length of the hold, so the bar is a
          // picture of the wait rather than an ornament on it.
          Animated.sequence([
            Animated.delay(EXIT_MS),
            Animated.timing(progress, {
              toValue: 1,
              duration: COMMIT_MS - EXIT_MS,
              easing: BAR_EASE,
              useNativeDriver: true,
            }),
          ]),
        );
      }

      running.current = Animated.parallel(leaving);
      running.current.start();

      after(commitAt, () => {
        commit();
        setPending(null);
        setPhase('arriving');

        // The screen value is reused for the settle: it was driving the outgoing screen's
        // dim, and now drives the incoming one's rise. Reset to 1 so `arriving` reads it as
        // "fully out" and animates it back to nothing.
        screen.setValue(1);

        const arriving: Animated.CompositeAnimation[] = [
          Animated.timing(screen, {
            toValue: 0,
            duration: SETTLE_MS,
            easing: EASE,
            useNativeDriver: true,
          }),
          Animated.timing(scrim, {
            toValue: 0,
            duration: SETTLE_MS,
            easing: EASE,
            useNativeDriver: true,
          }),
        ];
        if (carded) {
          arriving.push(
            Animated.timing(card, {
              toValue: 2,
              duration: CARD_OUT_MS,
              easing: EASE,
              useNativeDriver: true,
            }),
          );
        }
        running.current = Animated.parallel(arriving);
        running.current.start();
        after(SETTLE_MS, reset);
      });
    },
    [after, card, clear, progress, reduced, reset, screen, scrim],
  );

  const go = useCallback(
    (to: RouteKey, commit: () => void) => {
      // A destination that does not announce itself still gets the screen movement, just
      // without the card — the alternative is one page snapping in while its neighbours fade.
      run(announces(to) ? 'card' : 'back', to, commit);
    },
    [run],
  );

  const back = useCallback((commit: () => void) => run('back', null, commit), [run]);

  const slide = useCallback(
    (direction: 'forward' | 'back', commit: () => void) =>
      run(direction === 'forward' ? 'slideForward' : 'slideBack', null, commit),
    [run],
  );

  const jump = useCallback(
    (commit: () => void) => {
      clear();
      reset();
      commit();
    },
    [clear, reset],
  );

  return {
    go,
    back,
    slide,
    jump,
    pending,
    internals: { screen, scrim, card, progress, phase, mode, showing, reduced },
  };
}

// --------------------------------------------------------------------------------------
// The host
// --------------------------------------------------------------------------------------
/**
 * Wraps the page area. The children are whatever the shell is currently rendering; this moves
 * them, lays the scrim over them and floats the card above that.
 */
export function RouteTransitionHost({
  transition,
  children,
}: {
  transition: RouteTransition;
  children: React.ReactNode;
}): React.JSX.Element {
  const { screen, scrim, card, progress, phase, mode, showing, reduced } = transition.internals;

  const sliding = mode === 'slideForward' || mode === 'slideBack';
  // Arriving from the side it came from: forward comes in from the right, back from the left.
  const slideFrom = mode === 'slideForward' ? SLIDE_DISTANCE : -SLIDE_DISTANCE;

  const opacity = screen.interpolate({
    inputRange: [0, 1],
    // Reduced motion fades right out and back; the full transition only dims.
    outputRange: [1, reduced || sliding ? 0 : DIM_TO],
  });

  const pageStyle = reduced
    ? { opacity }
    : sliding
      ? {
          opacity,
          transform: [
            { translateX: screen.interpolate({ inputRange: [0, 1], outputRange: [0, slideFrom] }) },
          ],
        }
      : {
          opacity,
          transform: [
            {
              scale: screen.interpolate({
                inputRange: [0, 1],
                // Leaving shrinks; arriving comes in at full size and rises instead.
                outputRange: [1, phase === 'arriving' ? 1 : SCALE_TO],
              }),
            },
            {
              translateY: screen.interpolate({
                inputRange: [0, 1],
                outputRange: [0, phase === 'arriving' ? RISE_FROM : 0],
              }),
            },
          ],
        };

  return (
    <View style={styles.host}>
      <Animated.View style={[styles.page, pageStyle]}>{children}</Animated.View>

      {!reduced && !sliding && phase !== 'idle' && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scrim,
            { opacity: scrim.interpolate({ inputRange: [0, 1], outputRange: [0, SCRIM_TO] }) },
          ]}
          testID="route-scrim"
        />
      )}

      {!reduced && mode === 'card' && !!showing && phase !== 'idle' && (
        <RouteCard route={showing} card={card} progress={progress} />
      )}
    </View>
  );
}

/**
 * The card itself.
 *
 * Never interactive — it is a label on a wait, and something tappable floating over the
 * screen for four hundred milliseconds is something a Mait will tap.
 */
function RouteCard({
  route,
  card,
  progress,
}: {
  route: RouteKey;
  card: Animated.Value;
  progress: Animated.Value;
}): React.JSX.Element {
  const { t } = useTranslation();
  const meta = ROUTES[route];
  /** Measured, because scaling from the left is the one thing RN transforms will not do. */
  const [barWidth, setBarWidth] = useState(0);

  // 0 is arriving, 1 is settled, 2 is leaving. One value carries both ends so the card cannot
  // be caught half in and half out.
  const opacity = card.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const translateY = card.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [CARD_RISE, 0, -CARD_RISE],
  });
  const scale = card.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [CARD_SCALE_TO, 1, CARD_SCALE_TO],
  });

  return (
    <View style={styles.cardLayer} pointerEvents="none">
      <Animated.View
        style={[styles.card, { opacity, transform: [{ translateY }, { scale }] }]}
        testID="route-card"
      >
        <View style={styles.row}>
          <View style={styles.iconTile}>
            <Ionicons name={meta.icon} size={19} color={colors.surface} />
          </View>

          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1} testID="route-card-title">
              {t(meta.title)}
            </Text>
            <Text style={styles.context} numberOfLines={1}>
              {t(meta.context)}
            </Text>
          </View>
        </View>

        <View style={styles.track} onLayout={event => setBarWidth(event.nativeEvent.layout.width)}>
          <Animated.View
            style={[
              styles.fill,
              {
                transform: [
                  // `transform-origin: left`, which React Native does not have: everything
                  // scales about its centre, so the bar is pushed back by half of what the
                  // scale takes off it. Without the measurement it would grow from the middle
                  // in both directions.
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-barWidth / 2, 0],
                    }),
                  },
                  { scaleX: progress },
                ],
              },
            ]}
            testID="route-card-progress"
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  page: { flex: 1 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    // rgba(12,21,27,.34) — the darkest step of the ink scale, carried at 34% by the animated
    // opacity above rather than baked into a colour this palette does not have.
    backgroundColor: ink[900],
  },

  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    // Dead centre, horizontally and vertically. It sat at 44% of the height to keep clear of
    // the thumb that had just tapped the bottom bar; centred it reads as the one thing on
    // screen, which is what it is for the four hundred milliseconds it is up.
    justifyContent: 'center',
  },
  card: {
    minWidth: 196,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.ink,
    shadowColor: ink[900],
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 30,
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flexShrink: 1 },
  title: { fontFamily: fonts.headingBold, fontSize: 16, lineHeight: 21, color: colors.surface },
  context: { fontFamily: fonts.body, fontSize: 11, lineHeight: 15, color: ink[200] },

  track: {
    height: 3,
    marginTop: 11,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  // Absolute and full width, so `scaleX` has something to scale. A fill sized by its own
  // content would be nought points wide and would scale to nought points.
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
});
