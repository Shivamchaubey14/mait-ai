/**
 * To issue — the store keeper's first screen.
 *
 * One question: what is waiting at my counter, and can I hand it over. The headline answers
 * the first half before a row is read ("5 waiting · 1 short"), and each row answers the second
 * with one word — *Ready*, *Short 7*, *Waiting 4d* — worked out on the server from what the
 * shelf can still promise, not from what is on it. Straws already set aside for a Mait who has
 * not collected them are on the shelf and are not the keeper's to promise twice.
 *
 * The two tiles are the day: what went over the counter, and what went over it and has not
 * been confirmed. The second is a list of its own, one tap away, because "a Mait walked off
 * without typing the code" is the thing a keeper has to chase.
 *
 * **A code is never lost.** Everything issued and not yet collected sits at the top of the queue
 * with its code on the row, so a Mait who comes back having lost it is read it again in one
 * tap — it used to live only on the screen straight after issuing, and on a list behind the
 * *Not collected* tile that nobody thought to open.
 *
 * Every indent here was approved by the zonal manager on the portal. The screen says so under
 * the headline, because a keeper who thinks they are deciding whether to hand stock over is
 * a keeper who will start refusing indents the office already agreed to.
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

import {
  useGetStoreHomeQuery,
  useListStoreHandoversQuery,
  useListStoreIndentsQuery,
} from '@api/endpoints';
import type { StoreHandover, StoreIndent } from '@api/types';
import Problem, { useOnline } from '@/components/problem';
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

import {
  clock,
  itemLabel,
  Pill,
  readinessPill,
  StoreAction,
  StoreHero,
  storeStyles,
} from './parts';

/** Match what a keeper can read off a Mait or their slip: the name, the code, or IND-13. */
export function matches(indent: StoreIndent, term: string): boolean {
  return matchesTerm(indent.id, [indent.mait_name, indent.mait_code], term);
}

/** The same search over what is waiting on a code — a Mait asks for theirs by name. */
export function matchesHandover(handover: StoreHandover, term: string): boolean {
  return matchesTerm(handover.indent_id, [handover.mait_name, handover.collection_code], term);
}

function matchesTerm(id: number, words: string[], term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const number = needle.replace(/^ind[-#\s]*/, '');
  if (/^\d+$/.test(number) && String(id) === number) {
    return true;
  }
  return words.some(word => word.toLowerCase().includes(needle));
}

export default function ToIssueScreen({
  storeName,
  onOpenIndent,
  onOpenHandover,
  onOpenHistory,
}: {
  storeName: string;
  /** Today's history — what the *Issued today* figure is counting. */
  onOpenHistory?: () => void;
  onOpenIndent: (indent: StoreIndent) => void;
  onOpenHandover: (handover: StoreHandover) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();

  const home = useGetStoreHomeQuery();
  const queue = useListStoreIndentsQuery();
  const [view, setView] = useState<'queue' | 'notCollected'>('queue');
  // Always read, not only under the tile: the codes waiting on a Mait head the queue.
  const waiting = useListStoreHandoversQuery('waiting');

  const [term, setTerm] = useState('');

  const rows = useMemo(
    () => (queue.data ?? []).filter(indent => matches(indent, term)),
    [queue.data, term],
  );
  const waitingRows = useMemo(
    () => (waiting.data ?? []).filter(handover => matchesHandover(handover, term)),
    [waiting.data, term],
  );

  const refreshing = (home.isFetching || queue.isFetching) && !queue.isLoading;
  const refresh = () => {
    home.refetch();
    queue.refetch();
    waiting.refetch();
  };

  const figures = home.data;
  const title = figures
    ? figures.short > 0
      ? `${t('store.waiting', { count: figures.waiting })} · ${t('store.short', {
          count: figures.short,
        })}`
      : t('store.waiting', { count: figures.waiting })
    : t('store.eyebrow');

  const indentRow = (indent: StoreIndent) => {
    const pill = readinessPill(indent, t);
    return (
      <Pressable
        key={indent.id}
        accessibilityRole="button"
        accessibilityLabel={`IND-${indent.id} · ${pill.label}`}
        onPress={() => onOpenIndent(indent)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        testID={`store-indent-${indent.id}`}
      >
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle}>{`IND-${indent.id}`}</Text>
            <Pill label={pill.label} tone={pill.tone} testID={`store-indent-${indent.id}-pill`} />
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {t('store.rowMeta', {
              mait: indent.mait_name,
              qty: indent.qty_open,
              item: itemLabel(indent, i18n.language),
            })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    );
  };

  const handoverRow = (handover: StoreHandover) => (
    <Pressable
      key={handover.id}
      accessibilityRole="button"
      onPress={() => onOpenHandover(handover)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`store-handover-${handover.id}`}
    >
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{`IND-${handover.indent_id}`}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {t('store.notCollectedMeta', {
            mait: handover.mait_name,
            qty: handover.qty,
            item: itemLabel(handover, i18n.language),
            time: clock(handover.issued_at),
          })}
        </Text>
      </View>
      {/* The code itself, on the row, large enough to read out from here. Locked after too
          many wrong tries — then the row says so, and opening it offers a new one. */}
      {handover.locked ? (
        <Pill label={t('store.lockedPill')} tone="bad" />
      ) : (
        <View style={styles.code} testID={`store-handover-${handover.id}-code`}>
          <Text style={styles.codeLabel}>{handover.collection_code}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  const body = () => {
    if (queue.isLoading || home.isLoading) {
      return <SkeletonList rows={4} />;
    }
    if (queue.isError || home.isError) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={refresh}
          busy={queue.isFetching}
          testID="store-queue-error"
        />
      );
    }

    if (view === 'notCollected') {
      const list = waiting.data ?? [];
      return (
        <>
          <Text style={styles.section}>{t('store.notCollectedTitle')}</Text>
          {waiting.isLoading ? (
            <SkeletonList rows={2} />
          ) : list.length ? (
            list.map(handoverRow)
          ) : (
            <Text style={styles.quiet}>{t('store.notCollectedEmpty')}</Text>
          )}
        </>
      );
    }

    // Codes still waiting on a Mait, first — they are the handovers already half done.
    const codes = waitingRows.length ? (
      <View testID="store-codes">
        <Text style={styles.section}>{t('store.codesTitle')}</Text>
        <Text style={styles.sectionHint}>{t('store.codesHint')}</Text>
        {waitingRows.map(handoverRow)}
      </View>
    ) : null;

    if (!rows.length) {
      if (codes) {
        return codes;
      }
      return term ? (
        <Text style={styles.quiet} testID="store-find-none">
          {t('store.findNone', { term })}
        </Text>
      ) : (
        <EmptyState title={t('store.emptyTitle')} body={t('store.emptyBody')} />
      );
    }
    return (
      <>
        {codes}
        {codes && <Text style={styles.section}>{t('store.queueTitle')}</Text>}
        {rows.map(indentRow)}
      </>
    );
  };

  return (
    <View style={storeStyles.root}>
      <StoreHero
        eyebrow={t('store.eyebrow')}
        pill={storeName}
        title={title}
        subtitle={t('store.approvedOnPortal')}
        testID="store-hero"
      />

      <ScrollView
        contentContainerStyle={storeStyles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {/* The day, in two figures. The second opens the list of handovers still waiting on a
            Mait's code — tapping it again goes back to the queue. */}
        <View style={styles.tiles}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: view === 'queue' }}
            // The figure is a count of today's history, so tapping it opens that history.
            onPress={() => (onOpenHistory ? onOpenHistory() : setView('queue'))}
            style={[styles.tile, styles.tileGood, view === 'queue' && styles.tileGoodOn]}
            testID="store-issued-today"
          >
            <Text style={[styles.tileLabel, styles.tileLabelGood]}>{t('store.issuedToday')}</Text>
            <Text style={[styles.tileValue, styles.tileValueGood]}>
              {figures?.issued_today ?? '—'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: view === 'notCollected' }}
            onPress={() => setView(view === 'notCollected' ? 'queue' : 'notCollected')}
            style={[styles.tile, styles.tileWait, view === 'notCollected' && styles.tileWaitOn]}
            testID="store-not-collected"
          >
            <Text style={[styles.tileLabel, styles.tileLabelWait]}>{t('store.notCollected')}</Text>
            <Text style={[styles.tileValue, styles.tileValueWait]}>
              {figures?.not_collected ?? '—'}
            </Text>
          </Pressable>
        </View>

        {/* Straight under the day's figures, always open — the first thing a keeper does with a
            Mait at the counter is look them up. */}
        {view === 'queue' && (
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder={t('store.findPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="characters"
              returnKeyType="search"
              testID="store-find-input"
            />
            {term ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                onPress={() => setTerm('')}
                style={styles.searchClose}
                testID="store-find-close"
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        )}

        {body()}
      </ScrollView>

      {view === 'notCollected' && (
        <View style={storeStyles.footer}>
          <StoreAction
            label={t('store.backToQueue')}
            icon="arrow-back"
            tone="outline"
            onPress={() => setView('queue')}
            testID="store-back-to-queue"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[4],
    minHeight: MIN_TOUCH_TARGET + spacing[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Green for what went over the counter, yolk for what went over and is still waiting on
  // somebody — the same two colours every count in this product uses for those two things.
  tileGood: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  tileGoodOn: { borderWidth: 2 },
  tileWait: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  tileWaitOn: { borderWidth: 2 },
  tileLabel: { ...typography.caption, textAlign: 'center' },
  tileLabelGood: { color: colors.primaryDark },
  tileLabelWait: { color: yolk[800] },
  tileValue: { ...typography.h1, marginTop: 2 },
  tileValueGood: { color: colors.primaryDark },
  tileValueWait: { color: colors.ink },

  section: { ...typography.label, color: colors.textMuted, marginBottom: spacing[2] },
  sectionHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing[1],
    marginBottom: spacing[2],
  },
  code: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  codeLabel: { ...typography.h2, letterSpacing: 3, color: colors.ink },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },

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
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 6,
    paddingLeft: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1, paddingVertical: spacing[2] },
  searchClose: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
