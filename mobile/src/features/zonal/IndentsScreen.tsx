/**
 * Indents — everything a Mait has asked this zone for.
 *
 * One question: what is waiting on me. The headline answers it before a row is read ("4
 * waiting on you · oldest 6d"), and each row answers the one that follows — *if I say yes,
 * will anything actually arrive* — with a word worked out from the depot's shelf rather than
 * from the size of the request.
 *
 * The tile beside it is what this manager settled earlier and is still sitting at a depot.
 * Not their work, drawn in yolk to say so: it is the number they ring the store keeper about,
 * and a manager who reads it as their own backlog will approve things twice.
 *
 * **A request, not a row.** A Mait's Request Stock screen is a list, posted as one indent per
 * item a second or two apart; the queue groups them back into what the Mait actually sent
 * (`groupIndents`). Each request is one card: who is asking, with their code and where they
 * work, how long they have waited, and every item with its glyph, its quantity and what the
 * depot can do about it. The card wears the colour of its worst item, because one empty
 * shelf is the fact about a request — not the three full ones beside it.
 *
 * **Approving moves no stock, and the screen says so under the headline.** The depot hands it
 * over and the Mait's code credits it; a manager who thinks this button ships straws is a
 * manager who will not understand why a Mait is still empty tomorrow.
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

import { useGetZonalHomeQuery, useListZonalApprovalsQuery } from '@api/endpoints';
import type { ZonalApproval } from '@api/types';
import { clock } from '@/components/frame';
import { itemLabel } from '@/components/frame';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import {
  coveragePill,
  groupIndents,
  groupTone,
  initials,
  itemIcon,
  Pill,
  rowStyles,
  Tile,
  Tiles,
  ZonalHero,
  zonalStyles,
} from './parts';
import type { IndentGroup, TileTone } from './parts';
import { useLive } from './live';

/** Match what a manager has in front of them: a Mait's name, their vendor code, or IND-13. */
export function matches(row: ZonalApproval, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const number = needle.replace(/^ind[-#\s]*/, '');
  if (/^\d+$/.test(number) && String(row.id) === number) {
    return true;
  }
  return [row.mait_name, row.mait_code].some(word => word.toLowerCase().includes(needle));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What each item's glyph chip wears — the colour its pill already says. */
const ITEM_TONE: Record<ZonalApproval['coverage'], TileTone> = {
  ready: 'good',
  short: 'waiting',
  empty: 'bad',
  'no-store': 'info',
};

export default function IndentsScreen({
  zoneName,
  onOpen,
}: {
  zoneName: string;
  /** One request — every item the Mait raised together. */
  onOpen: (group: IndentGroup) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();

  const live = useLive();
  const home = useGetZonalHomeQuery(undefined, live);
  const queue = useListZonalApprovalsQuery(undefined, live);
  const [term, setTerm] = useState('');

  // Grouped first and searched second, so finding IND-14 brings back the whole request it
  // was raised in rather than one line of it.
  const groups = useMemo(
    () =>
      groupIndents(queue.data?.results ?? []).filter(group =>
        group.rows.some(row => matches(row, term)),
      ),
    [queue.data, term],
  );

  const refreshing = (home.isFetching || queue.isFetching) && !queue.isLoading;
  const refresh = () => {
    home.refetch();
    queue.refetch();
  };

  const figures = home.data;
  const title = figures
    ? figures.waiting === 0
      ? t('zonal.nothingWaitingOn')
      : figures.oldest_waiting_days > 0
        ? `${t('zonal.waitingOn', { count: figures.waiting })} · ${t('zonal.oldestWaiting', {
            days: figures.oldest_waiting_days,
          })}`
        : t('zonal.waitingOn', { count: figures.waiting })
    : t('zonal.eyebrow');

  const requestCard = (group: IndentGroup) => {
    const first = group.rows[0]!;
    const tone = groupTone(group.rows);
    const waited = Math.max(...group.rows.map(row => row.waiting_days));
    const raised = new Date(first.requested_at);
    return (
      <Pressable
        key={group.key}
        accessibilityRole="button"
        accessibilityLabel={t('zonal.openRequest', {
          mait: first.mait_name,
          count: group.rows.length,
        })}
        onPress={() => onOpen(group)}
        style={({ pressed }) => [styles.card, styles[`card_${tone}`], pressed && styles.pressed]}
        testID={`zonal-approval-${group.key}`}
      >
        {/* Who is asking: their initial on a yolk disc, their code, where they work. */}
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLabel}>{initials(first.mait_name)}</Text>
          </View>
          <View style={styles.headBody}>
            <Text style={styles.maitName} numberOfLines={1}>
              {first.mait_name}
            </Text>
            <Text style={styles.maitMeta} numberOfLines={1}>
              <Text style={styles.metaLabel}>{`${t('zonal.vendorCodeLabel')}: `}</Text>
              {first.mait_code || '—'}
            </Text>
          </View>
          <View style={[styles.waited, waited >= 3 && styles.waitedLong]}>
            <Ionicons
              name="time-outline"
              size={12}
              color={waited >= 3 ? colors.surface : yolk[800]}
            />
            <Text style={[styles.waitedLabel, waited >= 3 && styles.waitedLabelLong]}>
              {t('zonal.waitedDays', { count: waited })}
            </Text>
          </View>
        </View>

        {!!first.mpp_names.length && (
          <View style={styles.places}>
            <Ionicons name="location" size={12} color={colors.info} />
            <Text style={styles.placesLabel} numberOfLines={1}>
              {first.mpp_names.join(' · ')}
            </Text>
          </View>
        )}

        {/* Every item, a line each, on a white inset so the pills read on any wash. */}
        <View style={styles.items}>
          {group.rows.map((row, index) => {
            const pill = coveragePill(row, t);
            return (
              <View
                key={row.id}
                style={[styles.item, index > 0 && styles.itemRule]}
                testID={`zonal-approval-item-${row.id}`}
              >
                <View style={[styles.itemIcon, styles[`itemIcon_${ITEM_TONE[row.coverage]}`]]}>
                  <Ionicons name={itemIcon(row)} size={14} color={colors.surface} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {itemLabel(row, i18n.language)}
                  </Text>
                  <Text style={styles.itemMeta}>{`IND-${row.id}`}</Text>
                </View>
                <Text style={styles.itemQty}>{row.qty_requested}</Text>
                <Pill
                  label={pill.label}
                  tone={pill.tone}
                  testID={`zonal-approval-${row.id}-pill`}
                />
              </View>
            );
          })}
        </View>

        <View style={styles.foot}>
          <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
          <Text style={styles.footLabel} numberOfLines={1}>
            {t('zonal.requestFoot', {
              count: group.rows.length,
              when: `${raised.getDate()} ${MONTHS[raised.getMonth()]}, ${clock(first.requested_at)}`,
            })}
          </Text>
          <Text style={styles.review}>{t('zonal.review')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryDark} />
        </View>
      </Pressable>
    );
  };

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
          testID="zonal-queue-error"
        />
      );
    }
    if (!groups.length) {
      return term ? (
        <Text style={rowStyles.quiet} testID="zonal-find-none">
          {t('zonal.findNone', { term })}
        </Text>
      ) : (
        <EmptyState
          title={t('zonal.emptyTitle')}
          body={t('zonal.emptyBody')}
          testID="zonal-empty"
        />
      );
    }
    return <>{groups.map(requestCard)}</>;
  };

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        eyebrow={t('zonal.eyebrow')}
        pill={zoneName}
        title={title}
        subtitle={t('zonal.movesNoStock')}
        testID="zonal-hero"
      />

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {/* What the queue is, from both ends. The second figure is not this manager's work —
            it is waiting on a depot — so it is yolk rather than green, and it is inert: there
            is nothing on this screen for them to do about it. */}
        <Tiles>
          <Tile
            icon="hourglass"
            label={t('zonal.waitingTile')}
            value={figures?.waiting ?? '—'}
            tone={(figures?.waiting ?? 0) > 0 ? 'waiting' : 'good'}
            testID="zonal-waiting-tile"
          />
          <Tile
            icon="storefront"
            label={t('zonal.atDepot')}
            value={figures?.at_depot ?? '—'}
            tone="info"
            testID="zonal-at-depot"
          />
        </Tiles>

        {/* Straight under the figures. The first thing a manager does with a Sahayak on the
            phone is look them up. */}
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('zonal.findPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            testID="zonal-find-input"
          />
          {term ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={() => setTerm('')}
              style={styles.searchClose}
              testID="zonal-find-close"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // -- a request -----------------------------------------------------------------------------
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
    backgroundColor: yolk[500],
  },
  avatarLabel: { ...typography.label, color: colors.ink },
  headBody: { flex: 1 },
  maitName: { ...typography.h3, color: colors.ink },
  maitMeta: { ...typography.caption, color: colors.ink },
  metaLabel: { fontFamily: typography.label.fontFamily, color: yolk[800] },
  waited: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  // Three days and more is a Mait who has been left waiting, and the pill turns red to say so.
  waitedLong: { backgroundColor: colors.error },
  waitedLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: yolk[800] },
  waitedLabelLong: { color: colors.surface },
  places: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  placesLabel: { ...typography.caption, color: colors.info, flex: 1 },
  items: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  itemRule: { borderTopWidth: 1, borderTopColor: colors.border },
  itemIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIcon_good: { backgroundColor: colors.primary },
  itemIcon_waiting: { backgroundColor: yolk[600] },
  itemIcon_bad: { backgroundColor: colors.error },
  itemIcon_info: { backgroundColor: colors.info },
  itemIcon_plain: { backgroundColor: colors.textMuted },
  itemBody: { flex: 1 },
  itemName: { ...typography.bodyStrong, color: colors.ink },
  itemMeta: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  itemQty: { ...typography.h3, color: colors.ink },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  footLabel: { ...typography.caption, color: colors.textMuted, flex: 1 },
  review: { ...typography.label, color: colors.primaryDark },

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
