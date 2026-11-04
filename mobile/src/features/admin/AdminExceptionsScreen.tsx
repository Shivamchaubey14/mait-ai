/**
 * Exceptions, for an admin — the portal's `exceptions.html` and its queue dialog on a handset.
 *
 * Everything that needs a human, in one place, so the morning triage is one screen rather than
 * five. Each card carries its queue's full count beside a bounded sample: the count says how bad
 * it is, the sample says where to start. Showing only the sample would let a queue of six
 * hundred look like a queue of five. The search runs across every card at once — triage starts
 * from a name or a number, and which queue it landed in is the thing being looked up.
 *
 * **Open** raises the queue itself in place, the way the portal's dialog does: every row, the
 * causes as filter chips (a payment waiting on a farmer and one waiting on a Mait are the same
 * status and two different phone calls), a window where the queue has one, and each row opening
 * to the guidance — who to ring — and its facts. Where a row leads somewhere, it goes there
 * without leaving the screen: the AI event, the Mait's stock, the Mait's pregnancy round.
 *
 * Colour is the app's rule, said out loud at the foot: red is blocked work, yellow is waiting.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { Banner, EmptyState } from '@/components';
import { SkeletonOverview, SkeletonRows } from '@/components/skeleton';
import Glyph, { STRAW_GLYPH, type GlyphName } from '@/components/glyph';
import { useAdminDashboardSummaryQuery, useAdminExceptionQueueQuery } from '@api/endpoints';
import type {
  DashboardExceptions,
  ExceptionGroup,
  ExceptionRow,
  QueueFact,
  QueueName,
  QueueRow,
  QueueTone,
} from '@api/types';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { EventRecord } from './AdminEventsScreen';
import { MaitStock } from './AdminInventoryScreen';
import { FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { phone, PregnancyRound } from './AdminPregnancyScreen';

/**
 * The six queues, in the portal's order, with the tone each card wears while it holds
 * something. Failed OTPs and low stock are red because both stop work: a Mait who cannot sign in
 * or has no straws records nothing. The rest are waiting work, so yellow.
 */
const QUEUES: {
  name: QueueName;
  key: keyof DashboardExceptions;
  tone: ToneName;
  icon: GlyphName;
}[] = [
  { name: 'pending-payments', key: 'pending_payments', tone: 'yolk', icon: 'cash' },
  { name: 'failed-otps', key: 'failed_otps', tone: 'red', icon: 'key' },
  { name: 'low-stock', key: 'low_stock', tone: 'red', icon: STRAW_GLYPH },
  { name: 'stale-indents', key: 'stale_indents', tone: 'yolk', icon: 'clipboard' },
  { name: 'overdue-checks', key: 'overdue_checks', tone: 'yolk', icon: 'time' },
  { name: 'declined-checks', key: 'declined_checks', tone: 'yolk', icon: 'hand-left' },
];

/**
 * Which queues are windowed, and the choices offered. The response says which one it opened on,
 * so the screen shows the number somebody just read on the card. Failed OTPs stops at thirty
 * days because the server does: offering ninety would show thirty under a label saying ninety.
 */
const WINDOWS: Partial<Record<QueueName, number[]>> = {
  'failed-otps': [1, 7, 30],
  'declined-checks': [30, 90, 365],
};

/** The server's tone words, in the app's palette. Neutral is grey, never white. */
export function toneOf(tone: QueueTone | undefined): ToneName {
  switch (tone) {
    case 'bad':
      return 'red';
    case 'warn':
      return 'yolk';
    case 'good':
      return 'green';
    case 'info':
      return 'blue';
    default:
      return 'slate';
  }
}

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

/** "02 Sep 2026, 14:04" — the API sends instants and every screen shows them this way. */
function dayTime(t: TFunction, iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${at.getDate()} ${months[at.getMonth()] ?? ''} ${at.getFullYear()}, ${hh}:${mm}`;
}

/** "2026-10-13" as "13 Oct 2026"; anything else as it came. */
function factDate(t: TFunction, value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return dayTime(t, value);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const months = t('calendar.months', { returnObjects: true }) as string[];
    const [y, m, d] = value.split('-').map(Number);
    return `${d} ${months[(m ?? 1) - 1] ?? ''} ${y}`;
  }
  return value;
}

/** A fact's label and the fixed words among its values, in the reader's language. */
const FACT_KEYS: Record<string, string> = {
  Waiting: 'waiting',
  Mait: 'mait',
  'Mait code': 'maitCode',
  'Farmer authorised': 'farmerAuthorised',
  'Cash confirmed': 'cashConfirmed',
  UTR: 'utr',
  Screenshot: 'screenshot',
  'Straws held': 'strawsHeld',
  Threshold: 'threshold',
  'Asked for': 'askedFor',
  Requested: 'requested',
  'Stale after': 'staleAfter',
  Status: 'status',
  Store: 'store',
  Note: 'note',
  'Overdue checks': 'overdueChecks',
  'Oldest due': 'oldestDue',
  'Days behind': 'daysBehind',
  Refused: 'refused',
  Window: 'window',
  'MPP code': 'mppCode',
  'Re-booked': 'rebooked',
  Number: 'number',
  Sent: 'sent',
  Expired: 'expired',
  'Valid for': 'validFor',
  Attempts: 'attempts',
  'Sent via': 'sentVia',
  'Gateway reference': 'gateway',
};
const VALUE_KEYS: Record<string, string> = {
  Yes: 'yes',
  No: 'no',
  'Not applicable': 'notApplicable',
  'On file': 'onFile',
  'No — a refusal closes the check': 'rebookedNo',
};

/** Where a portal link is worked on the handset. */
export type Destination =
  | { kind: 'event'; id: number }
  | { kind: 'stock'; maitId: number }
  | { kind: 'round'; maitId: number }
  | { kind: 'section'; section: string };

/**
 * A portal href, as somewhere on this app. A record with an id opens over the queue; a whole
 * screen (Indents, Pregnancy) opens its section. Null where the handset has nowhere to send it.
 */
export function destinationOf(href: string): Destination | null {
  const match = href.match(/^([a-z-]+)\.html(?:\?(.*))?$/);
  if (!match) {
    return null;
  }
  const page = match[1] ?? '';
  const query = new URLSearchParams(match[2] ?? '');
  const id = Number(query.get('id'));
  const mait = Number(query.get('mait'));
  if (page === 'ai-event' && id) {
    return { kind: 'event', id };
  }
  if (page === 'inventory' && mait) {
    return { kind: 'stock', maitId: mait };
  }
  if (page === 'pregnancy' && mait) {
    return { kind: 'round', maitId: mait };
  }
  return { kind: 'section', section: page };
}

function IconDisc({ tone, icon, size = 34 }: { tone: ToneName; icon: GlyphName; size?: number }) {
  const look = TONE[tone];
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: look.solid },
      ]}
    >
      <Glyph name={icon} size={size * 0.5} color={look.onSolid} />
    </View>
  );
}

/** Searched on the sample already fetched: each card ships a few rows, not the whole queue. */
function matching(rows: ExceptionRow[], needle: string): ExceptionRow[] {
  if (!needle) {
    return rows;
  }
  return rows.filter(
    row =>
      String(row.label ?? '')
        .toLowerCase()
        .includes(needle) ||
      String(row.meta ?? '')
        .toLowerCase()
        .includes(needle),
  );
}

function QueueCard({
  name,
  group,
  tone,
  icon,
  needle,
  onOpen,
}: {
  name: QueueName;
  group: ExceptionGroup;
  tone: ToneName;
  icon: GlyphName;
  needle: string;
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const all = group.rows ?? [];
  const rows = matching(all, needle);
  const count = group.count ?? 0;
  const clear = count === 0;
  const lit: ToneName = clear ? 'green' : tone;
  const look = TONE[lit];
  // Only meaningful against the whole queue: while searching it would count rows never shown.
  const more = needle ? 0 : typeof group.more === 'number' ? group.more : count - all.length;

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-exceptions-${name}`}
    >
      <View style={styles.cardTop}>
        <IconDisc tone={lit} icon={clear ? 'checkmark' : icon} />
        <AppText style={[styles.cardTitle, { color: look.text }]}>
          {t(`admin.exceptions.q_${name}`)}
        </AppText>
        <View
          style={[styles.count, { backgroundColor: look.solid }]}
          testID={`admin-exceptions-count-${name}`}
        >
          <AppText style={[styles.countLabel, { color: look.onSolid }]}>
            {needle
              ? t('admin.exceptions.nOf', { n: num(rows.length), total: num(count) })
              : num(count)}
          </AppText>
        </View>
      </View>

      {rows.length === 0 ? (
        // Named rather than blank: an empty queue is good news and should read as good news.
        <AppText style={styles.clear}>
          {t(needle && all.length ? 'admin.exceptions.noMatch' : 'admin.exceptions.nothingWaiting')}
        </AppText>
      ) : (
        <View style={styles.inset}>
          {rows.map((row, i) => {
            const blocked = row.severity === 'error';
            return (
              <View key={`${row.label}-${i}`} style={[styles.sample, i > 0 && styles.rule]}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: blocked ? TONE.red.solid : TONE.yolk.solid },
                  ]}
                />
                <View style={styles.flex}>
                  <AppText style={styles.sampleLabel}>{row.label}</AppText>
                  <AppText style={[styles.sub, blocked && { color: TONE.red.text }]}>
                    {row.meta}
                  </AppText>
                </View>
              </View>
            );
          })}
          {more > 0 && (
            <AppText style={[styles.sub, styles.more]} testID={`admin-exceptions-more-${name}`}>
              {t('admin.exceptions.moreN', { n: num(more) })}
            </AppText>
          )}
        </View>
      )}

      {/* Follows the queue's own count, not the search: a term matching none of the sampled
          rows does not mean the queue behind the card is empty. */}
      {!clear && (
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          style={({ pressed }) => [
            styles.open,
            { backgroundColor: TONE[tone].solid },
            pressed && styles.pressed,
          ]}
          testID={`admin-exceptions-open-${name}`}
        >
          <AppText style={[styles.openLabel, { color: TONE[tone].onSolid }]}>
            {t('admin.exceptions.open')}
          </AppText>
          <Ionicons name="arrow-forward" size={16} color={TONE[tone].onSolid} />
        </Pressable>
      )}
    </View>
  );
}

function FactLine({ fact, testID }: { fact: QueueFact; testID?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const missing = fact.value === '' || fact.value === null || fact.value === undefined;
  const labelKey = FACT_KEYS[fact.label];
  const valueKey = VALUE_KEYS[fact.value];
  return (
    <View style={styles.fact} testID={testID}>
      <AppText style={styles.factLabel}>
        {labelKey ? t(`admin.exceptions.f_${labelKey}`) : fact.label}
      </AppText>
      <AppText style={[styles.factValue, missing && styles.factMissing]}>
        {missing
          ? t('admin.exceptions.notRecorded')
          : valueKey
            ? t(`admin.exceptions.v_${valueKey}`)
            : factDate(t, fact.value)}
      </AppText>
    </View>
  );
}

function linkLabel(t: TFunction, href: string, fallback: string): string {
  const where = destinationOf(href);
  if (!where) {
    return fallback;
  }
  if (where.kind === 'event') {
    // The OTP queue adds the amount and mode after the event's number; keep that tail.
    const tail = fallback.split(' · ').slice(1).join(' · ');
    return t('admin.exceptions.toEvent', { id: where.id }) + (tail ? ` · ${tail}` : '');
  }
  if (where.kind === 'stock') {
    return t('admin.exceptions.toStock');
  }
  if (where.kind === 'round') {
    return t('admin.exceptions.toRound');
  }
  return t(`admin.exceptions.toSection_${where.section}`, { defaultValue: fallback });
}

function Entry({
  queue,
  row,
  open,
  onToggle,
  onGo,
}: {
  queue: QueueName;
  row: QueueRow;
  open: boolean;
  onToggle: () => void;
  onGo: (where: Destination, row: QueueRow) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOf(row.state?.tone);
  const look = TONE[tone];
  const id = String(row.id);
  // The figures a translated sentence carries: a threshold, or how many days behind.
  const figure =
    row.facts?.find(f => f.label === 'Days behind' || f.label === 'Threshold')?.value ?? '';
  const guidance = row.bucket
    ? t(`admin.exceptions.g_${queue}_${row.bucket}`, { defaultValue: row.guidance, n: figure })
    : row.guidance;
  const where = row.link ? destinationOf(row.link.href) : null;
  const ring = queue === 'failed-otps' ? row.mobile_no : undefined;

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-queue-row-${id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.entryHead, pressed && styles.pressed]}
        testID={`admin-queue-toggle-${id}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.flex}>
            <AppText style={styles.entryTitle}>{row.title}</AppText>
            {!!row.subtitle && <AppText style={styles.sub}>{row.subtitle}</AppText>}
          </View>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </View>
        {!!row.detail && <AppText style={styles.entryDetail}>{row.detail}</AppText>}
        <View style={styles.entryMeta}>
          {!!row.state?.label && (
            <View testID={`admin-queue-state-${id}`}>
              <Pill
                label={
                  row.bucket
                    ? t(`admin.exceptions.b_${queue}_${row.bucket}`, {
                        defaultValue: row.state.label,
                        n: figure,
                      })
                    : row.state.label
                }
                tone={tone}
              />
            </View>
          )}
          {!!row.metric && (
            <AppText
              style={[styles.metric, { color: look.text }]}
              testID={`admin-queue-metric-${id}`}
            >
              {row.metric}
            </AppText>
          )}
          {!!row.when && <AppText style={styles.sub}>{dayTime(t, row.when)}</AppText>}
        </View>
      </Pressable>

      {open && (
        <>
          {/* The reason this exists: the cause decides who gets rung. */}
          <View
            style={[styles.advice, { borderColor: look.border }]}
            testID={`admin-queue-guidance-${id}`}
          >
            <Ionicons name="bulb" size={16} color={look.text} />
            <AppText style={styles.adviceText}>{guidance}</AppText>
          </View>

          <View style={styles.inset}>
            {(row.facts ?? []).map((fact, i) => (
              <FactLine
                key={`${fact.label}-${i}`}
                fact={fact}
                testID={`admin-queue-fact-${id}-${i}`}
              />
            ))}
          </View>

          <View style={styles.actions}>
            {!!ring && (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  Linking.openURL(`tel:${String(ring).replace(/\s/g, '')}`).catch(() => undefined)
                }
                style={({ pressed }) => [
                  styles.action,
                  styles.actionCall,
                  pressed && styles.pressed,
                ]}
                testID={`admin-queue-call-${id}`}
              >
                <Ionicons name="call" size={15} color={TONE.green.onSolid} />
                <AppText style={[styles.actionLabel, { color: TONE.green.onSolid }]}>
                  {phone(ring)}
                </AppText>
              </Pressable>
            )}
            {!!row.link && !!where && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onGo(where, row)}
                style={({ pressed }) => [styles.action, styles.actionGo, pressed && styles.pressed]}
                testID={`admin-queue-go-${id}`}
              >
                <AppText style={[styles.actionLabel, { color: colors.surface }]}>
                  {linkLabel(t, row.link.href, row.link.label)}
                </AppText>
                <Ionicons name="arrow-forward" size={15} color={colors.surface} />
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function windowLabel(t: TFunction, days: number): string {
  if (days === 1) {
    return t('admin.exceptions.today');
  }
  if (days === 365) {
    return t('admin.exceptions.lastYear');
  }
  return t('admin.exceptions.lastDays', { n: days });
}

/** One queue, opened in place: every row, its causes, and what to do about each. */
function Queue({
  name,
  onBack,
  onGo,
}: {
  name: QueueName;
  onBack: () => void;
  onGo: (where: Destination, row: QueueRow) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  // Always opens unfiltered and on the queue's own window, so the number read on the card is
  // the number of rows here.
  const [filter, setFilter] = useState('');
  const [days, setDays] = useState<number | undefined>(undefined);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const queue = useAdminExceptionQueueQuery({ queue: name, filter, days });
  const data = queue.data;
  const rows = data?.results ?? [];
  const lit = QUEUES.find(q => q.name === name);
  const choices = WINDOWS[name];

  // Only the causes actually present: a chip that answers empty reads as broken.
  const buckets = (data?.buckets ?? []).filter(b => b.count > 0 || b.key === filter);
  const everything = (data?.buckets ?? []).reduce((sum, b) => sum + b.count, 0);

  const tally = data
    ? [
        t('admin.exceptions.inQueue', { n: num(data.count) }),
        ...(typeof data.people === 'number' && !filter
          ? [t('admin.exceptions.people', { count: data.people })]
          : []),
        ...(filter ? [t('admin.exceptions.shown', { n: num(rows.length) })] : []),
        ...(data.truncated ? [t('admin.exceptions.capped', { n: num(data.shown) })] : []),
      ].join(' · ')
    : '';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={queue.isFetching && !queue.isLoading}
            onRefresh={() => queue.refetch()}
          />
        }
        testID="admin-queue"
      >
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          hitSlop={8}
          style={styles.back}
          testID="admin-queue-back"
        >
          <Ionicons name="arrow-back" size={18} color={colors.ink} />
          <AppText style={styles.backLabel}>{t('admin.exceptions.backToAll')}</AppText>
        </Pressable>

        <View
          style={[
            styles.banner,
            {
              backgroundColor: TONE[lit?.tone ?? 'slate'].wash,
              borderColor: TONE[lit?.tone ?? 'slate'].border,
            },
          ]}
        >
          <View style={styles.cardTop}>
            <IconDisc tone={lit?.tone ?? 'slate'} icon={lit?.icon ?? 'alert-circle'} size={40} />
            <View style={styles.flex}>
              <AppText style={styles.bannerTitle} testID="admin-queue-title">
                {t(`admin.exceptions.q_${name}`)}
              </AppText>
              <AppText style={styles.sub}>{t(`admin.exceptions.s_${name}`)}</AppText>
            </View>
          </View>
          {!!tally && (
            <AppText
              style={[styles.tally, { color: TONE[lit?.tone ?? 'slate'].text }]}
              testID="admin-queue-tally"
            >
              {tally}
            </AppText>
          )}
        </View>

        {!!choices && (data?.windowed ?? true) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {choices.map(d => (
              <FilterChip
                key={d}
                label={windowLabel(t, d)}
                icon="calendar-outline"
                tone="blue"
                active={(days ?? data?.window_days) === d}
                onPress={() => {
                  setDays(d);
                  setOpenRow(null);
                }}
                testID={`admin-queue-window-${d}`}
              />
            ))}
          </ScrollView>
        )}

        {buckets.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <FilterChip
              label={t('admin.exceptions.all', { n: num(everything) })}
              icon="layers-outline"
              tone="slate"
              active={!filter}
              onPress={() => {
                setFilter('');
                setOpenRow(null);
              }}
              testID="admin-queue-filter-all"
            />
            {buckets.map(b => (
              <FilterChip
                key={b.key}
                label={`${t(`admin.exceptions.b_${name}_${b.key}`, { defaultValue: b.label })} ${num(b.count)}`}
                icon="funnel-outline"
                tone={toneOf(b.tone)}
                active={filter === b.key}
                onPress={() => {
                  setFilter(b.key);
                  setOpenRow(null);
                }}
                testID={`admin-queue-filter-${b.key}`}
              />
            ))}
          </ScrollView>
        )}

        {queue.isLoading || (queue.isFetching && !data) ? (
          <SkeletonRows />
        ) : queue.isError ? (
          <Banner
            tone="error"
            message={
              (queue.error as { data?: { detail?: string } })?.data?.detail ??
              t('admin.exceptions.queueError')
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            message={t(filter ? 'admin.exceptions.queueNoMatch' : 'admin.exceptions.queueEmpty')}
          />
        ) : (
          rows.map(row => (
            <Entry
              key={String(row.id)}
              queue={name}
              row={row}
              // One at a time: two open panels is two answers to a question about one row.
              open={openRow === String(row.id)}
              onToggle={() => setOpenRow(o => (o === String(row.id) ? null : String(row.id)))}
              onGo={onGo}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** What is open over the list, innermost last, so Back peels one layer at a time. */
type Layer =
  | { kind: 'queue'; name: QueueName }
  | { kind: 'event'; id: number }
  | { kind: 'stock'; maitId: number; threshold: number }
  | { kind: 'round'; maitId: number; name: string; code: string };

export default function AdminExceptionsScreen({
  onOpenSection,
}: {
  /** Opens another admin section, for a row that is worked on a whole screen. */
  onOpenSection?: (section: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const data = useAdminDashboardSummaryQuery();
  const exceptions = data.data?.exceptions;
  const [term, setTerm] = useState('');
  const [layers, setLayers] = useState<Layer[]>([]);
  const needle = term.trim().toLowerCase();

  const push = (layer: Layer) => setLayers(stack => [...stack, layer]);
  const pop = () => setLayers(stack => stack.slice(0, -1));

  useEffect(() => {
    if (!layers.length) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [layers.length]);

  const total = useMemo(
    () => QUEUES.reduce((sum, q) => sum + (exceptions?.[q.key]?.count ?? 0), 0),
    [exceptions],
  );

  const go = (where: Destination, row: QueueRow) => {
    if (where.kind === 'event') {
      push({ kind: 'event', id: where.id });
    } else if (where.kind === 'stock') {
      const threshold = Number(row.facts.find(f => f.label === 'Threshold')?.value) || 10;
      push({ kind: 'stock', maitId: where.maitId, threshold });
    } else if (where.kind === 'round') {
      push({ kind: 'round', maitId: where.maitId, name: row.title, code: row.subtitle });
    } else {
      onOpenSection?.(where.section);
    }
  };

  const top = layers[layers.length - 1];
  if (top?.kind === 'event') {
    return <EventRecord eventId={top.id} canDelete={false} onBack={pop} onDeleted={pop} />;
  }
  if (top?.kind === 'stock') {
    return <MaitStock id={top.maitId} threshold={top.threshold} onBack={pop} />;
  }
  if (top?.kind === 'round') {
    return (
      <PregnancyRound
        maitId={top.maitId}
        name={top.name}
        code={top.code}
        onBack={pop}
        onEvent={id => push({ kind: 'event', id })}
      />
    );
  }
  if (top?.kind === 'queue') {
    return <Queue name={top.name} onBack={pop} onGo={go} />;
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={data.isFetching && !data.isLoading}
            onRefresh={() => data.refetch()}
          />
        }
        testID="admin-exceptions"
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.exceptions.title')}</AppText>
            <AppText style={styles.sub}>{t('admin.exceptions.subtitle')}</AppText>
          </View>
          {!!exceptions && (
            <View testID="admin-exceptions-total">
              <Pill
                label={
                  total
                    ? t('admin.exceptions.waitingN', { n: num(total) })
                    : t('admin.exceptions.allClear')
                }
                tone={total ? 'yolk' : 'green'}
              />
            </View>
          )}
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.exceptions.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            autoCapitalize="none"
            testID="admin-exceptions-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {data.isLoading ? (
          <SkeletonOverview />
        ) : data.isError || !exceptions ? (
          <EmptyState message={t('admin.exceptions.error')} />
        ) : (
          QUEUES.map(({ name, key, tone, icon }) => {
            const group = exceptions[key];
            if (!group) {
              return null;
            }
            return (
              <QueueCard
                key={name}
                name={name}
                group={group}
                tone={tone}
                icon={icon}
                needle={needle}
                onOpen={() => push({ kind: 'queue', name })}
              />
            );
          })
        )}

        <Notice
          tone="slate"
          icon="color-palette"
          title={t('admin.exceptions.noticeTitle')}
          body={t('admin.exceptions.noticeBody')}
          testID="admin-exceptions-notice"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  sub: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  disc: { alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  title: { ...typography.h3, color: colors.ink },
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

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardTitle: { ...typography.bodyStrong, flex: 1 },
  count: {
    minWidth: 32,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLabel: { ...typography.label },
  clear: { ...typography.caption, color: colors.primaryDark },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  sample: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sampleLabel: { ...typography.label, color: colors.ink },
  more: { paddingVertical: 6, paddingLeft: spacing[4] },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
  },
  openLabel: { ...typography.label },

  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH_TARGET },
  backLabel: { ...typography.label, color: colors.ink },
  banner: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  bannerTitle: { ...typography.bodyStrong, color: colors.ink },
  tally: { ...typography.caption, fontFamily: typography.label.fontFamily },
  chips: { gap: spacing[2], paddingRight: spacing[4] },

  entryHead: { gap: 6 },
  entryTitle: { ...typography.bodyStrong, color: colors.ink },
  entryDetail: { ...typography.body, color: colors.ink },
  entryMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  metric: { ...typography.label },
  advice: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  adviceText: { ...typography.body, color: colors.ink, flex: 1 },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: 6,
  },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  factMissing: { color: colors.textMuted, fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  action: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
  },
  actionCall: { backgroundColor: TONE.green.solid },
  actionGo: { backgroundColor: colors.ink },
  actionLabel: { ...typography.label },
});
