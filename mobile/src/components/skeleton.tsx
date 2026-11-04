/**
 * Skeletons for the admin screens — the shape of the page, drawn before its data.
 *
 * A spinner in the middle of a blank screen says "wait" and nothing else. Moving between
 * admin sections, what the eye wants is where things will be: the hero, the tiles, the rows.
 * Each layout below is drawn to the proportions of the screen it stands in for, so when the
 * data lands nothing jumps — the bones are simply replaced by what they outlined.
 *
 * **One sweep for the whole page.** Every bone reads the same animated value, so the shimmer
 * crosses the screen as one band instead of each block flickering on its own clock.
 *
 * **It does not flash.** The skeleton fades in after a short delay; a cached section that
 * answers in eighty milliseconds never shows one at all, which reads as instant rather than
 * as a glitch.
 *
 * Reduced motion gets the bones and no sweep.
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useReducedMotion } from '@/components/reducedMotion';
import { colors, ink, radius, spacing } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------------------
const SWEEP_MS = 1300;
const PAUSE_MS = 250;
/** Long enough that a fast answer never shows a skeleton; short enough not to feel stuck. */
const APPEAR_DELAY_MS = 120;
const APPEAR_MS = 220;

const BAND = 110;

type Tone = 'light' | 'dark';

const ShimmerContext = createContext<Animated.Value | null>(null);

// --------------------------------------------------------------------------------------
// The frame every layout sits in
// --------------------------------------------------------------------------------------
function SkeletonFrame({
  children,
  style,
  testID = 'skeleton',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fade = Animated.timing(appear, {
      toValue: 1,
      duration: APPEAR_MS,
      delay: APPEAR_DELAY_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [appear]);

  useEffect(() => {
    if (reduced) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: SWEEP_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(PAUSE_MS),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);

  return (
    <ShimmerContext.Provider value={reduced ? null : sweep}>
      <Animated.View
        accessibilityRole="progressbar"
        accessibilityLabel={t('common.loading')}
        style={[{ opacity: appear }, style]}
        testID={testID}
      >
        {children}
      </Animated.View>
    </ShimmerContext.Provider>
  );
}

// --------------------------------------------------------------------------------------
// One bone
// --------------------------------------------------------------------------------------
/**
 * A placeholder block with the shared sweep crossing it.
 *
 * The band is three strips of white at rising then falling opacity — a soft-edged highlight
 * without a gradient dependency.
 */
export function Bone({
  width = '100%',
  height = 10,
  round = radius.pill,
  tone = 'light',
  style,
}: {
  width?: DimensionValue;
  height?: number;
  round?: number;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const sweep = useContext(ShimmerContext);
  const screen = Dimensions.get('window').width;

  return (
    <View
      style={[
        styles.bone,
        { width, height, borderRadius: round },
        tone === 'dark' && styles.boneDark,
        style,
      ]}
    >
      {!!sweep && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.band,
            {
              transform: [
                {
                  translateX: sweep.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-BAND, screen],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.strip, tone === 'dark' ? styles.stripDarkEdge : styles.stripEdge]} />
          <View style={[styles.strip, tone === 'dark' ? styles.stripDarkMid : styles.stripMid]} />
          <View style={[styles.strip, tone === 'dark' ? styles.stripDarkEdge : styles.stripEdge]} />
        </Animated.View>
      )}
    </View>
  );
}

/** Varied lengths, so a column of bars reads as a list of names rather than a barcode. */
const NAME_WIDTHS: DimensionValue[] = ['64%', '48%', '72%', '56%', '40%', '68%'];
const META_WIDTHS: DimensionValue[] = ['38%', '52%', '30%', '44%', '34%', '46%'];

// --------------------------------------------------------------------------------------
// Layouts
// --------------------------------------------------------------------------------------
/** A list of record cards — chip, name over detail, a status pill. Most admin lists. */
export function SkeletonRows({
  rows = 6,
  pill = true,
  testID,
}: {
  rows?: number;
  pill?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <SkeletonFrame style={styles.stack} testID={testID}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          <Bone width={40} height={40} round={radius.md} />
          <View style={styles.cardBody}>
            <Bone width={NAME_WIDTHS[i % NAME_WIDTHS.length]} height={12} />
            <Bone width={META_WIDTHS[i % META_WIDTHS.length]} height={8} />
          </View>
          {pill && <Bone width={52} height={22} />}
        </View>
      ))}
    </SkeletonFrame>
  );
}

/** One record read back — a header card, then label-over-value fields. */
export function SkeletonRecord({
  fields = 6,
  testID,
}: {
  fields?: number;
  testID?: string;
}): React.JSX.Element {
  return (
    <SkeletonFrame style={styles.stack} testID={testID}>
      <View style={styles.recordHead}>
        <Bone width={56} height={56} round={radius.pill} />
        <View style={styles.cardBody}>
          <Bone width="58%" height={16} />
          <Bone width="36%" height={10} />
        </View>
      </View>
      <View style={styles.chips}>
        <Bone width={84} height={26} />
        <Bone width={64} height={26} />
        <Bone width={72} height={26} />
      </View>
      <View style={styles.panel}>
        {Array.from({ length: fields }).map((_, i) => (
          <View key={i} style={[styles.field, i === fields - 1 && styles.fieldLast]}>
            <Bone width="28%" height={8} />
            <Bone width={NAME_WIDTHS[i % NAME_WIDTHS.length]} height={12} />
          </View>
        ))}
      </View>
    </SkeletonFrame>
  );
}

/** The dashboard — the dark hero, four tiles, the range switch, the chart panel. */
export function SkeletonBoard({ testID }: { testID?: string }): React.JSX.Element {
  return (
    <SkeletonFrame style={[styles.stack, styles.pad]} testID={testID}>
      <View style={styles.hero}>
        <Bone tone="dark" width="34%" height={10} />
        <Bone tone="dark" width="42%" height={40} round={radius.md} />
        <Bone tone="dark" width={120} height={22} />
      </View>
      <Tiles count={4} />
      <View style={styles.chips}>
        <Bone width={64} height={30} />
        <Bone width={64} height={30} />
        <Bone width={64} height={30} />
      </View>
      <Chart />
      <View style={styles.panel}>
        <Bone width="40%" height={12} />
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} style={styles.meter}>
            <Bone width={NAME_WIDTHS[i]} height={10} />
            <Bone height={8} />
          </View>
        ))}
      </View>
    </SkeletonFrame>
  );
}

/** A figures-first page — KPI tiles over a list. Inventory, payment, pregnancy, pipeline. */
export function SkeletonOverview({
  tiles = 4,
  rows = 4,
  chart = false,
  testID,
}: {
  tiles?: number;
  rows?: number;
  chart?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <SkeletonFrame style={styles.stack} testID={testID}>
      <Tiles count={tiles} />
      {chart && <Chart />}
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          <Bone width={40} height={40} round={radius.md} />
          <View style={styles.cardBody}>
            <Bone width={NAME_WIDTHS[i % NAME_WIDTHS.length]} height={12} />
            <Bone width="100%" height={6} />
          </View>
          <Bone width={36} height={16} round={radius.sm} />
        </View>
      ))}
    </SkeletonFrame>
  );
}

/** A table preview — a header row, then striped rows of cells. Reports. */
export function SkeletonTable({
  rows = 8,
  cols = 4,
  testID,
}: {
  rows?: number;
  cols?: number;
  testID?: string;
}): React.JSX.Element {
  return (
    <SkeletonFrame style={styles.table} testID={testID}>
      <View style={[styles.tableRow, styles.tableHead]}>
        {Array.from({ length: cols }).map((_, c) => (
          <Bone key={c} width={`${Math.floor(80 / cols)}%`} height={10} />
        ))}
      </View>
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={[styles.tableRow, r % 2 === 1 && styles.tableStripe]}>
          {Array.from({ length: cols }).map((__, c) => (
            <Bone key={c} width={`${Math.floor(80 / cols) - ((r + c) % 3) * 4}%`} height={9} />
          ))}
        </View>
      ))}
    </SkeletonFrame>
  );
}

/** A few compact lines inside a card that is already drawn — history, activity, pickers. */
export function SkeletonFeed({
  rows = 3,
  testID,
}: {
  rows?: number;
  testID?: string;
}): React.JSX.Element {
  return (
    <SkeletonFrame style={styles.feed} testID={testID}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.feedRow}>
          <Bone width={10} height={10} />
          <View style={styles.cardBody}>
            <Bone width={NAME_WIDTHS[i % NAME_WIDTHS.length]} height={10} />
            <Bone width={META_WIDTHS[i % META_WIDTHS.length]} height={7} />
          </View>
        </View>
      ))}
    </SkeletonFrame>
  );
}

// --------------------------------------------------------------------------------------
// Pieces the layouts share
// --------------------------------------------------------------------------------------
function Tiles({ count }: { count: number }): React.JSX.Element {
  const pairs = Array.from({ length: Math.ceil(count / 2) });
  return (
    <>
      {pairs.map((_, p) => (
        <View key={p} style={styles.tiles}>
          {[0, 1].slice(0, Math.min(2, count - p * 2)).map(i => (
            <View key={i} style={styles.tile}>
              <View style={styles.tileHead}>
                <Bone width={18} height={18} round={radius.sm} />
                <Bone width="55%" height={8} />
              </View>
              <Bone width="60%" height={24} round={radius.sm} />
              <Bone width="40%" height={7} />
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

const CHART_BARS = [46, 72, 58, 90, 64, 80, 52, 96, 70, 84, 60, 76];

function Chart(): React.JSX.Element {
  return (
    <View style={styles.panel}>
      <View style={styles.tileHead}>
        <Bone width={18} height={18} round={radius.sm} />
        <Bone width="45%" height={12} />
      </View>
      <View style={styles.chart}>
        {CHART_BARS.map((h, i) => (
          <Bone key={i} width={14} height={h} round={4} style={styles.chartBar} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bone: { backgroundColor: ink[50], overflow: 'hidden' },
  boneDark: { backgroundColor: ink[500] },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: BAND,
    flexDirection: 'row',
  },
  strip: { flex: 1 },
  stripEdge: { backgroundColor: 'rgba(255,255,255,0.35)' },
  stripMid: { backgroundColor: 'rgba(255,255,255,0.7)' },
  stripDarkEdge: { backgroundColor: 'rgba(255,255,255,0.05)' },
  stripDarkMid: { backgroundColor: 'rgba(255,255,255,0.12)' },

  stack: { gap: spacing[3] },
  pad: { padding: spacing[4] },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardBody: { flex: 1, gap: spacing[2] },

  recordHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chips: { flexDirection: 'row', gap: spacing[2] },

  panel: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  field: {
    gap: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldLast: { borderBottomWidth: 0, paddingBottom: 0 },
  meter: { gap: spacing[2] },

  hero: {
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: {
    flex: 1,
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
  },
  chartBar: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },

  table: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  tableHead: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableStripe: { backgroundColor: '#FAFBFA' },

  feed: { gap: spacing[3], paddingVertical: spacing[2] },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
});
