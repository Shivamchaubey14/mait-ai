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
  MIN_TOUCH_TARGET,
  radius,
  shadows,
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
 * The three answers, each as a mark, a tone and a word.
 *
 * One table, read by the badge on a row and by the legend below it, so the two can never
 * come to disagree about what a symbol means.
 */
export const OUTCOMES = [
  { key: 'pregnant', icon: 'checkmark', tone: 'good', label: 'pd.pregnant' },
  { key: 'not_pregnant', icon: 'close', tone: 'bad', label: 'pd.notPregnant' },
  { key: 'unsure', icon: 'help', tone: 'unsure', label: 'pd.unsure' },
] as const;

function outcomeWord(outcome: string, t: (key: string) => string): string {
  return t(OUTCOMES.find(row => row.key === outcome)?.label ?? 'pd.unsure');
}

type Urgency = 'late' | 'today' | 'soon';

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
      <Text style={styles.legendTitle}>{t('pd.legend')}</Text>
      <View style={styles.legendRow}>
        {OUTCOMES.map(row => (
          <View key={row.key} style={styles.legendItem}>
            <View style={[styles.legendMark, styles[`outcome_${row.tone}`]]}>
              <Ionicons name={row.icon} size={13} color={colors.surface} />
            </View>
            <Text style={styles.legendLabel} numberOfLines={1}>
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
  const urgency = check.outcome ? null : urgencyOf(check.days_until);

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
        urgency === 'late' && styles.rowLate,
        urgency === 'today' && styles.rowToday,
        pressed && styles.rowPressed,
      ]}
      testID={`pd-check-${check.id}`}
    >
      <DayBadge check={check} />

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {check.owner_name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
        <Text style={styles.heroSubtitle}>{subtitle}</Text>
      </View>

      {/* Two answers, one control. "Done" is not an archive nobody opens — it is how a Mait
          checks what they told a farmer last week before being asked about it again. */}
      <View style={styles.tabsWrap}>
        <View style={styles.tabs}>
          {(['week', 'done'] as const).map(key => {
            const active = key === tab;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(key)}
                style={[styles.tab, active && styles.tabActive]}
                testID={`pd-tab-${key}`}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                  {key === 'week' ? t('pd.tabWeek') : t('pd.tabDone')}
                </Text>
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
            <Ionicons name="location-outline" size={19} color={colors.surface} />
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
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  tabsWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  tabs: { flexDirection: 'row', gap: spacing[2] },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Filled, unlike the chips on AI events: there are two of these and they are a place to be
  // rather than a filter over one list.
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: { ...typography.bodyStrong, color: colors.textMuted },
  tabLabelActive: { color: colors.surface },

  body: { padding: spacing[4] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    padding: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  // The whole card, not a stripe: a thumb covers an edge, and a late row read through a thumb
  // then looks like every other row.
  rowLate: { backgroundColor: colors.errorWash, borderColor: colors.error },
  rowToday: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  rowPressed: { opacity: 0.85 },
  rowBody: { flex: 1 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  badge: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge_late: { backgroundColor: colors.error },
  badge_today: { backgroundColor: colors.secondary },
  badge_soon: { backgroundColor: colors.primaryWash },
  badgeNumber: { ...typography.h2, fontSize: 19, lineHeight: 22 },
  badgeWord: { ...typography.caption, fontSize: 9, lineHeight: 11, letterSpacing: 0.5 },
  badgeText_late: { color: colors.surface },
  badgeText_today: { color: yolk[900] },
  badgeText_soon: { color: colors.primaryDark },

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
  outcome_unsure: { backgroundColor: colors.textMuted },

  legend: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendTitle: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  // Wraps rather than truncates: "Not pregnant" in Hindi is longer than in English, and a
  // legend that clips the word it exists to teach has taught nothing.
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  legendMark: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendLabel: { ...typography.caption, color: colors.text, flexShrink: 1 },

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
});
