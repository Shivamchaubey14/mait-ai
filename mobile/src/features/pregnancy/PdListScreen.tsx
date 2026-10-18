/**
 * The pregnancy checks a Mait owes a visit.
 *
 * Ninety days after an insemination somebody has to find out whether it took. Until then the
 * platform knows what it sold, not what it achieved — and conception rate is the number this
 * whole product is judged on.
 *
 * The screen is built around planning a round rather than around browsing a list. A Mait
 * reads it the night before or over tea and decides where to walk, so what each row has to
 * answer is *when* and *where*: a day count they can sort by eye, the farmer's name, and the
 * village. Everything else waits for the record itself.
 *
 * **Overdue never falls off.** A check nobody did does not stop mattering, and an animal
 * quietly dropped from the round is a conception rate computed over the visits that happened
 * to be convenient. Late rows sit at the top in red and stay there.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useListPregnancyChecksQuery } from '@api/endpoints';
import type { PregnancyCheck } from '@api/types';
import { BrandMark } from '@/components/brand';
import Problem, { useOnline } from '@/components/problem';
import PullToRefresh from '@/components/pullToRefresh';
import { EmptyState, SkeletonList } from '@/components/states';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 May". The year is left off — every check on this screen is within months of today. */
export function shortDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) {
    return '—';
  }
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * What a visit can end in, each as a mark, a tone and a word.
 *
 * One table, read by the badge on a row and by the legend below it, so the two can never
 * come to disagree about what a symbol means.
 *
 * A refusal takes the neutral tone rather than the red one. Red on this row means the
 * insemination failed, and an owner who would not have the animal examined has not told us
 * that — a Mait scanning the Done tab must not read a row of refusals as a row of failures.
 */
export const OUTCOMES = [
  { key: 'pregnant', icon: 'checkmark', tone: 'good', label: 'pd.pregnant' },
  { key: 'not_pregnant', icon: 'close', tone: 'bad', label: 'pd.notPregnant' },
  { key: 'unsure', icon: 'help', tone: 'unsure', label: 'pd.unsure' },
  { key: 'declined', icon: 'hand-left-outline', tone: 'unsure', label: 'pd.declined' },
] as const;

function outcomeWord(outcome: string, t: (key: string) => string): string {
  return t(OUTCOMES.find(row => row.key === outcome)?.label ?? 'pd.unsure');
}

type Urgency = 'late' | 'today' | 'soon';

/**
 * A row's paint, from the one thing it is read for: red late, yolk today, blue coming up —
 * and once answered, green pregnant, red not, slate unsure or refused.
 */
type RowTone = 'late' | 'today' | 'soon' | 'good' | 'bad' | 'unsure';

const PAINT: Record<RowTone, { solid: string; word: string; wash: string; edge: string }> = {
  late: { solid: colors.error, word: colors.error, wash: colors.errorWash, edge: colors.error },
  today: { solid: yolk[500], word: yolk[800], wash: colors.secondaryWash, edge: yolk[300] },
  soon: { solid: colors.info, word: colors.info, wash: colors.infoWash, edge: colors.info },
  good: {
    solid: colors.primary,
    word: colors.primaryDark,
    wash: colors.primaryWash,
    edge: green[300],
  },
  bad: { solid: colors.error, word: colors.error, wash: colors.errorWash, edge: colors.error },
  unsure: { solid: ink[400], word: ink[600], wash: ink[50], edge: ink[100] },
};

function rowTone(check: PregnancyCheck): RowTone {
  if (check.outcome) {
    return (OUTCOMES.find(row => row.key === check.outcome) ?? OUTCOMES[2]).tone;
  }
  return urgencyOf(check.days_until);
}

/** Three states, because they call for three different decisions on the day. */
export function urgencyOf(daysUntil: number): Urgency {
  if (daysUntil < 0) {
    return 'late';
  }
  return daysUntil === 0 ? 'today' : 'soon';
}

/**
 * The badge that carries the whole row.
 *
 * A number and a word, not a date. A Mait planning a morning needs "how long have I got",
 * and working that out from a calendar date is arithmetic nobody should be asked to do at
 * five in the morning.
 */
function DayBadge({ check }: { check: PregnancyCheck }): React.JSX.Element {
  const { t } = useTranslation();

  // Once it is answered there are no days left to count, and a "4 LATE" against a check
  // done last month is a lie the badge tells at a glance. The answer takes its place.
  if (check.outcome) {
    // Falls back to "not sure" — the honest answer for a row carrying something this build
    // does not recognise, and the only one of the four that claims nothing.
    const found = OUTCOMES.find(row => row.key === check.outcome) ?? OUTCOMES[2];
    return (
      <View
        style={[styles.outcome, styles[`outcome_${found.tone}`]]}
        testID={`pd-outcome-${found.tone}`}
      >
        <Ionicons name={found.icon} size={20} color={colors.surface} />
      </View>
    );
  }

  const urgency = urgencyOf(check.days_until);
  const count = Math.abs(check.days_until);

  return (
    <View style={[styles.badge, styles[`badge_${urgency}`]]}>
      <Text style={[styles.badgeNumber, styles[`badgeText_${urgency}`]]}>{count}</Text>
      <Text style={[styles.badgeWord, styles[`badgeText_${urgency}`]]} numberOfLines={1}>
        {urgency === 'late' ? t('pd.late') : urgency === 'today' ? t('pd.today') : t('pd.days')}
      </Text>
    </View>
  );
}

/**
 * What the three marks mean, on the tab where they appear.
 *
 * A coloured glyph is fast to scan and says nothing on its own — a grey question mark is
 * unreadable to somebody meeting it for the first time. The word is on every row as well;
 * this is the one place that explains the *shape*, so a Mait reading a column of ticks knows
 * what a column of ticks is.
 */
function Legend(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.legend} testID="pd-legend">
      <View style={styles.legendHead}>
        <Ionicons name="information-circle" size={15} color={ink[600]} />
        <Text style={styles.legendTitle}>{t('pd.legend')}</Text>
      </View>
      <View style={styles.legendRow}>
        {OUTCOMES.map(row => (
          <View
            key={row.key}
            style={[
              styles.legendItem,
              { backgroundColor: PAINT[row.tone].wash, borderColor: PAINT[row.tone].edge },
            ]}
            testID={`pd-legend-${row.key}`}
          >
            <View style={[styles.legendMark, styles[`outcome_${row.tone}`]]}>
              <Ionicons name={row.icon} size={16} color={colors.surface} />
            </View>
            <Text style={[styles.legendLabel, { color: PAINT[row.tone].word }]} numberOfLines={2}>
              {t(row.label)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CheckRow({
  check,
  onPress,
}: {
  check: PregnancyCheck;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = rowTone(check);
  const paint = PAINT[tone];
  const member = check.owner_type === 'member';

  // A recorded row leads with the answer. The coloured mark is for scanning a column at a
  // glance; the word is what makes it mean anything, and this is the line a Mait is already
  // reading. On an open row there is no answer yet, so the line stays about finding the yard.
  const meta = check.outcome
    ? t('pd.rowDone', {
        outcome: outcomeWord(check.outcome, t),
        date: shortDate(check.checked_at ? check.checked_at.slice(0, 10) : check.due_on),
        mpp: check.mpp_name,
      })
    : check.owner_type === 'member'
      ? t('pd.rowMeta', {
          date: shortDate(check.served_on),
          breed: check.breed || '—',
          mpp: check.mpp_name,
        })
      : t('pd.rowMetaNonMember', { date: shortDate(check.served_on), mpp: check.mpp_name });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${check.owner_name} · ${check.outcome_display || check.due_on}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: paint.wash, borderColor: paint.edge },
        pressed && styles.rowPressed,
      ]}
      testID={`pd-check-${check.id}`}
    >
      <DayBadge check={check} />

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {check.owner_name}
        </Text>
        <View style={styles.rowMetaLine}>
          <Ionicons name={check.outcome ? 'calendar' : 'location'} size={12} color={paint.word} />
          <Text style={[styles.rowMeta, { color: paint.word }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View
          style={[styles.owner, member ? styles.owner_member : styles.owner_other]}
          testID={`pd-owner-${check.id}`}
        >
          <Ionicons
            name={member ? 'people' : 'person'}
            size={11}
            color={member ? colors.info : yolk[800]}
          />
          <Text style={[styles.ownerLabel, { color: member ? colors.info : yolk[800] }]}>
            {t(member ? 'history.member' : 'history.nonMember')}
          </Text>
        </View>
      </View>

      <View style={[styles.go, { borderColor: paint.solid }]}>
        <Ionicons name="chevron-forward" size={16} color={paint.word} />
      </View>
    </Pressable>
  );
}

export default function PdListScreen({
  onOpen,
  onPlanRoute,
  onSync,
}: {
  onOpen: (check: PregnancyCheck) => void;
  /** Opens the round, ordered for walking rather than by date. */
  onPlanRoute: () => void;
  onSync?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const [tab, setTab] = useState<'week' | 'done'>('week');

  const checks = useListPregnancyChecksQuery({ window: tab === 'week' ? 'due' : 'done' });
  const rows = checks.data?.results ?? [];

  // Off the response rather than counted here: the Profile row, this headline and the tab
  // badge must all show one number, and the server is the only place that can guarantee it.
  const dueThisWeek = checks.data?.due_this_week ?? 0;
  const overdue = checks.data?.overdue ?? 0;

  const headline = dueThisWeek > 0 ? t('pd.title', { count: dueThisWeek }) : t('pd.titleNone');
  const subtitle = overdue > 0 ? t('pd.subtitleLate', { count: overdue }) : t('pd.subtitle');

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <BrandMark size="small" />
        </View>
        <Text style={styles.eyebrow}>{t('pd.eyebrow')}</Text>
        <Text style={styles.heroTitle} testID="pd-headline">
          {headline}
        </Text>
        <View style={[styles.heroPill, overdue > 0 && styles.heroPillLate]} testID="pd-subtitle">
          <Ionicons
            name={overdue > 0 ? 'alert-circle' : 'calendar'}
            size={13}
            color={colors.surface}
          />
          <Text style={styles.heroSubtitle}>{subtitle}</Text>
        </View>
      </View>

      {/* Two answers, one control. "Done" is not an archive nobody opens — it is how a Mait
          checks what they told a farmer last week before being asked about it again. */}
      <View style={styles.tabsWrap}>
        <View style={styles.tabs}>
          {(['week', 'done'] as const).map(key => {
            const active = key === tab;
            // The week in blue, what is coming; Done in green, what is answered.
            const paint = key === 'week' ? PAINT.soon : PAINT.good;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(key)}
                style={[
                  styles.tab,
                  active
                    ? { backgroundColor: paint.solid, borderColor: paint.solid }
                    : { backgroundColor: paint.wash, borderColor: paint.edge },
                ]}
                testID={`pd-tab-${key}`}
              >
                <Ionicons
                  name={key === 'week' ? 'calendar' : 'checkmark-done'}
                  size={16}
                  color={active ? colors.surface : paint.word}
                />
                <Text
                  style={[styles.tabLabel, { color: active ? colors.surface : paint.word }]}
                  numberOfLines={1}
                >
                  {key === 'week' ? t('pd.tabWeek') : t('pd.tabDone')}
                </Text>
                {key === 'week' && dueThisWeek > 0 && (
                  <View
                    style={[
                      styles.tabCount,
                      { backgroundColor: active ? colors.surface : paint.solid },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tabCountLabel,
                        { color: active ? paint.word : colors.surface },
                      ]}
                    >
                      {dueThisWeek}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <PullToRefresh
        onRefresh={async () => {
          onSync?.();
          await checks.refetch();
        }}
        label={t('pull.events')}
        testID="pd-pull"
      >
        {scrollProps => (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            {...scrollProps}
          >
            {checks.isLoading ? (
              <SkeletonList rows={4} />
            ) : checks.isError ? (
              <Problem
                kind={online ? 'server' : 'offline'}
                onRetry={() => checks.refetch()}
                busy={checks.isFetching}
                testID="pd-error"
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={tab === 'week' ? t('pd.emptyWeekTitle') : t('pd.emptyDoneTitle')}
                body={tab === 'week' ? t('pd.emptyWeekBody') : t('pd.emptyDoneBody')}
              />
            ) : (
              <>
                {/* Only on Done, where the marks are. On the week's list every row is open
                    and there is no mark to explain. */}
                {tab === 'done' && <Legend />}
                {rows.map(check => (
                  <CheckRow key={check.id} check={check} onPress={() => onOpen(check)} />
                ))}
              </>
            )}
          </ScrollView>
        )}
      </PullToRefresh>

      {/* The one action, and only where there is a round to plan. On the Done tab it would be
          a button offering to walk somewhere nobody needs to go. */}
      {tab === 'week' && rows.length > 0 && (
        <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            onPress={onPlanRoute}
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            testID="pd-plan-route"
          >
            <View style={styles.ctaChip}>
              <Ionicons name="map" size={17} color={colors.primary} />
            </View>
            <Text style={styles.ctaLabel}>{t('pd.planRoute')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[4] },
  eyebrow: { ...typography.label, color: colors.surface, opacity: 0.72 },
  heroTitle: {
    ...typography.display,
    fontSize: 26,
    lineHeight: 34,
    color: colors.surface,
    marginTop: spacing[1],
  },
  heroSubtitle: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
    flexShrink: 1,
  },
  heroPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  heroPillLate: { backgroundColor: colors.error },

  tabsWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  tabs: { flexDirection: 'row', gap: spacing[2] },
  tab: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  tabLabel: { ...typography.bodyStrong, flexShrink: 1 },
  tabCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  body: { padding: spacing[4] },

  // The whole card in its colour, not a stripe: a thumb covers an edge, and a late row read
  // through a thumb then looks like every other row.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowPressed: { opacity: 0.85 },
  rowBody: { flex: 1, gap: 3 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMeta: { ...typography.caption, flexShrink: 1 },
  owner: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  owner_member: { backgroundColor: colors.surface, borderColor: colors.info },
  owner_other: { backgroundColor: colors.surface, borderColor: yolk[300] },
  ownerLabel: { ...typography.caption },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  badge: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge_late: { backgroundColor: colors.error },
  badge_today: { backgroundColor: yolk[500] },
  badge_soon: { backgroundColor: colors.info },
  badgeNumber: { ...typography.h2, fontSize: 19, lineHeight: 22 },
  badgeWord: { ...typography.caption, fontSize: 9, lineHeight: 11, letterSpacing: 0.5 },
  badgeText_late: { color: colors.surface },
  badgeText_today: { color: yolk[900] },
  badgeText_soon: { color: colors.surface },

  // The answer, where the countdown used to be. Green took, red did not, grey was unsure.
  outcome: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcome_good: { backgroundColor: colors.primary },
  outcome_bad: { backgroundColor: colors.error },
  outcome_unsure: { backgroundColor: ink[400] },

  legend: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  legendHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginBottom: spacing[2],
  },
  legendTitle: { ...typography.label, color: ink[600] },
  // Two to a row rather than four on one line. Four in a row left each word about sixty
  // points and clipped "Pregnant" to "Pregn…" — a legend that clips the word it exists to
  // teach has taught nothing, and Hindi runs longer still.
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  legendMark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendLabel: { ...typography.label, flex: 1 },

  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  ctaChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
