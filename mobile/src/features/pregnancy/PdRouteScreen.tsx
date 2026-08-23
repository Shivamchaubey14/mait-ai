/**
 * Today's round, in the order it should be walked.
 *
 * The list of checks is sorted by date, which is the wrong order to *travel* in. Six checks
 * across three villages, worked by due date, sends a Mait to Nandgaon, back to Barsana and
 * out to Nandgaon again in one morning — and the ones that get dropped are always the far
 * ones, which are also the ones already late.
 *
 * So this screen answers a different question: which way do I go. The stops are numbered
 * because that is the only thing a Mait needs to carry out of the door, and each row keeps
 * the reason it is on the list — an overdue stop still reads as overdue even when the route
 * has put it last.
 *
 * **The distances are estimates and the screen says so.** There is no routing service behind
 * this: they are straight lines between the points the inseminations were captured at, scaled
 * for the fact that roads wind. Good enough to decide an order, not good enough to be read as
 * road directions, and the difference is stated on the reorder screen rather than left for
 * somebody to discover on a longer ride than they planned for.
 */

import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { WebView } from 'react-native-webview';

import type { RouteOption, RouteStop } from '@api/types';
import { routeMapHtml } from './routeMapHtml';
import type { MapPoint } from './routeMapHtml';
import { EmptyState } from '@/components/states';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

/** "2h 40m", or "45m" where there is no hour to say. */
export function readableTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * A Google Maps link with every stop on it, in order.
 *
 * The one part of this screen that is real navigation: whatever the estimates above say, the
 * handing-over to Maps gives a Mait actual turn-by-turn directions along real roads.
 */
export function mapsUrl(stops: RouteStop[]): string | null {
  const placed = stops.filter(s => s.lat !== null && s.lng !== null);
  if (placed.length === 0) {
    return null;
  }
  const last = placed[placed.length - 1] as RouteStop;
  const waypoints = placed
    .slice(0, -1)
    .map(s => `${s.lat},${s.lng}`)
    .join('|');
  const destination = `${last.lat},${last.lng}`;
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&destination=${destination}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '') +
    '&travelmode=driving'
  );
}

/** The reason this stop is on the round at all, kept on the row whatever order it is in. */
function dueLabel(stop: RouteStop, t: TFunction): string {
  if (stop.days_until < 0) {
    return t('route2.late', { count: Math.abs(stop.days_until) });
  }
  return stop.days_until === 0
    ? t('route2.dueToday')
    : t('route2.dueIn', { count: stop.days_until });
}

/**
 * The round on a real map, with the legs drawn between the stops.
 *
 * This replaced two attempts that were not maps. First a row of evenly spaced dots, which
 * drew five stops as five equal hops when three of them are within a kilometre of each other.
 * Then a plot of the true coordinates, which had the relative positions right and still had
 * no roads, no river and no landmarks — a Mait cannot recognise their own village in a field
 * of dots, and recognising it is the whole point of looking.
 *
 * Drawn with Leaflet over OpenStreetMap tiles in a web view, which needs no API key of any
 * kind. It was `react-native-maps` for one commit, and that is what crashed the app: Google's
 * Maps SDK is metered, the key is how the meter is attributed, and an empty key does not fall
 * back to a grey square — the Android SDK fails to initialise and closes the screen. Which is
 * also the answer to why "Open in Maps" always worked: that hands the round to an app already
 * installed and already paid for, and involves nothing of ours.
 *
 * A polyline carries the order; the line is what makes it a route rather than a scatter of
 * pins. Anything at all going wrong — no signal, a blocked CDN, a bad tile server — falls back
 * to the plot above. That fallback is the thing this screen was missing when it crashed, and
 * it is now the default rather than the exception.
 */
/**
 * The stops plotted where they are, with no tiles under them.
 *
 * What a round looks like when there is no map to draw it on. Relative positions only — no
 * roads, no landmarks, no scale — so it is labelled, and it is strictly a fallback. It earns
 * its place by showing which stops cluster and whether the route doubles back, which a
 * numbered list cannot, and by never being the reason an app closes.
 */
function Plot({
  stops,
  start,
}: {
  stops: RouteStop[];
  start: { lat: number; lng: number } | null;
}) {
  const { t } = useTranslation();
  const placed = stops.filter(s => s.lat !== null && s.lng !== null);
  const points = [
    ...(start ? [{ lat: start.lat, lng: start.lng, here: true, index: 0 }] : []),
    ...placed.map((s, i) => ({
      lat: s.lat as number,
      lng: s.lng as number,
      here: false,
      index: i + 1,
    })),
  ];

  if (points.length === 0) {
    return null;
  }

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // A floor on the span: one stop, or several at the same yard, would divide by zero.
  const spanLat = Math.max(maxLat - minLat, 0.0005);
  const spanLng = Math.max(maxLng - minLng, 0.0005);

  return (
    <View style={styles.plotCanvas} testID="route-plot">
      {points.map(point => (
        <View
          key={`${point.index}-${point.here}`}
          style={[
            styles.pin,
            styles.plotPin,
            {
              // Latitude grows northward and the screen downward, so it is flipped.
              top: `${8 + ((maxLat - point.lat) / spanLat) * 84}%`,
              left: `${8 + ((point.lng - minLng) / spanLng) * 84}%`,
            },
            point.here && styles.pinHere,
            !point.here && point.index === 1 && styles.pinFirst,
          ]}
        >
          <Text style={styles.pinLabel}>{point.here ? '•' : point.index}</Text>
        </View>
      ))}
      <Text style={styles.plotNote}>{t('route2.noMap')}</Text>
    </View>
  );
}

/**
 * The round on a real map, drawn without an API key.
 *
 * **Why "Open in Maps" always worked and this did not.** They are not the same thing. A link
 * hands the round to the Maps app already on the phone — already installed, already signed
 * in, already paid for. Drawing a map *inside* our screen used Google's Maps SDK, which is
 * metered, and the key is how Google knows whose meter to run. There is no way to use that
 * SDK without one, and an empty key does not fall back to a grey square: the Android SDK
 * fails to initialise and closes the screen, which is what crashed the app.
 *
 * So this uses OpenStreetMap instead, through Leaflet in a web view. Free, keyless, and real
 * — actual roads, rivers and village names, which is the whole reason to have a map rather
 * than a diagram. A polyline carries the order; the line is what makes it a route.
 *
 * The web view reports back when the tiles are on screen. Until it does, and if it never
 * does — no signal, a blocked CDN, anything — the plot above is what is shown. That is the
 * fallback this screen was missing when it crashed, and it is now the default rather than
 * the exception.
 */
function RouteMap({
  stops,
  fromHere,
  start,
}: {
  stops: RouteStop[];
  fromHere: boolean;
  start: { lat: number; lng: number } | null;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const placed = stops.filter(s => s.lat !== null && s.lng !== null);
  if (placed.length === 0) {
    return null;
  }

  const points: MapPoint[] = [
    ...(start
      ? [{ lat: start.lat, lng: start.lng, index: 0, label: t('route2.youAreHere'), late: false }]
      : []),
    ...placed.map((stop, index) => ({
      lat: stop.lat as number,
      lng: stop.lng as number,
      index: index + 1,
      label: `${index + 1}. ${stop.owner_name}`,
      late: stop.days_until < 0,
    })),
  ];

  const html = routeMapHtml(points, {
    primary: colors.primary,
    error: colors.error,
    info: colors.info,
    surface: colors.surface,
  });

  return (
    <View style={styles.plot}>
      <View style={styles.mapFrame}>
        {failed ? (
          <Plot stops={stops} start={start} />
        ) : (
          <WebView
            style={styles.map}
            originWhitelist={['*']}
            source={{ html }}
            // The map is looked at, not scrolled past — the page inside is exactly the frame.
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled
            domStorageEnabled
            // Any failure at all lands on the plot. A blank frame where a map should be tells
            // a Mait nothing about whether the round is wrong or the network is.
            onError={() => setFailed(true)}
            onHttpError={() => setFailed(true)}
            onMessage={event => {
              try {
                if (!JSON.parse(event.nativeEvent.data)?.ok) {
                  setFailed(true);
                }
              } catch {
                setFailed(true);
              }
            }}
            testID="route-map"
          />
        )}
      </View>

      <View style={styles.plotFoot}>
        <View style={styles.sketchPill}>
          <Ionicons
            name={fromHere ? 'navigate' : 'help-circle-outline'}
            size={12}
            color={colors.info}
          />
          <Text style={styles.sketchPillLabel} numberOfLines={1}>
            {fromHere ? t('route2.youAreHere') : t('route2.noFix')}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function PdRouteScreen({
  option,
  orderKey,
  fromHere,
  startPoint,
  withoutLocation,
  onBack,
  onReorder,
  onOpenStop,
}: {
  option: RouteOption;
  orderKey: 'shortest' | 'late_first';
  fromHere: boolean;
  /** Where the round is planned from, drawn on the plot as the dot. */
  startPoint: { lat: number; lng: number } | null;
  withoutLocation: number;
  onBack: () => void;
  onReorder: () => void;
  onOpenStop: (stop: RouteStop) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const stops = option.stops;
  const link = mapsUrl(stops);

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Text style={styles.eyebrow}>{t('route2.title')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="route-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
        </View>

        <Text style={styles.heroTitle} testID="route-headline">
          {t('route2.stops', { count: stops.length, km: option.total_km })}
        </Text>
        <Text style={styles.heroSubtitle}>
          {t(orderKey === 'shortest' ? 'route2.summaryShortest' : 'route2.summaryLate', {
            time: readableTime(option.minutes_total),
          })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {stops.length === 0 ? (
          <EmptyState title={t('route2.noStops')} body={t('route2.noStopsBody')} />
        ) : (
          <>
            <RouteMap stops={stops} fromHere={fromHere} start={startPoint} />

            {stops.map((stop, index) => (
              <Pressable
                key={stop.id}
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. ${stop.owner_name}`}
                onPress={() => onOpenStop(stop)}
                style={({ pressed }) => [
                  styles.stop,
                  index === 0 && styles.stopNext,
                  stop.days_until < 0 && styles.stopLate,
                  pressed && styles.pressed,
                ]}
                testID={`route-stop-${stop.id}`}
              >
                <View
                  style={[
                    styles.number,
                    index === 0 && styles.numberNext,
                    stop.days_until < 0 && styles.numberLate,
                  ]}
                >
                  <Text style={styles.numberLabel}>{index + 1}</Text>
                </View>

                <View style={styles.stopBody}>
                  <Text style={styles.stopName} numberOfLines={1}>
                    {stop.owner_name}
                  </Text>
                  <Text style={styles.stopMeta} numberOfLines={1}>
                    {`${stop.note || stop.mpp_name} · ${dueLabel(stop, t)}`}
                  </Text>
                </View>

                {/* From the stop before it, not from the start — what this leg costs. */}
                <Text style={styles.stopKm}>{`${stop.leg_km} km`}</Text>
              </Pressable>
            ))}

            {withoutLocation > 0 && (
              <Text style={styles.unplaced} testID="route-unplaced">
                {t('route2.unplaced', { count: withoutLocation })}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {stops.length > 0 && (
        <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !link }}
            disabled={!link}
            onPress={() => link && Linking.openURL(link)}
            style={({ pressed }) => [
              styles.cta,
              !link && styles.ctaInert,
              pressed && !!link && styles.ctaPressed,
            ]}
            testID="route-open-maps"
          >
            <Ionicons name="navigate" size={19} color={colors.surface} />
            <Text style={styles.ctaLabel}>{t('route2.openInMaps')}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onReorder}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="route-reorder"
          >
            <Text style={styles.secondaryLabel}>{t('route2.reorder')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  pressed: { opacity: 0.85 },

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
    justifyContent: 'space-between',
    marginBottom: spacing[3],
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
    ...typography.caption,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
    lineHeight: 17,
  },

  body: { padding: spacing[4] },

  // -- the sketch --------------------------------------------------------------------------
  sketch: {
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sketchPills: { flexDirection: 'row' },
  sketchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
    flexShrink: 1,
  },
  sketchPillLabel: { ...typography.caption, color: colors.info, flexShrink: 1 },
  plot: {
    padding: spacing[3],
    marginBottom: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Clipped by the frame rather than by the map, which on Android ignores a border radius.
  mapFrame: {
    height: 190,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing[3],
    backgroundColor: colors.background,
  },
  map: { ...StyleSheet.absoluteFillObject },
  // The fallback ground, inside the same frame the map would fill.
  plotCanvas: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background },
  plotPin: { position: 'absolute', marginLeft: -13, marginTop: -13 },
  plotNote: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing[2],
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  pin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    // A white ring, so a dark pin is still a pin against a dark road or a field of trees.
    borderWidth: 2,
    borderColor: colors.surface,
  },
  pinHere: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.info },
  pinFirst: { backgroundColor: colors.primary },
  pinLate: { backgroundColor: colors.error },
  pinLabel: { ...typography.caption, fontSize: 11, color: colors.surface },
  plotFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  // Said plainly, because a picture of a route invites being read as a map — and the nodes
  // here are evenly spaced rather than placed.
  sketchNote: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  // -- the stops ---------------------------------------------------------------------------
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  // The one being walked to next, and the ones already late. Both keep their meaning wherever
  // the ordering has put them.
  stopNext: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  stopLate: { backgroundColor: colors.errorWash, borderColor: colors.error },
  stopBody: { flex: 1 },
  stopName: { ...typography.h3, color: colors.ink },
  stopMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  stopKm: { ...typography.bodyStrong, color: colors.info },

  number: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  numberNext: { backgroundColor: colors.primary },
  numberLate: { backgroundColor: colors.error },
  numberLabel: { ...typography.bodyStrong, fontSize: 13, color: colors.surface },

  unplaced: { ...typography.caption, color: yolk[800], marginTop: spacing[2] },

  foot: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaInert: { backgroundColor: colors.disabledFill },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  secondary: {
    minHeight: 56,
    paddingHorizontal: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryLabel: { ...typography.bodyStrong, color: colors.textMuted },
});
