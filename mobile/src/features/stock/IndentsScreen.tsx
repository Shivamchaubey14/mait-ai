/**
 * Your indents — what has been asked for, and what is waiting at the depot (M22).
 *
 * Reached from Profile. It used to hang off Inventory, which was the wrong place for it:
 * Inventory answers "what is in my flask right now", and an indent is by definition stock
 * that is not in it yet. Two lists of things that look like stock, one of which is not, on
 * one tab.
 *
 * The screen answers one question — is anything waiting for me to collect — and the headline
 * answers it before a single row is read. Every row then says what was asked for, where it
 * has got to, and what the Mait should do about it in words rather than in a status code.
 *
 * **Issued is not received.** The dairy's system marks an indent issued when the depot packs
 * it; the stock becomes the Mait's when they pick it up and confirm, and only then does the
 * count on Inventory move. A Mait who reads "issued" as "in my flask" will start a round they
 * cannot finish, so the screen says the difference at the foot rather than leaving it to be
 * learned once, expensively.
 *
 * The search box and the status filters are gone. A Mait has tens of indents, not hundreds,
 * and the two controls cost more room than the rows they were filtering.
 */

import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useListBreedsQuery, useListIndentsQuery } from '@api/endpoints';
import type { Indent } from '@api/types';
import { EmptyState, ErrorState, SkeletonList } from '@/components/states';
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

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
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

/**
 * What is outstanding on this indent, in the words a Mait would use.
 *
 * The status word alone says who is holding it; this says what happens next and who has to
 * do it. "Issued" is the one that matters — it reads like an ending and is a trip to the
 * depot.
 */
function nextStep(indent: Indent, t: TFunction): string {
  if (indent.received_at) {
    return t('indents.lineCollected', { date: shortDate(indent.received_at) });
  }
  switch (indent.status) {
    case 'issued':
      return t('indents.lineIssued', {
        date: shortDate(indent.issued_at ?? indent.requested_at),
      });
    case 'approved':
      return t('indents.lineApproved', { date: shortDate(indent.requested_at) });
    case 'rejected':
      return t('indents.lineRejected', { date: shortDate(indent.requested_at) });
    default:
      return t('indents.lineRequested', { date: shortDate(indent.requested_at) });
  }
}

export default function IndentsScreen({
  onOpen,
  onBack,
}: {
  onOpen: (indent: Indent) => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  const indents = useListIndentsQuery();
  const breeds = useListBreedsQuery();

  const hindi = i18n.language.startsWith('hi');
  const breedName = (code: string): string => {
    const config = (breeds.data ?? []).find(item => item.code === code);
    return (hindi && config?.name_hi) || config?.name || code;
  };

  const rows = indents.data?.results ?? [];
  /** The only count worth a headline: what a Mait could go and fetch today. */
  const waiting = rows.filter(indent => indent.status === 'issued' && !indent.received_at).length;

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="indents-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
          {/* Where this was opened from, so a Mait three screens deep knows which way is out. */}
          <Text style={styles.eyebrow}>{t('nav.settings')}</Text>
        </View>

        <Text style={styles.heroTitle}>{t('indents.title')}</Text>
        <Text style={styles.heroSubtitle} testID="indents-headline">
          {waiting > 0
            ? t('indents.waitingToCollect', { count: waiting })
            : rows.length
              ? t('indents.nothingToCollect', { count: rows.length })
              : ''}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={indents.isFetching && !indents.isLoading}
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
            const collectable = indent.status === 'issued' && !indent.received_at;
            return (
              <Pressable
                key={indent.id}
                accessibilityRole="button"
                accessibilityLabel={`IND-${indent.id} · ${status.label}`}
                onPress={() => onOpen(indent)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                testID={`indent-${indent.id}`}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {t('stock.indentLine', {
                      id: indent.id,
                      item: indent.breed ? breedName(indent.breed) : indent.item,
                      qty: indent.qty_requested,
                    })}
                  </Text>
                  <Text
                    style={[styles.rowMeta, collectable && styles.rowMetaWaiting]}
                    numberOfLines={2}
                  >
                    {nextStep(indent, t)}
                  </Text>
                </View>

                <View style={[styles.pill, styles[`pill_${status.tone}`]]}>
                  <Text style={[styles.pillLabel, styles[`pillLabel_${status.tone}`]]}>
                    {status.label}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            );
          })
        )}

        {/* The sentence this whole screen exists to prevent somebody learning the hard way. */}
        {rows.length > 0 && (
          <View style={styles.footnote} testID="indents-footnote">
            <Ionicons name="warning-outline" size={17} color={colors.secondaryPressed} />
            <Text style={styles.footnoteText}>{t('indents.issuedIsNotReceived')}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // -- hero ------------------------------------------------------------------------------
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
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  // -- rows ------------------------------------------------------------------------------
  body: { padding: spacing[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  rowPressed: { backgroundColor: colors.background },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  // Amber, not red: something is waiting for them, and nothing is wrong.
  rowMetaWaiting: { color: yolk[800] },

  pill: { paddingHorizontal: spacing[3], paddingVertical: 3, borderRadius: radius.pill },
  pill_good: { backgroundColor: colors.primaryWash },
  pill_info: { backgroundColor: colors.infoWash },
  pill_warn: { backgroundColor: colors.errorWash },
  pillLabel: { ...typography.caption },
  pillLabel_good: { color: colors.primaryDark },
  pillLabel_info: { color: colors.info },
  pillLabel_warn: { color: colors.error },

  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  footnoteText: { ...typography.caption, color: colors.textMuted, flex: 1 },
});
