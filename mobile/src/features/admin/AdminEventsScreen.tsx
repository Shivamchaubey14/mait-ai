/**
 * AI events, for an admin — the portal's AI events screen on a handset.
 *
 * The same screen as `ai-events.html`, in the same order: the count and an export, then the
 * filters (one search box over event number, name, member / MPP code, mobile and straw; an MPP;
 * a status; the Unfinished chip with how many are waiting; a date range), then the
 * inseminations themselves with the set-wide status split from the server's `summary`.
 *
 * The list reads two ways, and the admin picks: cards, where each event is laid out to be
 * triaged without opening it, or rows — the portal's table, every column, scrolled sideways —
 * for scanning down a page of them. The choice is remembered on the handset.
 *
 * An admin or super admin also gets the two writes the portal allows: ticking events to delete
 * them in one go, and Complete on a member's capture the Mait left stuck with its payment
 * already verified. A Normal User sees neither — no tick, no button that only returns 403.
 * Tapping an event opens its record, which has its own back handler, so the Android gesture
 * closes the record before the rail or the app does.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppText from '@/components/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import {
  useAdminListAiEventsQuery,
  useBulkDeleteAiEventsMutation,
  useDeleteAiEventMutation,
  useGetAiEventQuery,
  useGetAiEventTimelineQuery,
  useListMppsQuery,
  useOfficeCompleteAiEventMutation,
} from '@api/endpoints';
import { downloadAndShare, XLSX_MIME } from '@api/files';
import type { AIEvent, AIEventStatus } from '@api/types';
import { Banner, EmptyState } from '@/components';
import { SkeletonFeed, SkeletonRecord, SkeletonRows } from '@/components/skeleton';
import BottomSheet, { Sheet } from '@/components/BottomSheet';
import DateRangeSheet, { formatRange } from '@/components/dateRange';
import { EventHeroFacts, EventRecordCards } from '@/features/zonal/EventScreen';
import { useAppSelector, type RootState } from '@/store';
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

const LIMIT = 25;
const VIEW_KEY = 'admin.events.view';

type Kind = 'completed' | 'unfinished' | 'cancelled';
type View_ = 'cards' | 'rows';

const STATUSES: AIEventStatus[] = [
  'draft',
  'straw_verified',
  'photo_captured',
  'payment_pending',
  'completed',
  'cancelled',
];

function kindOf(status: AIEventStatus): Kind {
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'unfinished';
}

/**
 * Each card wears its state as a wash across the whole card, with a matching border and a
 * solid disc carrying the verdict — the coloured screen pattern (docs/DESIGN_SYSTEM.md). Green
 * is done, yolk is waiting on the Mait, red is cancelled. `solid` is the disc, `onSolid` its
 * glyph: ink on yolk, never white, which fails contrast there.
 */
const LOOK: Record<
  Kind,
  { tone: string; wash: string; border: string; icon: string; solid: string; onSolid: string }
> = {
  completed: {
    tone: colors.primaryDark,
    wash: colors.primaryWash,
    border: green[300],
    icon: 'checkmark',
    solid: colors.primary,
    onSolid: colors.surface,
  },
  unfinished: {
    tone: yolk[800],
    wash: colors.secondaryWash,
    border: yolk[300],
    icon: 'time',
    solid: yolk[400],
    onSolid: colors.ink,
  },
  cancelled: {
    tone: colors.error,
    wash: colors.errorWash,
    border: colors.error,
    icon: 'close',
    solid: colors.error,
    onSolid: colors.surface,
  },
};

/**
 * The pill colour per status, the portal's exactly: a Mait and an admin looking at the same
 * event must see the same colour, because field users learn colour faster than labels.
 */
const PILL: Record<AIEventStatus, { tone: string; wash: string; border: string }> = {
  completed: { tone: colors.primaryDark, wash: colors.primaryWash, border: green[300] },
  payment_pending: { tone: yolk[800], wash: colors.secondaryWash, border: yolk[300] },
  photo_captured: { tone: colors.info, wash: colors.infoWash, border: ink[100] },
  straw_verified: { tone: colors.info, wash: colors.infoWash, border: ink[100] },
  draft: { tone: ink[500], wash: ink[50], border: ink[200] },
  cancelled: { tone: colors.error, wash: colors.errorWash, border: colors.error },
};

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function num(n: number): string {
  return n.toLocaleString('en-IN');
}

/** "12 Aug 2026, 08:14" — the day the dashboard counts the event on. */
function captured(t: TFunction, event: AIEvent): string {
  const iso = event.completed_at || event.created_at;
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function money(amount: string): string {
  const n = Number(amount);
  return `₹ ${Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : amount}`;
}

/** What the payment cell says: the amount and mode, and a second line when it has not landed. */
function paymentOf(t: TFunction, event: AIEvent): { main: string | null; sub: string | null } {
  const p = event.payment;
  if (!p) {
    // Normal, not missing: the event has not reached the payment step yet.
    return { main: null, sub: t('admin.events.notTaken') };
  }
  const main = p.amount ? `${money(p.amount)} ${p.mode_display}` : p.mode_display;
  if (p.status === 'failed') {
    return { main, sub: t('admin.events.payFailed') };
  }
  if (!p.is_verified) {
    return { main, sub: t('admin.events.awaiting') };
  }
  return { main, sub: null };
}

function animalOf(t: TFunction, event: AIEvent): string {
  const type = t(event.animal_type === 'BUFF' ? 'admin.events.buffalo' : 'admin.events.cow');
  return `${type} · ${event.breed || '—'}`;
}

function statusLabel(t: TFunction, event: AIEvent): string {
  return t(`admin.events.status.${event.status}`, { defaultValue: event.status_display });
}

/**
 * A member's capture the office may close: left at photo captured or payment pending, with its
 * deduction already recorded and verified. A non-member authorises her own payment with a code
 * the office cannot enter, so she is never one. The server checks all of it again.
 */
function completable(event: AIEvent): boolean {
  return (
    event.owner_type === 'member' &&
    (event.status === 'photo_captured' || event.status === 'payment_pending') &&
    !!event.payment &&
    event.payment.is_verified === true
  );
}

// --------------------------------------------------------------------------------------
// Record
// --------------------------------------------------------------------------------------

/**
 * One event, whole — the portal's AI event detail (`ai-event.html`), card for card.
 *
 * The cards are the zonal manager's record (`EventRecordCards`), so the same event is the same
 * colours wherever it is opened: the four figures, the proof photo and the animal's portrait,
 * where, the farmer and her particulars, what was used, whether it took, and the trail. Above
 * them an Ink card names the event, as the portal's title bar does; beside the rail there is no
 * room for a second hero with the status bar's inset.
 */
export function EventRecord({
  eventId,
  canDelete,
  onBack,
  onDeleted,
}: {
  eventId: number;
  canDelete: boolean;
  onBack: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetAiEventQuery(eventId);
  // The trail is its own read on this endpoint, as it is on the portal. A trail that fails to
  // load leaves the rest of the record standing.
  const trail = useGetAiEventTimelineQuery(eventId);
  const [remove, removeState] = useDeleteAiEventMutation();
  const event = detail.data;
  const record = useMemo(
    () => (event ? { ...event, timeline: trail.data ?? [] } : null),
    [event, trail.data],
  );

  const confirmDelete = () => {
    if (!event) {
      return;
    }
    Alert.alert(
      t('admin.events.deleteTitle'),
      t('admin.events.deleteBody', { name: event.owner_name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.events.deleteConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await remove(eventId).unwrap();
              onDeleted();
            } catch {
              Alert.alert(t('admin.events.deleteFailedTitle'), t('admin.events.deleteFailedBody'));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={(detail.isFetching || trail.isFetching) && !detail.isLoading}
            onRefresh={() => {
              detail.refetch();
              trail.refetch();
            }}
          />
        }
        testID="admin-event-record"
      >
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.cardPressed]}
          testID="admin-event-back"
        >
          <Ionicons name="arrow-back" size={16} color={colors.surface} />
          <AppText style={styles.backLabel}>{t('admin.events.allEvents')}</AppText>
        </Pressable>

        {detail.isLoading ? (
          <SkeletonRecord />
        ) : !record ? (
          <EmptyState message={t('admin.events.recordMissing')} />
        ) : (
          <>
            <View style={styles.recordHero} testID="admin-event-hero">
              <View style={styles.recordTag}>
                <AppText style={styles.recordTagLabel}>
                  {t('admin.events.eventTag', { id: record.id })}
                </AppText>
              </View>
              <AppText style={styles.recordTitle}>{record.owner_name}</AppText>
              <EventHeroFacts event={record} testIDPrefix="admin-event" />
            </View>

            <EventRecordCards event={record} testIDPrefix="admin-event" />

            {canDelete && (
              <Pressable
                accessibilityRole="button"
                onPress={confirmDelete}
                disabled={removeState.isLoading}
                style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
                testID="admin-event-delete"
              >
                {removeState.isLoading ? (
                  <ActivityIndicator color={colors.error} />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color={colors.error} />
                    <AppText style={styles.deleteLabel}>{t('admin.events.delete')}</AppText>
                  </>
                )}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------------------

function Check({
  on,
  onPress,
  label,
  disabled,
  testID,
}: {
  on: boolean | 'some';
  onPress: () => void;
  label: string;
  disabled?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on === 'some' ? 'mixed' : on, disabled }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={styles.check}
      testID={testID}
    >
      <Ionicons
        name={on === 'some' ? 'remove-circle' : on ? 'checkbox' : 'square-outline'}
        size={22}
        color={on ? colors.info : colors.textMuted}
      />
    </Pressable>
  );
}

function StatusPill({ event }: { event: AIEvent }): React.JSX.Element {
  const { t } = useTranslation();
  const look = PILL[event.status] ?? PILL.draft;
  return (
    <View style={[styles.pill, { backgroundColor: look.wash, borderColor: look.border }]}>
      <AppText style={[styles.pillLabel, { color: look.tone }]}>{statusLabel(t, event)}</AppText>
    </View>
  );
}

function CompleteButton({
  event,
  busy,
  onPress,
}: {
  event: AIEvent;
  busy: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.complete, pressed && styles.completePressed]}
      testID={`admin-event-complete-${event.id}`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={yolk[800]} />
      ) : (
        <Ionicons name="checkmark-done" size={15} color={yolk[800]} />
      )}
      <AppText style={styles.completeLabel}>
        {t(busy ? 'admin.events.completing' : 'admin.events.complete')}
      </AppText>
    </Pressable>
  );
}

/** A name with its code under it — the portal's identity cell. */
function Identity({
  name,
  sub,
  style,
}: {
  name: string;
  sub?: string | null;
  style?: object;
}): React.JSX.Element {
  return (
    <View style={style}>
      <AppText style={styles.idName}>{name || '—'}</AppText>
      {!!sub && <AppText style={styles.idSub}>{sub}</AppText>}
    </View>
  );
}

interface RowProps {
  canAct: boolean;
  picked: Set<number>;
  onPick: (id: number) => void;
  onOpen: (id: number) => void;
  onComplete: (event: AIEvent) => void;
  completing: number | null;
}

/** One event laid out to be triaged without opening it. */
function EventCard({
  event,
  canAct,
  picked,
  onPick,
  onOpen,
  onComplete,
  completing,
}: RowProps & { event: AIEvent }): React.JSX.Element {
  const { t } = useTranslation();
  const kind = kindOf(event.status);
  const look = LOOK[kind];
  const pay = paymentOf(t, event);
  const on = picked.has(event.id);

  const member = event.owner_type === 'member';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpen(event.id)}
      style={({ pressed }) => [
        styles.card,
        // The state across the whole card, so a screenful is triaged before a word is read.
        { backgroundColor: look.wash, borderColor: look.border },
        on && styles.cardPicked,
        pressed && styles.cardPressed,
      ]}
      testID={`admin-event-${event.id}`}
    >
      <View style={styles.cardTop}>
        {canAct && (
          <Check
            on={on}
            onPress={() => onPick(event.id)}
            label={t('admin.events.pick', { id: event.id })}
            testID={`admin-event-pick-${event.id}`}
          />
        )}
        <View style={[styles.verdict, { backgroundColor: look.solid }]}>
          <Ionicons name={look.icon as never} size={16} color={look.onSolid} />
        </View>
        <View style={[styles.code, { backgroundColor: look.solid }]}>
          <AppText style={[styles.codeLabel, { color: look.onSolid }]}>#{event.id}</AppText>
        </View>
        <View style={styles.flex} />
        <StatusPill event={event} />
      </View>

      <View style={styles.who}>
        <AppText style={styles.whoName}>{event.owner_name}</AppText>
        <View style={[styles.kindPill, member ? styles.kindMember : styles.kindNonMember]}>
          <Ionicons
            name={member ? 'ribbon' : 'person'}
            size={11}
            color={member ? colors.surface : colors.ink}
          />
          <AppText style={[styles.kindLabel, !member && { color: colors.ink }]}>
            {member ? event.mpp_code : t('admin.events.nonMember')}
          </AppText>
        </View>
      </View>

      {/* White is paper, only inside a tinted card: the facts read back over the phone. */}
      <View style={styles.inset}>
        <Fact
          icon="person-outline"
          tint={yolk[800]}
          label={t('admin.events.colMait')}
          value={[event.mait_name, event.mait_code].filter(Boolean).join(' · ') || '—'}
        />
        <Fact
          icon="paw-outline"
          tint={yolk[800]}
          label={t('admin.events.colAnimal')}
          value={animalOf(t, event)}
        />
        <Fact
          icon="cash-outline"
          tint={pay.sub ? yolk[800] : colors.primaryDark}
          label={t('admin.events.colPayment')}
          value={pay.main ?? pay.sub ?? '—'}
          sub={pay.main ? pay.sub : null}
        />
        <Fact
          icon="calendar-outline"
          tint={colors.info}
          label={t('admin.events.colCaptured')}
          value={captured(t, event)}
          last
        />
      </View>

      <View style={styles.cardFoot}>
        {canAct && completable(event) ? (
          <CompleteButton
            event={event}
            busy={completing === event.id}
            onPress={() => onComplete(event)}
          />
        ) : (
          <View />
        )}
        <View style={styles.open}>
          <AppText style={[styles.openLabel, { color: look.tone }]}>
            {t('admin.events.open')}
          </AppText>
          <Ionicons name="chevron-forward" size={15} color={look.tone} />
        </View>
      </View>
    </Pressable>
  );
}

/** One labelled fact on a card's white inset, with its glyph in its own colour. */
function Fact({
  icon,
  tint,
  label,
  value,
  sub,
  last,
}: {
  icon: string;
  tint: string;
  label: string;
  value: string;
  sub?: string | null;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.factRow, !last && styles.factRule]}>
      <Ionicons name={icon as never} size={14} color={tint} style={styles.factIcon} />
      <AppText style={styles.factLabel}>{label}</AppText>
      <View style={styles.factBody}>
        <AppText style={styles.factValue}>{value}</AppText>
        {!!sub && <AppText style={[styles.factSub, { color: yolk[800] }]}>{sub}</AppText>}
      </View>
    </View>
  );
}

/** The portal's table, every column, scrolled sideways. */
const COL = {
  pick: 44,
  event: 64,
  farmer: 150,
  mait: 150,
  animal: 130,
  payment: 150,
  captured: 150,
  status: 140,
  complete: 128,
};

function EventTable({
  events,
  canAct,
  picked,
  onPick,
  onPickAll,
  onOpen,
  onComplete,
  completing,
}: RowProps & { events: AIEvent[]; onPickAll: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const all = events.length > 0 && events.every(e => picked.has(e.id));
  const some = !all && events.some(e => picked.has(e.id));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableWrap}>
      <View>
        <View style={[styles.tr, styles.th]}>
          {canAct && (
            <View style={[styles.td, { width: COL.pick }]}>
              <Check
                on={all ? true : some ? 'some' : false}
                onPress={onPickAll}
                label={t('admin.events.pickAll')}
                testID="admin-events-pick-all"
              />
            </View>
          )}
          {(
            [
              ['event', 'colEvent'],
              ['farmer', 'colFarmer'],
              ['mait', 'colMait'],
              ['animal', 'colAnimal'],
              ['payment', 'colPayment'],
              ['captured', 'colCaptured'],
              ['status', 'colStatus'],
              ...(canAct ? [['complete', 'colComplete']] : []),
            ] as [keyof typeof COL, string][]
          ).map(([col, label]) => (
            <View key={col} style={[styles.td, { width: COL[col] }]}>
              <AppText style={styles.thLabel}>{t(`admin.events.${label}`)}</AppText>
            </View>
          ))}
        </View>

        {events.map(event => {
          const kind = kindOf(event.status);
          const pay = paymentOf(t, event);
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              onPress={() => onOpen(event.id)}
              style={({ pressed }) => [
                styles.tr,
                { backgroundColor: LOOK[kind].wash, borderBottomColor: LOOK[kind].border },
                picked.has(event.id) && styles.trPicked,
                pressed && styles.cardPressed,
              ]}
              testID={`admin-event-row-${event.id}`}
            >
              {canAct && (
                <View style={[styles.td, { width: COL.pick }]}>
                  <Check
                    on={picked.has(event.id)}
                    onPress={() => onPick(event.id)}
                    label={t('admin.events.pick', { id: event.id })}
                  />
                </View>
              )}
              <View style={[styles.td, { width: COL.event }]}>
                <View style={[styles.code, { backgroundColor: LOOK[kind].solid }]}>
                  <AppText style={[styles.codeLabel, { color: LOOK[kind].onSolid }]}>
                    {event.id}
                  </AppText>
                </View>
              </View>
              <Identity
                style={[styles.td, { width: COL.farmer }]}
                name={event.owner_name}
                sub={event.owner_type === 'member' ? event.mpp_code : t('admin.events.nonMember')}
              />
              <Identity
                style={[styles.td, { width: COL.mait }]}
                name={event.mait_name ?? ''}
                sub={event.mait_code}
              />
              <View style={[styles.td, { width: COL.animal }]}>
                <AppText style={styles.tdText}>{animalOf(t, event)}</AppText>
              </View>
              <View style={[styles.td, { width: COL.payment }]}>
                {!!pay.main && <AppText style={styles.tdText}>{pay.main}</AppText>}
                {!!pay.sub && <AppText style={styles.idSub}>{pay.sub}</AppText>}
              </View>
              <View style={[styles.td, { width: COL.captured }]}>
                <AppText style={styles.tdText}>{captured(t, event)}</AppText>
              </View>
              <View style={[styles.td, { width: COL.status }]}>
                <StatusPill event={event} />
              </View>
              {canAct && (
                <View style={[styles.td, { width: COL.complete }]}>
                  {completable(event) && (
                    <CompleteButton
                      event={event}
                      busy={completing === event.id}
                      onPress={() => onComplete(event)}
                    />
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** A filter in the bar: what it is set to, tinted when it is narrowing the list. */
function FilterChip({
  icon,
  label,
  active,
  onPress,
  count,
  warn,
  testID,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  warn?: boolean;
  testID?: string;
}): React.JSX.Element {
  // Filters are blue — a fact about what is on screen — and the Unfinished chip is yolk,
  // because it lists work waiting on a Mait. Washed at rest, solid once it narrows the list.
  const tint = warn ? yolk[800] : colors.info;
  const wash = warn ? colors.secondaryWash : colors.infoWash;
  const edge = warn ? yolk[300] : colors.info;
  const solid = warn ? yolk[400] : colors.info;
  const onSolid = warn ? colors.ink : colors.surface;
  const fore = active ? onSolid : tint;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filter,
        {
          borderColor: active ? solid : edge,
          backgroundColor: active ? solid : wash,
        },
        pressed && styles.cardPressed,
      ]}
      testID={testID}
    >
      <Ionicons name={icon as never} size={15} color={fore} />
      <AppText style={[styles.filterLabel, { color: fore }]} numberOfLines={1}>
        {label}
      </AppText>
      {!!count && (
        <View style={[styles.filterCount, { backgroundColor: active ? colors.surface : solid }]}>
          <AppText
            style={[
              styles.filterCountLabel,
              { color: warn || active ? colors.ink : colors.surface },
            ]}
          >
            {num(count)}
          </AppText>
        </View>
      )}
      {!warn && <Ionicons name="chevron-down" size={13} color={fore} />}
    </Pressable>
  );
}

export function MppSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string | null;
  onSelect: (mpp: { code: string; name: string } | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useListMppsQuery(search ? { search } : undefined, { skip: !visible });
  const rows = list.data?.results ?? [];

  const option = (code: string | null, name: string, sub?: string) => {
    const on = selected === code;
    return (
      <Pressable
        key={code ?? 'all'}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => {
          onSelect(code ? { code, name } : null);
          onClose();
        }}
        style={[styles.option, on && styles.optionOn]}
        testID={`admin-events-mpp-${code ?? 'all'}`}
      >
        <View style={styles.flex}>
          <AppText style={[styles.optionLabel, on && { color: colors.info }]}>{name}</AppText>
          {!!sub && <AppText style={styles.idSub}>{sub}</AppText>}
        </View>
        {on && <Ionicons name="checkmark" size={18} color={colors.info} />}
      </Pressable>
    );
  };

  return (
    <Sheet
      visible={visible}
      title={t('admin.events.mppTitle')}
      onClose={onClose}
      testID="admin-events-mpp-sheet"
    >
      <View style={styles.sheetSearch}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={term}
          onChangeText={setTerm}
          placeholder={t('admin.events.mppSearch')}
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
        />
      </View>
      {option(null, t('admin.events.mppAll'))}
      {list.isFetching && rows.length === 0 ? (
        <SkeletonFeed rows={4} />
      ) : (
        rows.map(mpp => option(mpp.mpp_code, mpp.mpp_name, mpp.mpp_code))
      )}
    </Sheet>
  );
}

export default function AdminEventsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const role = useAppSelector(state => state.auth.user?.role);
  // Deleting and completing are the same back-office correction, gated by the API to the
  // same admins. For anyone else neither control is drawn.
  const canAct = role === 'super_admin' || role === 'admin';

  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [mpp, setMpp] = useState<{ code: string; name: string } | null>(null);
  const [status, setStatus] = useState<AIEventStatus | null>(null);
  const [unfinished, setUnfinished] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [view, setView] = useState<View_>('cards');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<'mpp' | 'status' | 'dates' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [completing, setCompleting] = useState<number | null>(null);

  const [bulkDelete, bulkState] = useBulkDeleteAiEventsMutation();
  const [officeComplete] = useOfficeCompleteAiEventMutation();

  // The view the admin last chose, kept on the handset. A storage that cannot be read just
  // leaves the cards.
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then(saved => {
        if (saved === 'rows' || saved === 'cards') {
          setView(saved);
        }
      })
      .catch(() => undefined);
  }, []);
  const chooseView = (next: View_) => {
    setView(next);
    AsyncStorage.setItem(VIEW_KEY, next).catch(() => undefined);
  };

  const filters = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(mpp ? { mpp: mpp.code } : {}),
      // The server decides what "unfinished" means. Left off when a status is chosen: the two
      // would AND, and that is just a longer way to pick one status.
      ...(unfinished && !status ? { unfinished: true } : {}),
      ...(range ? { dateFrom: range.from, dateTo: range.to } : {}),
    }),
    [search, status, mpp, unfinished, range],
  );
  const args = useMemo(() => ({ ...filters, offset }), [filters, offset]);
  const list = useAdminListAiEventsQuery(args);

  // A new search or filter starts the page over.
  useEffect(() => {
    setOffset(0);
  }, [filters]);

  // The list was rebuilt, so nothing on it is ticked any more.
  useEffect(() => {
    setPicked(new Set());
  }, [list.data]);

  const rows = list.data?.results ?? [];
  const summary = list.data?.summary;
  const total = list.data?.count ?? 0;
  const anyFilter = !!(search || status || mpp || unfinished || range);

  // Close the record on the Android back gesture before anything above this screen sees it.
  useEffect(() => {
    if (open === null) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const pick = useCallback((id: number) => {
    setPicked(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const pickAll = () => {
    setPicked(current =>
      rows.every(e => current.has(e.id)) ? new Set() : new Set(rows.map(e => e.id)),
    );
  };

  const clearFilters = () => {
    setTerm('');
    setMpp(null);
    setStatus(null);
    setUnfinished(false);
    setRange(null);
  };

  /**
   * Export what is on the screen — the same filters, without `limit` and `offset`: those are
   * how this list pages, and passing them would hand back the twenty-five rows on screen as a
   * file that looks complete and is not.
   */
  const exportCsv = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setExporting(true);
    const params: Record<string, string> = {};
    if (filters.search) {
      params.search = filters.search;
    }
    if (filters.status) {
      params.status = filters.status;
    }
    if (filters.mpp) {
      params.mpp = filters.mpp;
    }
    if (filters.unfinished) {
      params.unfinished = 'true';
    }
    if (filters.dateFrom) {
      params.date_from = filters.dateFrom;
    }
    if (filters.dateTo) {
      params.date_to = filters.dateTo;
    }
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    try {
      await downloadAndShare(
        `/reports/export/${query ? `?${query}` : ''}`,
        'ai-events.xlsx',
        XLSX_MIME,
        access,
      );
    } catch {
      setProblem(t('admin.events.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const runDelete = () => {
    const ids = [...picked];
    if (!ids.length) {
      return;
    }
    Alert.alert(
      t('admin.events.bulkTitle'),
      t('admin.events.bulkBody', { count: ids.length, n: num(ids.length) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.events.deleteN', { n: num(ids.length) }),
          style: 'destructive',
          onPress: async () => {
            setProblem(null);
            try {
              const result = await bulkDelete(ids).unwrap();
              const n = result?.deleted_count ?? ids.length;
              setOffset(0);
              setFlash(t('admin.events.deleted', { count: n, n: num(n) }));
            } catch {
              setProblem(t('admin.events.actionFailed'));
            }
          },
        },
      ],
    );
  };

  const runComplete = (event: AIEvent) => {
    Alert.alert(t('admin.events.completeTitle', { id: event.id }), t('admin.events.completeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.events.complete'),
        onPress: async () => {
          setProblem(null);
          setCompleting(event.id);
          try {
            await officeComplete(event.id).unwrap();
            setFlash(t('admin.events.completed', { id: event.id }));
          } catch (error) {
            const detail = (error as { data?: { detail?: string } })?.data?.detail;
            setProblem(detail ?? t('admin.events.actionFailed'));
          } finally {
            setCompleting(null);
          }
        },
      },
    ]);
  };

  if (open !== null) {
    return (
      <EventRecord
        eventId={open}
        canDelete={canAct}
        onBack={() => setOpen(null)}
        onDeleted={() => {
          setOpen(null);
          list.refetch();
        }}
      />
    );
  }

  // The count, its status split (what the dashboard counts vs what is still open), then how
  // many are on screen. No split under Unfinished: the whole list is unfinished there.
  const note = (() => {
    if (!list.data) {
      return '—';
    }
    const onlyUnfinished = unfinished && !status;
    const parts = [
      t(onlyUnfinished ? 'admin.events.noteUnfinished' : 'admin.events.noteMatching', {
        n: num(total),
      }),
    ];
    if (!onlyUnfinished && summary) {
      const split = [
        summary.completed ? t('admin.events.splitCompleted', { n: num(summary.completed) }) : null,
        summary.unfinished
          ? t('admin.events.splitUnfinished', { n: num(summary.unfinished) })
          : null,
        summary.cancelled ? t('admin.events.splitCancelled', { n: num(summary.cancelled) }) : null,
      ].filter(Boolean);
      if (split.length) {
        parts.push(split.join(' · '));
      }
    }
    parts.push(t('admin.events.noteShowing', { n: num(rows.length) }));
    return parts.join(' · ');
  })();

  const months = t('calendar.months', { returnObjects: true }) as string[];
  const rowProps: RowProps = {
    canAct,
    picked,
    onPick: pick,
    onOpen: setOpen,
    onComplete: runComplete,
    completing,
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isLoading}
            onRefresh={() => list.refetch()}
          />
        }
        testID="admin-events"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-events-count">
            {list.data ? t('admin.events.eventCount', { count: total, n: num(total) }) : '—'}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={exportCsv}
            disabled={exporting}
            style={({ pressed }) => [styles.export, (pressed || exporting) && styles.exportBusy]}
            testID="admin-events-export"
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Ionicons name="download-outline" size={16} color={colors.surface} />
            )}
            <AppText style={styles.exportLabel}>
              {t(exporting ? 'admin.events.exporting' : 'admin.events.export')}
            </AppText>
          </Pressable>
        </View>

        {!!flash && <Banner message={flash} tone="info" testID="admin-events-flash" />}
        {!!problem && <Banner message={problem} testID="admin-events-problem" />}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={text => {
              setFlash(null);
              setTerm(text);
            }}
            placeholder={t('admin.events.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-events-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Two columns under the search box: the MPP over the status at its left end, what is
            waiting over the dates at its right, open space between. Each row reads as one
            pill at either end. */}
        <View style={styles.filters}>
          <View style={styles.filterGroup} testID="admin-events-filters-left">
            <FilterChip
              icon="business-outline"
              label={mpp ? mpp.name : t('admin.events.mppAll')}
              active={!!mpp}
              onPress={() => setSheet('mpp')}
              testID="admin-events-filter-mpp"
            />
            <FilterChip
              icon="funnel-outline"
              label={status ? t(`admin.events.status.${status}`) : t('admin.events.statusAll')}
              active={!!status}
              onPress={() => setSheet('status')}
              testID="admin-events-filter-status"
            />
          </View>
          <View style={styles.filterGroup} testID="admin-events-filters-right">
            <FilterChip
              icon="time-outline"
              label={t('admin.events.unfinished')}
              active={unfinished && !status}
              warn
              // How many in this view still wait on a Mait — hidden once the chip is pressed,
              // where the whole list is that number.
              count={!unfinished ? summary?.unfinished : undefined}
              onPress={() => {
                const on = !unfinished;
                setUnfinished(on);
                // The chip asks for the whole unfinished set, which a lone status contradicts.
                if (on) {
                  setStatus(null);
                }
              }}
              testID="admin-events-filter-unfinished"
            />
            <FilterChip
              icon="calendar-outline"
              label={range ? formatRange(range.from, range.to, months) : t('admin.events.dates')}
              active={!!range}
              onPress={() => setSheet('dates')}
              testID="admin-events-filter-dates"
            />
          </View>
        </View>
        {anyFilter && (
          <Pressable
            accessibilityRole="button"
            onPress={clearFilters}
            style={({ pressed }) => [styles.clear, pressed && styles.cardPressed]}
            testID="admin-events-clear"
          >
            <Ionicons name="close" size={14} color={colors.error} />
            <AppText style={styles.clearLabel}>{t('admin.events.clearFilters')}</AppText>
          </Pressable>
        )}

        {/* The section head: a solid chip, the title, and the total on a count bubble — the
            status split under it. */}
        <View style={styles.panelHead}>
          <View style={styles.panelIcon}>
            <Ionicons name="pulse" size={16} color={colors.surface} />
          </View>
          <View style={styles.flex}>
            <View style={styles.panelTitleRow}>
              <AppText style={styles.panelTitle}>{t('admin.events.title')}</AppText>
              {!!list.data && (
                <View style={styles.bubble}>
                  <AppText style={styles.bubbleLabel}>{num(total)}</AppText>
                </View>
              )}
            </View>
            <AppText style={styles.panelNote} testID="admin-events-note">
              {note}
            </AppText>
          </View>
        </View>

        <View style={styles.toggle} accessibilityRole="tablist">
          {(
            [
              ['cards', 'grid-outline', 'viewCards'],
              ['rows', 'list-outline', 'viewRows'],
            ] as [View_, string, string][]
          ).map(([key, icon, label]) => {
            const on = view === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => chooseView(key)}
                style={[styles.toggleItem, on && styles.toggleOn]}
                testID={`admin-events-view-${key}`}
              >
                <Ionicons name={icon as never} size={16} color={on ? colors.surface : colors.ink} />
                <AppText style={[styles.toggleLabel, on && styles.toggleLabelOn]}>
                  {t(`admin.events.${label}`)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {canAct && picked.size > 0 && (
          <View style={styles.bulk} testID="admin-events-bulk">
            <AppText style={styles.bulkCount}>
              {t('admin.events.selected', { count: picked.size, n: num(picked.size) })}
            </AppText>
            <View style={styles.bulkActions}>
              <Pressable
                accessibilityRole="button"
                onPress={runDelete}
                disabled={bulkState.isLoading}
                style={({ pressed }) => [styles.bulkDelete, pressed && styles.completePressed]}
                testID="admin-events-bulk-delete"
              >
                {bulkState.isLoading ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Ionicons name="trash-outline" size={15} color={colors.error} />
                )}
                <AppText style={styles.bulkDeleteLabel}>
                  {bulkState.isLoading
                    ? t('admin.events.deleting')
                    : t('admin.events.deleteN', { n: num(picked.size) })}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPicked(new Set())}
                disabled={bulkState.isLoading}
                style={styles.bulkClear}
                testID="admin-events-bulk-clear"
              >
                <AppText style={styles.bulkClearLabel}>{t('admin.events.clear')}</AppText>
              </Pressable>
            </View>
          </View>
        )}

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.events.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={anyFilter ? t('admin.events.noneMatch') : t('admin.events.none')} />
        ) : view === 'rows' ? (
          <EventTable events={rows} onPickAll={pickAll} {...rowProps} />
        ) : (
          <>
            {canAct && (
              <View style={styles.pickAllRow}>
                <Check
                  on={
                    rows.every(e => picked.has(e.id))
                      ? true
                      : rows.some(e => picked.has(e.id))
                        ? 'some'
                        : false
                  }
                  onPress={pickAll}
                  label={t('admin.events.pickAll')}
                  testID="admin-events-pick-all"
                />
                <AppText style={styles.pickAllLabel}>{t('admin.events.pickAll')}</AppText>
              </View>
            )}
            {rows.map(event => (
              <EventCard key={event.id} event={event} {...rowProps} />
            ))}
          </>
        )}

        {total > LIMIT && (
          <View style={styles.pager} testID="admin-events-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.pageStepOff]}
              testID="admin-events-prev"
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.events.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.events.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(total, offset + rows.length)),
                total: num(total),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= total || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= total && styles.pageStepOff]}
              testID="admin-events-next"
            >
              <AppText style={styles.pageStepLabel}>{t('admin.events.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      <MppSheet
        visible={sheet === 'mpp'}
        selected={mpp?.code ?? null}
        onSelect={setMpp}
        onClose={() => setSheet(null)}
      />
      <BottomSheet
        visible={sheet === 'status'}
        title={t('admin.events.statusTitle')}
        sections={[
          {
            title: t('admin.events.statusTitle'),
            options: [
              { value: '', label: t('admin.events.statusAll') },
              ...STATUSES.map(s => ({ value: s, label: t(`admin.events.status.${s}`) })),
            ],
          },
        ]}
        selected={status ?? ''}
        onSelect={value => {
          const next = (value || null) as AIEventStatus | null;
          setStatus(next);
          // A chosen status is the more specific answer, so it releases the Unfinished chip.
          if (next) {
            setUnfinished(false);
          }
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
        testID="admin-events-status-sheet"
      />
      <DateRangeSheet
        visible={sheet === 'dates'}
        from={range?.from ?? null}
        to={range?.to ?? null}
        onClose={() => setSheet(null)}
        onApply={(from, to) => {
          setRange({ from, to });
          setSheet(null);
        }}
        onClear={() => {
          setRange(null);
          setSheet(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },

  top: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flexWrap: 'wrap' },
  count: { ...typography.h3, color: colors.ink, flex: 1 },
  export: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  exportBusy: { opacity: 0.8 },
  exportLabel: { ...typography.label, color: colors.surface },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  // Two stacked pairs, one column flush with each end of the search box and open space
  // between: every row is a pill at the left end and a pill at the right. The pills in a
  // column stretch to its widest, so each column reads as one edge; a column never takes more
  // than its half, and a long label truncates inside its pill.
  filters: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  filterGroup: { maxWidth: '47%', alignItems: 'stretch', gap: spacing[2] },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  filterLabel: { ...typography.label, color: colors.ink, flexShrink: 1 },
  filterCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  filterCountLabel: { ...typography.caption, fontSize: 11, color: colors.surface },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  clearLabel: { ...typography.label, color: colors.error },

  // The section head as a green card: solid chip, title, count bubble.
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[1],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
  },
  panelIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, color: colors.primaryDark },
  panelNote: { ...typography.caption, color: colors.ink },
  bubble: {
    minWidth: 24,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  bubbleLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  toggle: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: ink[50],
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 36,
    borderRadius: radius.sm,
  },
  toggleOn: { backgroundColor: colors.ink },
  toggleLabel: { ...typography.label, color: colors.ink },
  toggleLabelOn: { color: colors.surface },

  bulk: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  bulkCount: { ...typography.bodyStrong, color: colors.info },
  bulkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  bulkDelete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  bulkDeleteLabel: { ...typography.label, color: colors.error },
  bulkClear: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: ink[50],
  },
  bulkClearLabel: { ...typography.label, color: colors.ink },

  pickAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
  },
  pickAllLabel: { ...typography.label, color: colors.info, flex: 1 },
  check: { alignItems: 'center', justifyContent: 'center' },

  card: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  cardPicked: { borderColor: colors.info, borderWidth: 2 },
  cardPressed: { opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  // The verdict on a solid round disc, the pattern's ✓ / clock / ✕.
  verdict: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  codeLabel: { ...typography.label },
  idName: { ...typography.bodyStrong, color: colors.ink },
  idSub: { ...typography.caption, color: colors.textMuted },

  who: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  whoName: { ...typography.h3, color: colors.ink, flexShrink: 1 },
  // Green for a member of the dairy, yolk for somebody who is not — charged differently, and
  // the first thing a dispute about money asks.
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  kindMember: { backgroundColor: colors.primary },
  kindNonMember: { backgroundColor: yolk[400] },
  kindLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 7 },
  factRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  factIcon: { marginTop: 2 },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 64, marginTop: 1 },
  factBody: { flex: 1 },
  factValue: { ...typography.label, color: colors.ink },
  factSub: { ...typography.caption, color: colors.textMuted },

  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  openLabel: { ...typography.label },

  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },

  complete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: yolk[300],
    backgroundColor: colors.secondaryWash,
  },
  completePressed: { opacity: 0.8 },
  completeLabel: { ...typography.label, color: yolk[800] },

  tableWrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  th: { backgroundColor: colors.ink, borderBottomColor: colors.ink },
  thLabel: {
    ...typography.caption,
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
    textTransform: 'uppercase',
  },
  trPicked: { backgroundColor: colors.infoWash },
  td: { paddingHorizontal: spacing[2], paddingVertical: spacing[2], justifyContent: 'center' },
  tdCode: { ...typography.label, color: colors.info },
  tdText: { ...typography.caption, color: colors.ink },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  pageStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pageStepOff: { opacity: 0.4 },
  pageStepLabel: { ...typography.label, color: colors.info },
  pageOf: { ...typography.caption, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },

  sheetSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionOn: { backgroundColor: colors.infoWash },
  optionLabel: { ...typography.bodyStrong, color: colors.ink },

  // -- record ----------------------------------------------------------------------------
  // The portal's "All events" button: Ink, at the top, the way back to the list.
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },
  recordHero: {
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  // The record's number on a solid yolk pill, read at a glance — the zonal hero's tag.
  recordTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: yolk[400],
  },
  recordTagLabel: { ...typography.label, color: colors.ink },
  recordTitle: { ...typography.h2, color: colors.surface, marginTop: spacing[2] },

  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    marginTop: spacing[5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  deletePressed: { opacity: 0.85 },
  deleteLabel: { ...typography.bodyStrong, color: colors.error },
});
