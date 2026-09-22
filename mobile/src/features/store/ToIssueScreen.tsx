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
 *
 * **Every row wears its shelf**, the way the zonal manager's screens do: green when the shelf
 * covers what is owed, yolk when it covers some, red when it covers none. Each carries the
 * Mait's initials, their code, the item's glyph and the count on a white badge, and says in a
 * sentence what the shelf can do and who agreed to it. A code waiting on a Mait is a yolk card
 * with the digits large enough to read out across a counter — red once it has locked.
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
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import {
  useGetStoreHomeQuery,
  useListStoreHandoversQuery,
  useListStoreIndentsQuery,
} from '@api/endpoints';
import type { StoreHandover, StoreIndent } from '@api/types';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { initials, Tile, Tiles } from '@/components/frame';
import type { TileTone } from '@/components/frame';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import {
  clock,
  itemLabel,
  Pill,
  readinessPill,
  StoreAction,
  StoreHero,
  storeStyles,
} from './parts';

/** The colour a row wears: what the shelf can do about it. */
const READINESS_TONE: Record<StoreIndent['readiness'], TileTone> = {
  ready: 'good',
  short: 'waiting',
  waiting: 'bad',
};

/** A section's heading: its glyph on a solid chip, the words, and how many. */
function Section({
  icon,
  tone,
  label,
  count,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: TileTone;
  label: string;
  count: number;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.sectionHead} testID={testID}>
      <View style={[styles.sectionChip, styles[`solid_${tone}`]]}>
        <Ionicons name={icon} size={14} color={tone === 'waiting' ? colors.ink : colors.surface} />
      </View>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionCount}>
        <Text style={styles.sectionCountLabel}>{count}</Text>
      </View>
    </View>
  );
}

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

  /** What the shelf can do about an indent, in the sentence the keeper would say. */
  const shelfSentence = (indent: StoreIndent): string =>
    indent.readiness === 'ready'
      ? t('store.shelfReady', { have: indent.in_store })
      : indent.readiness === 'short'
        ? t('store.shelfShort', { have: indent.in_store, owed: indent.qty_open })
        : t('store.shelfNone');

  const indentRow = (indent: StoreIndent) => {
    const pill = readinessPill(indent, t);
    const tone = READINESS_TONE[indent.readiness];
    const item = itemLabel(indent, i18n.language);
    return (
      <Pressable
        key={indent.id}
        accessibilityRole="button"
        accessibilityLabel={`IND-${indent.id} · ${pill.label}`}
        onPress={() => onOpenIndent(indent)}
        style={({ pressed }) => [styles.card, styles[`card_${tone}`], pressed && styles.pressed]}
        testID={`store-indent-${indent.id}`}
      >
        <View style={styles.head}>
          <View style={[styles.avatar, styles[`solid_${tone}`]]}>
            <Text style={[styles.avatarLabel, tone === 'waiting' && styles.avatarLabelInk]}>
              {initials(indent.mait_name)}
            </Text>
          </View>
          <View style={styles.headBody}>
            <View style={styles.titleLine}>
              <View style={[styles.number, styles[`solid_${tone}`]]}>
                <Text style={[styles.numberLabel, tone === 'waiting' && styles.avatarLabelInk]}>
                  {`IND-${indent.id}`}
                </Text>
              </View>
              <Pill label={pill.label} tone={pill.tone} testID={`store-indent-${indent.id}-pill`} />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {t('store.rowMeta', { mait: indent.mait_name, qty: indent.qty_open, item })}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.metaLabel}>{`${t('store.vendorCode')}: `}</Text>
              {indent.mait_code || '—'}
            </Text>
          </View>
          <View style={styles.count}>
            <Glyph
              name={indent.product_type === 'straw' ? STRAW_GLYPH : 'cube'}
              size={14}
              color={colors.info}
            />
            <Text style={styles.countValue}>{indent.qty_open}</Text>
            <Text style={styles.countUnit} numberOfLines={1}>
              {indent.unit || item}
            </Text>
          </View>
        </View>

        {/* What the shelf can do, and who agreed to it — on paper, so it reads on any wash. */}
        <View style={styles.inset}>
          <View style={styles.insetLine}>
            <Ionicons name="storefront" size={14} color={SOLID[tone]} />
            <Text style={styles.insetText}>{shelfSentence(indent)}</Text>
          </View>
          {!!(indent.approved_by_name || indent.approved_by_zone) && (
            <View style={styles.insetLine}>
              <Ionicons name="checkmark-done" size={14} color={colors.primary} />
              <Text style={styles.insetText} numberOfLines={1}>
                {t('store.agreedBy', {
                  who: [indent.approved_by_name, indent.approved_by_zone]
                    .filter(Boolean)
                    .join(' · '),
                })}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.foot}>
          <Text style={[styles.footLabel, { color: SOLID[tone] }]}>
            {indent.readiness === 'waiting' ? t('store.openIt') : t('store.handOver')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={SOLID[tone]} />
        </View>
      </Pressable>
    );
  };

  /** A handover still waiting on the Mait's code — the code large, to read out across a counter. */
  const handoverRow = (handover: StoreHandover) => (
    <Pressable
      key={handover.id}
      accessibilityRole="button"
      onPress={() => onOpenHandover(handover)}
      style={({ pressed }) => [
        styles.card,
        handover.locked ? styles.card_bad : styles.card_waiting,
        pressed && styles.pressed,
      ]}
      testID={`store-handover-${handover.id}`}
    >
      <View style={styles.head}>
        <View style={[styles.avatar, handover.locked ? styles.solid_bad : styles.solid_waiting]}>
          <Ionicons
            name={handover.locked ? 'lock-closed' : 'key'}
            size={17}
            color={handover.locked ? colors.surface : colors.ink}
          />
        </View>
        <View style={styles.headBody}>
          <View style={styles.titleLine}>
            <View
              style={[styles.number, handover.locked ? styles.solid_bad : styles.solid_waiting]}
            >
              <Text style={[styles.numberLabel, !handover.locked && styles.avatarLabelInk]}>
                {`IND-${handover.indent_id}`}
              </Text>
            </View>
          </View>
          <Text style={styles.name} numberOfLines={1}>
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
      </View>
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
          <Section
            icon="key"
            tone="waiting"
            label={t('store.notCollectedTitle')}
            count={list.length}
          />
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
        <Section
          icon="key"
          tone="waiting"
          label={t('store.codesTitle')}
          count={waitingRows.length}
        />
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
        <Section
          icon="file-tray-full"
          tone="info"
          label={t('store.queueTitle')}
          count={rows.length}
          testID="store-queue-head"
        />
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
        {/* The day, in three figures, each in its own colour with its glyph: what the shelf
            can hand over now, what went over the counter, and what went over and is still
            waiting on a Mait's code. The last two open their lists. */}
        <Tiles>
          <Tile
            icon="checkmark-circle"
            label={t('store.readyTile')}
            value={figures?.ready ?? '—'}
            tone="good"
            testID="store-ready-now"
          />
          <Tile
            icon="arrow-up-circle"
            label={t('store.issuedToday')}
            value={figures?.issued_today ?? '—'}
            tone="info"
            selected={view === 'queue'}
            // The figure is a count of today's history, so tapping it opens that history.
            onPress={() => (onOpenHistory ? onOpenHistory() : setView('queue'))}
            testID="store-issued-today"
          />
          <Tile
            icon="key"
            label={t('store.notCollected')}
            value={figures?.not_collected ?? '—'}
            tone="waiting"
            selected={view === 'notCollected'}
            onPress={() => setView(view === 'notCollected' ? 'queue' : 'notCollected')}
            testID="store-not-collected"
          />
        </Tiles>

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

/** The solid colour of each tone — a glyph, a word or a chip on a wash. */
const SOLID: Record<TileTone, string> = {
  good: colors.primaryDark,
  waiting: yolk[800],
  bad: colors.error,
  info: colors.info,
  plain: colors.textMuted,
};

const styles = StyleSheet.create({
  // -- sections ------------------------------------------------------------------------------
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  sectionChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { ...typography.h3, color: colors.ink, flex: 1 },
  sectionCount: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionCountLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
  },
  sectionHint: {
    ...typography.caption,
    color: yolk[800],
    marginTop: -spacing[1],
    marginBottom: spacing[2],
  },

  // -- solid chips, by tone --------------------------------------------------------------------
  solid_good: { backgroundColor: colors.primary },
  // Ink on yolk, never white — yolk fails contrast under white text.
  solid_waiting: { backgroundColor: yolk[500] },
  solid_bad: { backgroundColor: colors.error },
  solid_info: { backgroundColor: colors.info },
  solid_plain: { backgroundColor: colors.textMuted },

  // -- a card, in its state --------------------------------------------------------------------
  card: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[2],
  },
  card_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_plain: { backgroundColor: colors.surface, borderColor: colors.border },
  pressed: { opacity: 0.85 },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { ...typography.label, color: colors.surface },
  avatarLabelInk: { color: colors.ink },
  headBody: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  number: { paddingHorizontal: spacing[2], paddingVertical: 1, borderRadius: radius.pill },
  numberLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  name: { ...typography.bodyStrong, color: colors.ink },
  meta: { ...typography.caption, color: colors.ink },
  metaLabel: { fontFamily: typography.label.fontFamily, color: colors.textMuted },

  // The count on a white badge: the one number the keeper counts out.
  count: {
    alignItems: 'center',
    minWidth: 58,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  countValue: { ...typography.h2, color: colors.ink },
  countUnit: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.textMuted },

  inset: {
    gap: 4,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  insetLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  insetText: { ...typography.caption, color: colors.ink, flex: 1 },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  footLabel: { ...typography.label },

  code: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: yolk[500],
  },
  codeLabel: { ...typography.h2, letterSpacing: 3, color: colors.ink },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },

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
