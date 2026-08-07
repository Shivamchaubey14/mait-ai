/**
 * Indents — what a Mait has asked for and where it has got to.
 *
 * Two statuses that routinely disagree are collapsed into one line here, because a Mait does
 * not care which system is holding it up. What they need to know is whether stock is coming
 * and whether anything is waiting on them: an indent sitting approved for a week is not
 * moving on its own, and one marked issued is a trip to the MPP.
 *
 * Searching and filtering happen on the rows already fetched rather than by asking the
 * server. `/indents/` returns one Mait's own requests — tens of rows, not thousands — so a
 * round trip per keystroke would buy nothing, and the filter keeps working in a yard with no
 * signal, which is where this screen gets read.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListIndentsQuery } from '@api/endpoints';
import type { Indent, IndentStatus } from '@api/types';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList } from '@/components/states';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
}

/** 24-hour, because a Mait reading a timeline wants the order, not the am/pm puzzle. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The one thing the Mait should read off the row. */
export function statusTone(indent: Indent): { label: string; tone: 'good' | 'warn' | 'info' } {
  if (indent.status === 'issued') {
    return { label: indent.status_display, tone: 'good' };
  }
  if (indent.status === 'rejected') {
    return { label: indent.status_display, tone: 'warn' };
  }
  return { label: indent.status_display, tone: 'info' };
}

const FILTERS: { key: IndentStatus | 'all'; labelKey: string }[] = [
  { key: 'all', labelKey: 'indents.filterAll' },
  { key: 'requested', labelKey: 'indents.filterRequested' },
  { key: 'approved', labelKey: 'indents.filterApproved' },
  { key: 'issued', labelKey: 'indents.filterIssued' },
  { key: 'rejected', labelKey: 'indents.filterRejected' },
];

/**
 * Matched against the number, the breed and the status word.
 *
 * The number is matched with and without its `IND-` prefix: a Mait reading the code off the
 * detail screen types what they see, and one reading it off a depot slip types the digits.
 */
export function matches(indent: Indent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    `ind-${indent.id}`,
    String(indent.id),
    indent.item,
    indent.breed,
    indent.status,
    indent.status_display,
    indent.note,
  ].some(field => (field ?? '').toLowerCase().includes(needle));
}

export default function IndentsScreen({
  onOpen,
  onBack,
}: {
  onOpen: (indent: Indent) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const indents = useListIndentsQuery();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<IndentStatus | 'all'>('all');

  const all = useMemo(() => indents.data?.results ?? [], [indents.data]);
  const rows = useMemo(
    () =>
      all.filter(
        indent => (status === 'all' || indent.status === status) && matches(indent, search),
      ),
    [all, search, status],
  );

  const narrowed = rows.length !== all.length;

  return (
    <View style={styles.root}>
      <PageHero
        title={t('indents.title')}
        subtitle={t('indents.subtitle', { count: indents.data?.count ?? 0 })}
        top={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={styles.back}
            testID="indents-back"
          >
            <Ionicons name="arrow-back" size={18} color={colors.surface} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={indents.isFetching}
            onRefresh={indents.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Hidden while the first load is still running: filtering nothing is a control that
            does nothing, and a Mait tapping it learns the screen is broken. */}
        {!indents.isLoading && !indents.isError && all.length > 0 && (
          <View>
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={t('indents.searchHint')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('common.search')}
                autoCorrect={false}
                autoCapitalize="characters"
                style={styles.searchInput}
                testID="indent-search"
              />
              {search.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('indents.clearSearch')}
                  onPress={() => setSearch('')}
                  style={styles.clear}
                  testID="indent-search-clear"
                >
                  <Ionicons name="close" size={14} color={colors.surface} />
                </Pressable>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              keyboardShouldPersistTaps="handled"
            >
              {FILTERS.map(filter => {
                const active = status === filter.key;
                // Counted off the unfiltered list, so a chip showing 0 tells the Mait there
                // is nothing in that state rather than nothing matching the other chip.
                const count =
                  filter.key === 'all'
                    ? all.length
                    : all.filter(indent => indent.status === filter.key).length;
                return (
                  <Pressable
                    key={filter.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setStatus(filter.key)}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`indent-filter-${filter.key}`}
                  >
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {t(filter.labelKey)} · {count}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {narrowed && (
              <Text style={styles.count} testID="indent-match-count">
                {t('indents.matchCount', { count: rows.length, total: all.length })}
              </Text>
            )}
          </View>
        )}

        {indents.isLoading ? (
          <SkeletonList rows={4} />
        ) : indents.isError ? (
          <ErrorState
            title={t('indents.errorTitle')}
            onRetry={() => indents.refetch()}
            busy={indents.isFetching}
          />
        ) : all.length === 0 ? (
          <EmptyState title={t('indents.emptyTitle')} body={t('indents.emptyBody')} />
        ) : rows.length === 0 ? (
          // Distinct from having raised nothing at all. "No requests yet" in front of a Mait
          // who has raised six of them reads as lost data.
          <EmptyState
            title={t('indents.noMatchTitle')}
            body={t('indents.noMatchBody')}
            testID="indent-no-match"
          />
        ) : (
          rows.map(indent => {
            const status_ = statusTone(indent);
            return (
              <Pressable
                key={indent.id}
                accessibilityRole="button"
                onPress={() => onOpen(indent)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                testID={`indent-${indent.id}`}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>IND-{indent.id}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {indent.item} · {t('indents.raised', { date: shortDate(indent.requested_at) })}
                  </Text>
                </View>

                <View
                  style={[
                    styles.pill,
                    status_.tone === 'good' && styles.pillGood,
                    status_.tone === 'warn' && styles.pillWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.pillLabel,
                      status_.tone === 'good' && styles.pillLabelGood,
                      status_.tone === 'warn' && styles.pillLabelWarn,
                    ]}
                  >
                    {status_.label}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.ink,
    // Android centres short text oddly without this, leaving the caret high in the box.
    paddingVertical: spacing[2],
  },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textDisabled,
  },

  chips: { gap: spacing[2], paddingRight: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { ...typography.label, color: colors.textMuted },
  chipLabelActive: { color: colors.surface },

  count: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginTop: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  rowPressed: { backgroundColor: colors.background },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
  },
  pillGood: { backgroundColor: colors.primaryWash },
  pillWarn: { backgroundColor: colors.secondaryWash },
  pillLabel: { ...typography.caption, color: colors.info },
  pillLabelGood: { color: colors.primaryDark },
  pillLabelWarn: { color: colors.secondaryPressed },
});
