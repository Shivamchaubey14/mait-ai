/**
 * Reports, for an admin — the AI-event preview behind the portal's Reports & export (W17).
 *
 * The portal screen is preview-then-export, in that order on purpose: an operator who exports
 * blind discovers a wrong date range only after mailing the file. The CSV is streamed to disk
 * and belongs at a desk, so the handset keeps the half that travels — the preview. Pick a
 * window and a status, and the screen leads with *how many match*, then the most recent few, so
 * an office account in the field can sanity-check the total before anyone runs the real export
 * on the portal.
 *
 * The count is the server's own `count` for the filter, not the length of the page shown — the
 * whole point is the figure an operator checks the export against.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListAiEventsQuery } from '@api/endpoints';
import type { AIEvent } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

type Range = 'today' | 'week' | 'month' | 'all';
type Status = 'all' | 'completed' | 'payment_pending' | 'cancelled';

const RANGES: Range[] = ['today', 'week', 'month', 'all'];
const STATUSES: Status[] = ['all', 'completed', 'payment_pending', 'cancelled'];

const STATUS_LOOK: Record<string, { wash: string; tint: string }> = {
  completed: { wash: colors.primaryWash, tint: colors.primaryDark },
  payment_pending: { wash: colors.secondaryWash, tint: yolk[800] },
  cancelled: { wash: colors.errorWash, tint: colors.error },
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The window as the API wants it — a local `YYYY-MM-DD` pair, or nothing for all time. */
function windowFor(range: Range): { dateFrom?: string; dateTo?: string } {
  if (range === 'all') {return {};}
  const to = new Date();
  const from = new Date();
  if (range === 'week') {from.setDate(from.getDate() - 6);}
  if (range === 'month') {from.setDate(from.getDate() - 29);}
  return { dateFrom: ymd(from), dateTo: ymd(to) };
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Chip({
  active,
  onPress,
  label,
  testID,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ event }: { event: AIEvent }): React.JSX.Element {
  const l = STATUS_LOOK[event.status] ?? { wash: colors.infoWash, tint: colors.info };
  return (
    <View style={adminStyles.row} testID={`admin-report-${event.id}`}>
      <View style={adminStyles.rowBody}>
        <Text style={adminStyles.rowName} numberOfLines={1}>
          {event.owner_name || `#${event.id}`}
        </Text>
        <Text style={adminStyles.rowMeta} numberOfLines={1}>
          {[event.mpp_name, event.mait_name, when(event.created_at)].filter(Boolean).join(' · ')}
        </Text>
        <View style={[styles.pill, { backgroundColor: l.wash }]}>
          <Text style={[styles.pillLabel, { color: l.tint }]}>{event.status_display}</Text>
        </View>
      </View>
      {event.amount_due != null && <Text style={styles.amount}>₹ {event.amount_due}</Text>}
    </View>
  );
}

export default function AdminReportsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('month');
  const [status, setStatus] = useState<Status>('all');

  const args = useMemo(
    () => ({ ...windowFor(range), ...(status === 'all' ? {} : { status }) }),
    [range, status],
  );
  const data = useAdminListAiEventsQuery(args);
  const page = data.data;
  const rows = page?.results ?? [];

  return (
    <View style={adminStyles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {RANGES.map(r => (
          <Chip
            key={r}
            active={range === r}
            onPress={() => setRange(r)}
            label={t(`admin.reports.range_${r}`)}
            testID={`admin-reports-range-${r}`}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {STATUSES.map(s => (
          <Chip
            key={s}
            active={status === s}
            onPress={() => setStatus(s)}
            label={t(`admin.reports.status_${s}`)}
            testID={`admin-reports-status-${s}`}
          />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={adminStyles.body}>
        {data.isLoading ? (
          <Loading />
        ) : data.isError || !page ? (
          <EmptyState message={t('admin.reports.error')} />
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroValue}>{page.count.toLocaleString('en-IN')}</Text>
              <Text style={styles.heroLabel}>{t('admin.reports.matching')}</Text>
            </View>

            <View style={styles.note}>
              <Ionicons name="desktop-outline" size={16} color={colors.info} />
              <Text style={styles.noteText}>{t('admin.reports.exportNote')}</Text>
            </View>

            {rows.length === 0 ? (
              <EmptyState message={t('admin.reports.none')} />
            ) : (
              <>
                <Text style={styles.showing}>
                  {t('admin.reports.showing', { shown: Math.min(rows.length, page.count) })}
                </Text>
                {rows.map(event => (
                  <Row key={event.id} event={event} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: spacing[4], paddingTop: spacing[3], gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  chipActive: { backgroundColor: colors.info },
  chipLabel: { ...typography.label, color: colors.info },
  chipLabelActive: { color: colors.surface },

  hero: {
    alignItems: 'center',
    padding: spacing[5],
    borderRadius: radius.xl,
    backgroundColor: colors.ink,
  },
  heroValue: { ...typography.display, fontSize: 48, lineHeight: 54, color: colors.surface },
  heroLabel: { ...typography.body, color: colors.surface, opacity: 0.72 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
  },
  noteText: { ...typography.caption, color: colors.info, flex: 1 },

  showing: { ...typography.caption, color: colors.textMuted },

  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },
  amount: { ...typography.bodyStrong, color: colors.ink, alignSelf: 'center' },
});
