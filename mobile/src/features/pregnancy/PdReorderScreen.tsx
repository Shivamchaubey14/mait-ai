/**
 * Shortest, or the late one first?
 *
 * A genuine judgement, which is why it is offered rather than decided. The shortest round is
 * always shorter — that is what shortest means — but a check three weeks late is a farmer who
 * has been waiting and an animal that may have been open the whole time. A Mait may well
 * think nine kilometres is worth paying to get to her first, and nothing on a server knows
 * enough to make that call for them.
 *
 * So both orders are shown with what each costs, side by side, and the Mait picks.
 *
 * **The distances are estimates and this screen is where that is said.** They are straight
 * lines between the points the inseminations were captured at, scaled for the fact that roads
 * wind. There is no routing service behind this platform. The note is not a disclaimer for
 * its own sake: somebody choosing a twenty-seven kilometre round over an eighteen is making a
 * decision with these numbers, and they deserve to know how firm they are.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import type { PdRoute, RouteOption } from '@api/types';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { readableTime } from './PdRouteScreen';

export type OrderKey = 'shortest' | 'late_first';

/**
 * The villages an order passes through, in order and without repeats.
 *
 * "Three Barsana stops, then Nandgaon" is the sentence that makes a route make sense — a Mait
 * knows their own villages, and a list of names tells them more about the shape of a morning
 * than a distance does.
 */
export function villagePath(option: RouteOption): string {
  const seen: string[] = [];
  option.stops.forEach(stop => {
    const name = stop.mpp_name;
    if (name && seen[seen.length - 1] !== name) {
      seen.push(name);
    }
  });
  return seen.join(' → ');
}

/**
 * Each order in a colour of its own: the shortest in blue, the colour of places; late first in
 * red, the colour the late rows wear on the list — so the choice reads before its words do.
 */
const OPTION_PAINT = {
  info: { solid: colors.info, word: colors.info, wash: colors.infoWash, icon: 'trail-sign' },
  late: { solid: colors.error, word: colors.error, wash: colors.errorWash, icon: 'alert-circle' },
} as const;

function Option({
  label,
  path,
  option,
  selected,
  onPress,
  tone,
  testID,
}: {
  tone: keyof typeof OPTION_PAINT;
  label: string;
  path: string;
  option: RouteOption;
  selected: boolean;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const paint = OPTION_PAINT[tone];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${option.total_km} km`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: paint.wash, borderColor: paint.solid },
        selected && styles.optionOn,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={styles.optionHead}>
        <View style={[styles.chip, { backgroundColor: paint.solid }]}>
          <Ionicons name={paint.icon} size={20} color={colors.surface} />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionLabel}>{label}</Text>
          <Text style={[styles.optionPath, { color: paint.word }]} numberOfLines={2}>
            {path}
          </Text>
        </View>
        <View
          style={[
            styles.tick,
            { borderColor: paint.solid },
            selected && { backgroundColor: paint.solid },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={colors.surface} />}
        </View>
      </View>

      {/* The two figures the choice actually turns on, side by side so they can be compared
          without arithmetic. */}
      <View style={styles.figures}>
        <View style={styles.figure}>
          <View style={styles.figureHead}>
            <Ionicons name="map" size={13} color={paint.word} />
            <Text style={[styles.figureLabel, { color: paint.word }]}>{t('route2.distance')}</Text>
          </View>
          <Text style={styles.figureValue}>{`${option.total_km} km`}</Text>
        </View>
        <View style={styles.figure}>
          <View style={styles.figureHead}>
            <Ionicons name="time" size={13} color={paint.word} />
            <Text style={[styles.figureLabel, { color: paint.word }]}>{t('route2.onTheRoad')}</Text>
          </View>
          <Text style={styles.figureValue}>{readableTime(option.minutes_on_road)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function PdReorderScreen({
  route,
  current,
  onBack,
  onUse,
}: {
  route: PdRoute;
  current: OrderKey;
  onBack: () => void;
  onUse: (order: OrderKey) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [chosen, setChosen] = useState<OrderKey>(current);

  // The stop that makes this a question at all — the furthest overdue one. Named, because
  // "something is late" is not a reason and "Anita Devi is 9 km out" is.
  const lateStop = [...route.options.late_first.stops]
    .filter(stop => stop.days_until < 0)
    .sort((a, b) => b.leg_km - a.leg_km)[0];

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="reorder-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
          <Text style={styles.eyebrow}>{t('route2.reorderEyebrow')}</Text>
        </View>

        <Text style={styles.heroTitle}>{t('route2.reorderAsk')}</Text>
        <Text style={styles.heroSubtitle} numberOfLines={2}>
          {lateStop
            ? t('route2.reorderSubject', {
                name: lateStop.owner_name,
                km: route.options.late_first.total_km,
              })
            : t('route2.reorderSubjectNone')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Option
          label={t('route2.optShortest')}
          path={villagePath(route.options.shortest)}
          option={route.options.shortest}
          selected={chosen === 'shortest'}
          onPress={() => setChosen('shortest')}
          tone="info"
          testID="reorder-shortest"
        />
        <Option
          label={t('route2.optLate')}
          path={villagePath(route.options.late_first)}
          option={route.options.late_first}
          selected={chosen === 'late_first'}
          onPress={() => setChosen('late_first')}
          tone="late"
          testID="reorder-late"
        />

        {/* Where the numbers come from, in the place the numbers are being weighed. */}
        <View style={styles.note} testID="reorder-note">
          <Ionicons name="information-circle" size={18} color={colors.info} />
          <Text style={styles.noteText}>{t('route2.estimate')}</Text>
        </View>
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onUse(chosen)}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          testID="reorder-use"
        >
          <Ionicons name="checkmark" size={18} color={colors.surface} />
          <Text style={styles.ctaLabel}>{t('route2.useThisOrder')}</Text>
        </Pressable>
      </View>
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
  heroTitle: { ...typography.display, fontSize: 24, lineHeight: 32, color: colors.surface },
  heroSubtitle: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[2],
    lineHeight: 17,
  },

  body: { padding: spacing[4] },

  option: {
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  // Chosen: the colour's border drawn heavier and the tick filled.
  optionOn: { borderWidth: 2.5 },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  optionText: { flex: 1 },
  optionLabel: { ...typography.h3, color: colors.ink },
  optionPath: { ...typography.caption, marginTop: 2 },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  figures: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] },
  figure: {
    flex: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  figureHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  figureLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  figureValue: { ...typography.h3, color: colors.ink, marginTop: 2 },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    marginTop: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  noteText: { ...typography.caption, color: colors.info, flex: 1, lineHeight: 18 },

  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    flexDirection: 'row',
    gap: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
});
