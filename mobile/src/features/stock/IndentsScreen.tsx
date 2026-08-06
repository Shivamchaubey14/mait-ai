/**
 * Indents — what a Mait has asked for and where it has got to.
 *
 * Two statuses that routinely disagree are collapsed into one line here, because a Mait does
 * not care which system is holding it up. What they need to know is whether stock is coming
 * and whether anything is waiting on them: an indent sitting approved for a week is not
 * moving on its own, and one marked issued is a trip to the MPP.
 */

import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListIndentsQuery } from '@api/endpoints';
import type { Indent } from '@api/types';
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

export default function IndentsScreen({
  onOpen,
  onBack,
}: {
  onOpen: (indent: Indent) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const indents = useListIndentsQuery();

  const rows = indents.data?.results ?? [];

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
        refreshControl={
          <RefreshControl
            refreshing={indents.isFetching}
            onRefresh={indents.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {indents.isLoading ? (
          <SkeletonList rows={4} />
        ) : indents.isError ? (
          <ErrorState
            title={t('indents.errorTitle')}
            onRetry={() => indents.refetch()}
            busy={indents.isFetching}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={t('indents.emptyTitle')} body={t('indents.emptyBody')} />
        ) : (
          rows.map(indent => {
            const status = statusTone(indent);
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
                    status.tone === 'good' && styles.pillGood,
                    status.tone === 'warn' && styles.pillWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.pillLabel,
                      status.tone === 'good' && styles.pillLabelGood,
                      status.tone === 'warn' && styles.pillLabelWarn,
                    ]}
                  >
                    {status.label}
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginBottom: spacing[2],
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
