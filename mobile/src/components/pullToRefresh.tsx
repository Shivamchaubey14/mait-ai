/**
 * Pull to refresh, in this product's own handwriting.
 *
 * The platform spinner is a grey ring that says nothing except that something is happening.
 * On the screens a Mait pulls — their holding, their events, the records still stuck on the
 * phone — the question is never "is something happening", it is "has my work gone up yet". So
 * the indicator names what it is fetching, and the dots carry the answer before the words do:
 * a gauge while pulling, three green when it will fire, a bounce while it runs, a tick when
 * it is done.
 *
 * The word "Loading" appears nowhere. It is the one thing the strip could say that a Mait
 * cannot act on.
 *
 * ---
 *
 * **Built on `PanResponder`, not `RefreshControl`.** React Native's refresh control draws the
 * platform indicator and offers no way to replace it — on Android it is a native
 * `SwipeRefreshLayout`. So the gesture is ours: the container watches for a downward drag
 * while the list underneath is at its top, translates the content sheet down to uncover the
 * strip, and lets go.
 *
 * **It never claims a gesture it should not have.** Taps are not claimed at all, a drag is
 * only claimed when the scroll offset is at zero and the movement is more vertical than
 * horizontal, and nothing is claimed while a refresh is already running. A Mait can scroll,
 * open a record or start a capture with the dots still bouncing.
 *
 * **The sheet moves; the strip does not.** The strip sits behind, at a fixed height, and is
 * revealed. Animating both would have them drift apart by a pixel or two under load, which on
 * a strip this short reads as a fault.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useReducedMotion } from '@/components/reducedMotion';
import { colors, fonts, ink, radius } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Shape
// --------------------------------------------------------------------------------------
const STRIP = 80;
const DOT = 10;
const DOT_GAP = 7;
const COLUMN_GAP = 9;
const TICK = 26;

/** How far the sheet has to come down before releasing will refresh. */
const THRESHOLD = STRIP;
/** Past the threshold the pull keeps giving, but grudgingly, so it feels like an end. */
const MAX_PULL = STRIP + 40;
const RESISTANCE = 0.55;
/** Enough movement to be a drag rather than a slipped thumb on a row. */
const CLAIM_AT = 6;

// --------------------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------------------
const RISE = 11;
const CYCLE = 1050;
const STAGGER = 120;
const UP = 300;
const DOWN = 300;
const REST_OPACITY = 0.55;
const BOUNCE_EASE = Easing.bezier(0.35, 0, 0.35, 1);

/** How long the tick is held before the strip collapses. */
const DONE_MS = 400;
/**
 * The floor on the bouncing stage, so the whole thing lasts at least 600ms with the tick.
 *
 * A refresh that comes back in eighty milliseconds would otherwise flash and vanish, and a
 * Mait would be left unsure whether the pull registered at all — which is exactly the doubt
 * that makes somebody pull again.
 */
const MIN_SPIN_MS = 600 - DONE_MS;

const COLLAPSE_MS = 260;
const SETTLE_BACK_MS = 220;

type Stage = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'done';

// --------------------------------------------------------------------------------------
// Letting a nested list report where it is
// --------------------------------------------------------------------------------------
export interface PullScrollProps {
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
}

const PullScrollContext = createContext<PullScrollProps | null>(null);

/**
 * Spread onto the scrollable inside a `PullToRefresh`, so the gesture knows when the list is
 * at its top and a downward drag is a pull rather than a scroll.
 *
 * A screen whose body does not scroll — Home, whose frame is fixed on purpose — simply does
 * not call this, and every downward drag counts as a pull.
 */
export function usePullScroll(): PullScrollProps {
  const context = useContext(PullScrollContext);
  return (
    context ?? {
      onScroll: () => undefined,
      scrollEventThrottle: 16,
    }
  );
}

// --------------------------------------------------------------------------------------
// The indicator
// --------------------------------------------------------------------------------------
/**
 * Three dots and a line of text. Exported on its own because every stage of it can be checked
 * without a gesture, and a gesture is the expensive part to drive in a test.
 */
export function RefreshDots({
  stage,
  /** 0 to 1, how far through the pull. Only read while pulling. */
  ratio,
  label,
  reduced = false,
}: {
  stage: Stage;
  ratio: number;
  label: string;
  reduced?: boolean;
}): React.JSX.Element {
  const bounce = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const running = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (stage !== 'refreshing' || reduced) {
      running.current?.stop();
      running.current = null;
      bounce.forEach(value => value.setValue(0));
      return;
    }

    // Every dot's sequence adds up to exactly one cycle, so the three keep their spacing
    // instead of drifting apart over a long refresh — the trailing pause absorbs whatever
    // the leading stagger took.
    running.current = Animated.parallel(
      bounce.map((value, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(STAGGER * index),
            Animated.timing(value, {
              toValue: 1,
              duration: UP,
              easing: BOUNCE_EASE,
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: DOWN,
              easing: BOUNCE_EASE,
              useNativeDriver: true,
            }),
            Animated.delay(CYCLE - UP - DOWN - STAGGER * index),
          ]),
        ),
      ),
    );
    running.current.start();

    return () => {
      running.current?.stop();
      running.current = null;
    };
  }, [bounce, reduced, stage]);

  if (stage === 'done') {
    return (
      <View style={styles.column} testID="refresh-done">
        <View style={styles.tick}>
          <Ionicons name="checkmark" size={16} color={colors.surface} />
        </View>
      </View>
    );
  }

  // Filled left to right in proportion to the pull: one at a third, two at two thirds, three
  // at the threshold. Below a third the row is grey — a gauge reading zero, not a promise.
  const lit =
    stage === 'refreshing' || stage === 'ready'
      ? 3
      : ratio >= 1
        ? 3
        : ratio >= 2 / 3
          ? 2
          : ratio >= 1 / 3
            ? 1
            : 0;

  return (
    <View style={styles.column}>
      <View style={styles.dots} testID="refresh-dots">
        {bounce.map((value, index) => {
          const active = index < lit;
          const moving = stage === 'refreshing' && !reduced;
          return (
            <Animated.View
              key={index}
              testID={`refresh-dot-${index}${active ? '-on' : ''}`}
              style={[
                styles.dot,
                active ? styles.dotOn : styles.dotOff,
                moving && {
                  // Weight, not size. A dot that grows and shrinks is hard to read on a
                  // scratched screen in sunlight; one that darkens and fades is not.
                  opacity: value.interpolate({
                    inputRange: [0, 1],
                    outputRange: [REST_OPACITY, 1],
                  }),
                  transform: [
                    {
                      translateY: value.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -RISE],
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}
      </View>

      {/* Only once the pull means something. A label under a grey row is a caption on
          nothing, and it is the first thing a thumb covers on the way down. */}
      {stage !== 'idle' && lit > 0 && (
        <Text style={styles.label} numberOfLines={1} testID="refresh-label">
          {label}
        </Text>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The container
// --------------------------------------------------------------------------------------
/** Starting a refresh without a thumb — see the note on the ref below. */
export interface PullHandle {
  refresh: () => void;
}

function PullToRefreshInner(
  {
    onRefresh,
    label,
    children,
    testID,
  }: {
    /**
     * What a pull means on this screen. Awaited, so the dots run for as long as the work does —
     * and a rejection is not an error here: a pull that cannot reach the network still finishes
     * with a tick, and the screen's own offline strip is what says why.
     */
    onRefresh: () => Promise<unknown> | void;
    /** What is being fetched, named. Never "Loading". */
    label: string;
    /**
     * The content. Given as a function where the scrollable is a direct child, because a screen
     * that renders this container is not itself inside it and so cannot read the context — the
     * hook is for lists nested further down.
     */
    children: React.ReactNode | ((props: PullScrollProps) => React.ReactNode);
    testID?: string;
  },
  ref: React.Ref<PullHandle>,
): React.JSX.Element {
  const reduced = useReducedMotion();

  const pull = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState<Stage>('idle');
  const [ratio, setRatio] = useState(0);

  /** Where the list underneath has got to. A pull is only a pull from the very top. */
  const offset = useRef(0);
  const stageRef = useRef<Stage>('idle');
  stageRef.current = stage;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const after = useCallback(
    (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms)),
    [],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const scrollProps = useMemo<PullScrollProps>(
    () => ({
      onScroll: event => {
        offset.current = event.nativeEvent.contentOffset.y;
      },
      scrollEventThrottle: 16,
    }),
    [],
  );

  const settle = useCallback(() => {
    Animated.timing(pull, {
      toValue: 0,
      duration: SETTLE_BACK_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    setStage('idle');
    setRatio(0);
  }, [pull]);

  const run = useCallback(async () => {
    setStage('refreshing');
    Animated.timing(pull, {
      toValue: STRIP,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const started = Date.now();
    try {
      await onRefresh();
    } catch {
      // Deliberately swallowed. A pull that could not reach the network is not a failure the
      // Mait did anything wrong in, and the screens already carry an offline strip that says
      // so in words. An error state here would be a second, louder answer to the same
      // question.
    }

    const spent = Date.now() - started;
    after(Math.max(0, MIN_SPIN_MS - spent), () => {
      setStage('done');
      after(DONE_MS, () => {
        Animated.timing(pull, {
          toValue: 0,
          duration: COLLAPSE_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }).start();
        setStage('idle');
        setRatio(0);
      });
    });
  }, [after, onRefresh, pull]);

  /**
   * Run the whole indicator as though it had been pulled.
   *
   * There is one for the same reason a scroll view has `scrollTo`: the gesture is not the only
   * legitimate way to arrive at a refresh — a handset that has just come back onto a network
   * has as good a reason as a thumb. It is also the only way to exercise the stages in a test
   * without synthesising a pan gesture, which would be testing React Native's gesture
   * arbitration rather than anything in this file.
   */
  useImperativeHandle(ref, () => ({ refresh: () => run() }), [run]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Taps are never claimed. A row under this container has to stay tappable, including
        // while the dots are bouncing.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (stageRef.current === 'refreshing' || stageRef.current === 'done') {
            return false;
          }
          // At the top, going down, and more down than sideways — anything else belongs to
          // the list, or to a horizontal control inside it.
          return (
            offset.current <= 0 &&
            gesture.dy > CLAIM_AT &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5
          );
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderMove: (_event, gesture) => {
          const distance = Math.min(Math.max(gesture.dy, 0) * RESISTANCE, MAX_PULL);
          pull.setValue(distance);
          const next = distance / THRESHOLD;
          setRatio(next);
          setStage(next >= 1 ? 'ready' : 'pulling');
        },
        onPanResponderRelease: () => {
          if (stageRef.current === 'ready') {
            run();
          } else {
            settle();
          }
        },
        onPanResponderTerminate: settle,
      }),
    [pull, run, settle],
  );

  return (
    <View style={styles.root} testID={testID}>
      {/* Behind the sheet and never moving. Only rendered while there is something to see —
          an 80pt strip sitting under every screen at rest is 80pt of nothing. */}
      {stage !== 'idle' && (
        <View style={styles.strip} pointerEvents="none" testID="refresh-strip">
          <RefreshDots stage={stage} ratio={ratio} label={label} reduced={reduced} />
        </View>
      )}

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: pull }] }]}
        {...responder.panHandlers}
      >
        <PullScrollContext.Provider value={scrollProps}>
          {typeof children === 'function' ? children(scrollProps) : children}
        </PullScrollContext.Provider>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: STRIP,
    alignItems: 'center',
    justifyContent: 'center',
    // If the label and the dots ever want more than the strip has, the dots give up the
    // difference rather than the strip growing and shoving the sheet down with it.
    overflow: 'hidden',
  },
  sheet: { flex: 1, backgroundColor: colors.background },

  column: { alignItems: 'center', gap: COLUMN_GAP },
  // Pinned: a flex parent must not be able to squeeze the row out of existence, because the
  // row is the whole signal.
  dots: { flexDirection: 'row', gap: DOT_GAP, height: DOT, flexShrink: 0 },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
  dotOn: { backgroundColor: colors.primary },
  dotOff: { backgroundColor: ink[200] },

  label: {
    fontFamily: fonts.bodyStrong,
    fontSize: 11,
    lineHeight: 15,
    color: colors.primaryDark,
    flexShrink: 0,
  },

  tick: {
    width: TICK,
    height: TICK,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Forwarded so a screen can hold on to the indicator itself, not only ask for one.
 */
const PullToRefresh = React.forwardRef(PullToRefreshInner);
PullToRefresh.displayName = 'PullToRefresh';
export default PullToRefresh;
