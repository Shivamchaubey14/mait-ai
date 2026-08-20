/**
 * A two-tap date range, picked off a month grid.
 *
 * Hand-rolled rather than pulled from a package, for the same reason the sheets and the
 * bottom nav are: a native picker is a different app's furniture — it arrives in the system
 * language rather than the one the Mait chose, it cannot be made to show a *range*, and on
 * Android it opens as a spinner dialog that has nothing to do with anything else here.
 *
 * The interaction is one rule: the first tap starts the range, the second ends it. A second
 * tap that lands before the first is not an error — it starts again from there, which is what
 * somebody who mis-tapped actually meant.
 *
 * Days after today are dead. There are no inseminations in the future, and a range reaching
 * into next week is a range that can only disappoint.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { Sheet } from '@/components/BottomSheet';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/**
 * `YYYY-MM-DD` in the phone's own timezone.
 *
 * Never `toISOString().slice(0, 10)`: that is UTC, and east of Greenwich it names yesterday
 * for every event recorded before half past five in the morning — which for a Mait starting a
 * round at dawn is most of them.
 */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The inverse, at local midnight. `new Date('2026-08-12')` would parse as UTC midnight. */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * The weeks of one month, Sunday first, padded with nulls so every row holds seven cells.
 *
 * Sunday rather than Monday because that is how a wall calendar in an Indian dairy office is
 * printed, and this grid is read by people who check it against one.
 */
export function monthMatrix(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = Array<Date | null>(first.getDay()).fill(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (Date | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

/**
 * The range as one short line — "12 – 18 Aug", "28 Jul – 3 Aug", "12 Aug".
 *
 * The month is said once where both ends share it, because this label rides in a chip beside
 * three others and every character it spends is taken from them.
 */
export function formatRange(from: string, to: string, months: string[]): string {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const startMonth = months[start.getMonth()] ?? '';
  const endMonth = months[end.getMonth()] ?? '';

  if (from === to) {
    return `${start.getDate()} ${startMonth}`;
  }
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} – ${end.getDate()} ${endMonth}`;
  }
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
}

export default function DateRangeSheet({
  visible,
  from,
  to,
  onClose,
  onApply,
  onClear,
}: {
  visible: boolean;
  /** The range in force, so reopening the sheet shows what is already chosen. */
  from: string | null;
  to: string | null;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const weekdays = t('calendar.weekdays', { returnObjects: true }) as string[];

  const today = new Date();
  const todayIso = isoDate(today);

  // Draft, not the applied range: a Mait halfway through picking a new range has an
  // incomplete one in hand, and the list behind the sheet should not flicker through it.
  const [draftFrom, setDraftFrom] = useState<string | null>(from);
  const [draftTo, setDraftTo] = useState<string | null>(to);
  const [cursor, setCursor] = useState(() => (from ? parseIsoDate(from) : today));

  // Reopening starts from what is applied, not from wherever the last abandoned attempt got
  // to. Keyed on `visible` so it runs on open rather than on every render.
  useEffect(() => {
    if (visible) {
      setDraftFrom(from);
      setDraftTo(to);
      setCursor(from ? parseIsoDate(from) : new Date());
    }
  }, [visible, from, to]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const weeks = monthMatrix(year, month);

  // The month holding today is the last one worth turning to.
  const atLastMonth = year === today.getFullYear() && month === today.getMonth();

  const tap = (iso: string): void => {
    // No range started, or one already closed — this tap opens a new one.
    if (!draftFrom || draftTo) {
      setDraftFrom(iso);
      setDraftTo(null);
      return;
    }
    if (iso < draftFrom) {
      setDraftFrom(iso);
      return;
    }
    setDraftTo(iso);
  };

  // A single day is a legitimate answer, so a range with only one end picked applies as
  // that one day rather than sitting there refusing to be used.
  const canApply = !!draftFrom;
  const applied = (): void => {
    if (draftFrom) {
      onApply(draftFrom, draftTo ?? draftFrom);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t('history.dateRangeTitle')}
      subtitle={draftFrom && !draftTo ? t('history.dateRangeThen') : t('history.dateRangeFirst')}
      onClose={onClose}
      testID="ai-events-date-sheet"
      footer={
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onClear}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            testID="date-range-clear"
          >
            <Text style={styles.clearLabel}>{t('history.dateRangeClear')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canApply }}
            disabled={!canApply}
            onPress={applied}
            style={({ pressed }) => [
              styles.apply,
              !canApply && styles.applyInert,
              pressed && canApply && styles.pressed,
            ]}
            testID="date-range-apply"
          >
            <Text style={styles.applyLabel}>{t('history.dateRangeApply')}</Text>
          </Pressable>
        </View>
      }
    >
      <View style={styles.monthBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('history.previousMonth')}
          onPress={() => setCursor(new Date(year, month - 1, 1))}
          style={({ pressed }) => [styles.monthStep, pressed && styles.pressed]}
          testID="date-range-prev-month"
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>

        <Text style={styles.monthLabel} testID="date-range-month">
          {`${months[month]} ${year}`}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('history.nextMonth')}
          accessibilityState={{ disabled: atLastMonth }}
          disabled={atLastMonth}
          onPress={() => setCursor(new Date(year, month + 1, 1))}
          style={({ pressed }) => [
            styles.monthStep,
            atLastMonth && styles.monthStepInert,
            pressed && !atLastMonth && styles.pressed,
          ]}
          testID="date-range-next-month"
        >
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.weekdays}>
        {weekdays.map((label, index) => (
          // Keyed by position: two of the seven initials are the same letter.
          <Text key={index} style={styles.weekday}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.week}>
          {week.map((date, dayIndex) => {
            if (!date) {
              return <View key={dayIndex} style={styles.cell} />;
            }
            const iso = isoDate(date);
            const future = iso > todayIso;
            const isStart = iso === draftFrom;
            const isEnd = iso === draftTo;
            const between = !!draftFrom && !!draftTo && iso > draftFrom && iso < draftTo;

            return (
              <Pressable
                key={dayIndex}
                accessibilityRole="button"
                accessibilityLabel={iso}
                accessibilityState={{ selected: isStart || isEnd, disabled: future }}
                disabled={future}
                onPress={() => tap(iso)}
                // The wash sits on the whole square so a run of days reads as one bar with
                // no gaps between the cells; only the two ends wear a circle.
                style={[styles.cell, between && styles.cellBetween]}
                testID={`date-range-day-${iso}`}
              >
                <View style={[styles.day, (isStart || isEnd) && styles.dayEnd]}>
                  <Text
                    style={[
                      styles.dayLabel,
                      future && styles.dayLabelFuture,
                      iso === todayIso && styles.dayLabelToday,
                      (isStart || isEnd) && styles.dayLabelEnd,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  monthStep: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  monthStepInert: { opacity: 0.3 },
  monthLabel: { ...typography.h3, color: colors.ink },

  weekdays: { flexDirection: 'row', marginBottom: spacing[1] },
  weekday: {
    ...typography.caption,
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: colors.textMuted,
  },

  week: { flexDirection: 'row' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBetween: { backgroundColor: colors.primaryWash },
  day: {
    width: '82%',
    aspectRatio: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayEnd: { backgroundColor: colors.primary },
  dayLabel: { ...typography.body, color: colors.text },
  dayLabelFuture: { color: colors.border },
  // Today is marked by weight rather than by a ring, which would compete with the two
  // circles that mean something here.
  dayLabelToday: { ...typography.bodyStrong, color: colors.primaryDark },
  dayLabelEnd: { ...typography.bodyStrong, color: colors.surface },

  footer: { flexDirection: 'row', gap: spacing[3], paddingTop: spacing[3] },
  pressed: { opacity: 0.85 },
  clear: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearLabel: { ...typography.bodyStrong, color: colors.textMuted },
  apply: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  applyInert: { opacity: 0.5 },
  applyLabel: { ...typography.bodyStrong, color: colors.surface },
});
