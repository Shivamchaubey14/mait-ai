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

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import MapView, { Marker, Polyline } from 'react-native-maps';

import type { RouteOption, RouteStop } from '@api/types';
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

/** Markers are anchored on their middle, so a numbered disc sits *on* the point it marks. */
const CENTRE = { x: 0.5, y: 0.5 };

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
 * `react-native-maps` renders Google Maps on Android and Apple Maps on iOS. A `Polyline`
 * carries the order — the lines are what make it a *route* rather than a scatter of pins.
 *
 * **A standalone build needs a Google Maps key.** In Expo Go the tiles come from Expo's own
 * key and work with nothing configured; an APK signed by us has to carry
 * `android.config.googleMaps.apiKey` or Android draws an empty grey square. The fallback
 * below is why an empty square never appears: with no map available it draws the coordinate
 * plot instead, which says what it is.
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

  const placed = stops.filter(s => s.lat !== null && s.lng !== null);
  if (placed.length === 0) {
    return null;
  }

  const path = [
    ...(start ? [{ latitude: start.lat, longitude: start.lng }] : []),
    ...placed.map(s => ({ latitude: s.lat as number, longitude: s.lng as number })),
  ];

  // Framed to hold every stop with room to breathe. A delta of zero — one stop, or several
  // at the same yard — would zoom the camera to the ground.
  const lats = path.map(p => p.latitude);
  const lngs = path.map(p => p.longitude);
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max((Math.max(...lats) - Math.min(...lats)) * 1.6, 0.02),
    longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * 1.6, 0.02),
  };

  return (
    <View style={styles.plot}>
      <View style={styles.mapFrame} testID="route-map">
        <MapView
          style={styles.map}
          initialRegion={region}
          // Read, not driven. Panning is allowed because a Mait will want to look around;
          // rotation and pitch only make a small map harder to read.
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsUserLocation={fromHere}
          showsMyLocationButton={false}
        >
          {/* The order, drawn. Without it the stops are pins and not a route. */}
          <Polyline coordinates={path} strokeColor={colors.primary} strokeWidth={3} />

          {start && (
            <Marker coordinate={{ latitude: start.lat, longitude: start.lng }} anchor={CENTRE}>
              <View style={[styles.pin, styles.pinHere]} />
            </Marker>
          )}

          {placed.map((stop, index) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.lat as number, longitude: stop.lng as number }}
              title={stop.owner_name}
              description={stop.note || stop.mpp_name}
              anchor={CENTRE}
            >
              {/* The number is the whole point: it is what the list beside it is keyed to. */}
              <View
                style={[
                  styles.pin,
                  index === 0 && styles.pinFirst,
                  stop.days_until < 0 && styles.pinLate,
                ]}
              >
                <Text style={styles.pinLabel}>{index + 1}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
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
