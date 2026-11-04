/**
 * Indents, for an admin — the portal's Indents screen (`indents.html`) on a handset.
 *
 * Two jobs. Watching: surface the failure nothing else will — a request approved a week ago and
 * never issued, or one nobody has even looked at. Either way a Mait is out of straws and waiting
 * on stock nobody is bringing, so a stale indent is red, and *Stale first* narrows to them.
 *
 * And fulfilling. Approve, reject and issue are how an indent moves. The review screen says what
 * each will actually do, because they do very different things: approving records that the
 * office agrees and moves nothing; issuing sets stock aside against a Mait's name, and it becomes
 * theirs when they confirm they collected it. Straw numbers are optional — the ones that matter
 * are read off the straws at the AI step — and are for a depot slip that already lists them.
 *
 * **Where a store serves the Mait, this screen approves and the store issues.** An indent routed
 * to a store has no Issue here — it says which depot has it — and the office's own Issue is kept
 * for Maits no store serves yet. A rejection always carries a reason: the Mait reads only that.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminIssueIndentMutation,
  useAdminListIndentsQuery,
  useApproveIndentMutation,
  useRejectIndentMutation,
} from '@api/endpoints';
import type { Indent } from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { useDebounced } from './common';

const LIMIT = 25;
/** Mirrors STALE_AFTER_DAYS in apps/indents/models.py. */
export const STALE_AFTER_DAYS = 3;

type Status = '' | 'requested' | 'approved' | 'issued' | 'rejected';
const STATUSES: Status[] = ['', 'requested', 'approved', 'issued', 'rejected'];
const STATUS_TONE: Record<Exclude<Status, ''>, ToneName> = {
  requested: 'yolk',
  approved: 'blue',
  issued: 'green',
  rejected: 'red',
};

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

/** Whole local days since `iso`: today is 0, whatever the hour. */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

function dateOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function ageOf(t: TFunction, iso: string): string {
  const days = daysAgo(iso);
  return days === 0 ? t('admin.indents.today') : t('admin.indents.daysAgo', { n: days });
}

/**
 * The same rule as `stale_indent_q` in the API, which `stale=true` filters on — so the screen
 * that fetched the stale ones also marks them stale.
 */
export function isStale(indent: Indent): boolean {
  if (indent.status === 'issued' || indent.status === 'rejected') {
    return false;
  }
  return daysAgo(indent.requested_at) >= STALE_AFTER_DAYS;
}

/**
 * The status, carrying the half of "issued" the field does not: set aside at the depot is not
 * in the Mait's hands, and only collecting puts it in their balance.
 */
function statusOf(t: TFunction, indent: Indent): { label: string; tone: ToneName } {
  if (isStale(indent)) {
    return { label: t('admin.indents.stale'), tone: 'red' };
  }
  if (indent.status === 'issued') {
    return indent.received_at
      ? { label: t('admin.indents.collected'), tone: 'green' }
      : { label: t('admin.indents.awaitingCollection'), tone: 'yolk' };
  }
  if (indent.status === 'approved' && indent.qty_issued > 0) {
    return {
      label: t('admin.indents.partIssued', {
        issued: indent.qty_issued,
        requested: indent.qty_requested,
      }),
      tone: 'yolk',
    };
  }
  return {
    label: indent.status_display || t(`admin.indents.status_${indent.status}`),
    tone: STATUS_TONE[indent.status] ?? 'slate',
  };
}

/** Where it is handed over — said only while there is still something to issue. */
function depotLine(t: TFunction, indent: Indent): string {
  const parts: string[] = [];
  if (indent.qty_issued) {
    parts.push(t('admin.indents.nIssued', { n: indent.qty_issued }));
  }
  if (indent.qty_to_collect) {
    parts.push(t('admin.indents.atCounter', { n: indent.qty_to_collect }));
  }
  if (indent.store_name) {
    parts.push(indent.store_name);
  } else if (indent.status === 'requested' || indent.status === 'approved') {
    parts.push(t('admin.indents.noStore'));
  }
  return parts.join(' · ');
}

function isStraw(indent: Indent): boolean {
  return indent.product_type ? indent.product_type === 'straw' : !!indent.breed;
}

/**
 * Split whatever was pasted into straw numbers — lines, comma lists, one long run. Retyping a
 * paste into the one shape a form wanted is how transcription errors are made.
 */
export function parseStrawNumbers(text: string): string[] {
  return (text || '')
    .split(/[\s,;]+/)
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
}

type Action = 'review' | 'issue' | 'withStore' | null;

/** Only the two open states have anything an admin can do to them. */
function actionOf(indent: Indent): Action {
  if (indent.status === 'requested') {
    return 'review';
  }
  if (indent.status === 'approved' && indent.store_name) {
    // The store's keeper issues it. Once part has gone there is nothing left for the office.
    return indent.qty_issued ? 'withStore' : 'review';
  }
  if (indent.status === 'approved') {
    return 'issue';
  }
  return null;
}

// --------------------------------------------------------------------------------------
// Reviewing one indent
// --------------------------------------------------------------------------------------

function Fact({
  tone,
  label,
  value,
  meta,
  testID,
}: {
  tone: ToneName;
  label: string;
  value: string;
  meta: string;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.fact, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <AppText style={[styles.factLabel, { color: look.text }]}>{label}</AppText>
      <AppText style={styles.factValue} numberOfLines={2}>
        {value}
      </AppText>
      <AppText style={styles.factMeta}>{meta}</AppText>
    </View>
  );
}

function Review({
  indent,
  onBack,
  onDone,
}: {
  indent: Indent;
  onBack: () => void;
  onDone: (text: string, tone: ToneName) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [approve, approveState] = useApproveIndentMutation();
  const [reject, rejectState] = useRejectIndentMutation();
  const [issue, issueState] = useAdminIssueIndentMutation();
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const qtyRef = useRef<View>(null);
  const strawsRef = useRef<View>(null);
  const reasonRef = useRef<View>(null);

  const straw = isStraw(indent);
  const requested = indent.status === 'requested';
  const atStore = !!indent.store_name;
  const canIssue = !requested && !atStore;
  const status = statusOf(t, indent);

  const [qty, setQty] = useState(String(indent.qty_requested));
  const [straws, setStraws] = useState('');
  const [reason, setReason] = useState('');
  const [hintOverride, setHintOverride] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = approveState.isLoading || rejectState.isLoading || issueState.isLoading;

  const numbers = parseStrawNumbers(straws);
  const duplicates = numbers.length !== new Set(numbers).size;
  const tooMany = numbers.length > indent.qty_requested;

  // What the buttons will actually do, said before any is pressed.
  const effect = requested
    ? `${t('admin.indents.effectApprove')}${
        atStore
          ? t('admin.indents.effectQueue', { store: indent.store_name })
          : t('admin.indents.effectNoStore')
      } ${t('admin.indents.effectReject')}`
    : atStore
      ? t('admin.indents.effectStore', { store: indent.store_name, name: indent.mait_name ?? '' })
      : t('admin.indents.effectIssue', { name: indent.mait_name ?? '' });

  const hint =
    hintOverride ??
    (requested
      ? atStore
        ? t('admin.indents.hintApproveStore', { store: indent.store_name })
        : t('admin.indents.hintApprove')
      : atStore
        ? t('admin.indents.hintOnlyReject')
        : !straw
          ? t('admin.indents.hintCredits', { name: indent.mait_name ?? '' })
          : numbers.length
            ? t('admin.indents.hintIssuingListed', { n: numbers.length })
            : t('admin.indents.hintIssueQty'));

  const failed = (error: unknown) => {
    // The server owns every rule that matters here; show what it said.
    const data = (error as { data?: Record<string, unknown> })?.data;
    const said =
      (typeof data?.detail === 'string' && data.detail) ||
      Object.values(data ?? {})
        .flat()
        .filter((v): v is string => typeof v === 'string')
        .join(' · ');
    setProblem(said || t('admin.indents.failedBody'));
  };

  const doApprove = async () => {
    setProblem(null);
    try {
      const approved = (await approve(indent.id).unwrap()) as Indent | undefined;
      const store = approved?.store_name || indent.store_name;
      onDone(
        `${t('admin.indents.approvedFlash', { id: indent.id })} ${
          store
            ? t('admin.indents.approvedQueue', { store })
            : t('admin.indents.approvedIssueLater')
        }`,
        'green',
      );
    } catch (error) {
      failed(error);
    }
  };

  const doReject = async () => {
    const why = reason.trim();
    if (!why) {
      // Not enforced by the API, asked for here: "rejected" with no explanation is a phone
      // call to the office from a Mait who cannot work.
      setHintOverride(t('admin.indents.giveReason'));
      api.reveal(reasonRef.current);
      return;
    }
    setProblem(null);
    try {
      await reject({ id: indent.id, reason: why }).unwrap();
      onDone(t('admin.indents.rejectedFlash', { id: indent.id }), 'yolk');
    } catch (error) {
      failed(error);
    }
  };

  const doIssue = () => {
    const count = numbers.length || Number(qty);
    if (!count || count < 1 || duplicates) {
      setHintOverride(t('admin.indents.qtyAtLeastOne'));
      return;
    }
    Alert.alert(
      t('admin.indents.issueTitle', { n: count, name: indent.mait_name ?? '' }),
      t('admin.indents.issueBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.indents.issueStock'),
          onPress: async () => {
            setProblem(null);
            try {
              const issued = await issue(
                numbers.length
                  ? { id: indent.id, straw_numbers: numbers }
                  : { id: indent.id, qty: count },
              ).unwrap();
              onDone(
                t('admin.indents.issuedFlash', {
                  id: indent.id,
                  n: issued?.qty_issued ?? count,
                  name: indent.mait_name ?? '',
                }),
                'green',
              );
            } catch (error) {
              failed(error);
            }
          },
        },
      ],
    );
  };

  const markTone: ToneName = requested ? 'yolk' : 'blue';
  const handovers = indent.handovers ?? [];

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      testID="admin-indent-review"
    >
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        testID="admin-indent-back"
      >
        <Ionicons name="arrow-back" size={16} color={colors.surface} />
        <AppText style={styles.backLabel}>{t('admin.indents.allIndents')}</AppText>
      </Pressable>

      <View style={styles.hero}>
        <View style={[styles.heroMark, { backgroundColor: TONE[markTone].solid }]}>
          <Ionicons
            name={requested ? 'help' : 'arrow-up'}
            size={20}
            color={TONE[markTone].onSolid}
          />
        </View>
        <View style={styles.flex}>
          <AppText style={styles.heroTitle}>{`IND-${indent.id}`}</AppText>
          <AppText style={styles.heroMeta}>
            {[indent.mait_name, indent.mait_code].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <Pill label={status.label} tone={status.tone} />
      </View>

      {/* The three facts the decision is about, so nobody holds them in their head. */}
      <View style={styles.facts}>
        <Fact
          tone="yolk"
          label={t('admin.indents.factRequested')}
          value={num(indent.qty_requested)}
          meta={t(straw ? 'admin.indents.straws' : 'admin.indents.units')}
          testID="admin-indent-fact-qty"
        />
        <Fact
          tone="blue"
          label={t('admin.indents.factItem')}
          value={indent.breed || indent.item}
          meta={`${t(straw ? 'admin.indents.kindStraw' : 'admin.indents.kindConsumable')} · ${
            atStore ? indent.store_name : t('admin.indents.noStoreShort')
          }`}
          testID="admin-indent-fact-item"
        />
      </View>
      <Fact
        tone="slate"
        label={t('admin.indents.factRaised')}
        value={dateOf(t, indent.requested_at)}
        meta={ageOf(t, indent.requested_at)}
        testID="admin-indent-fact-raised"
      />

      {!!indent.note && (
        <Notice
          tone="slate"
          icon="chatbubble-ellipses"
          title={t('admin.indents.note')}
          body={indent.note}
          testID="admin-indent-note"
        />
      )}

      {(!!indent.approved_by_name || handovers.length > 0) && (
        <View
          style={[
            styles.panel,
            { backgroundColor: TONE.slate.wash, borderColor: TONE.slate.border },
          ]}
          testID="admin-indent-trail"
        >
          <AppText style={[styles.panelTitle, { color: TONE.slate.text }]}>
            {t('admin.indents.trail')}
          </AppText>
          <View style={styles.inset}>
            {!!indent.approved_by_name && (
              <View style={styles.trailRow}>
                <View style={[styles.dot, { backgroundColor: colors.info }]} />
                <AppText style={styles.trailText}>
                  {t('admin.indents.approvedBy', {
                    name: indent.approved_by_name,
                    date: dateOf(t, indent.approved_at),
                  })}
                  {indent.approved_by_zone ? ` · ${indent.approved_by_zone}` : ''}
                </AppText>
              </View>
            )}
            {handovers.map(handover => (
              <View key={handover.id} style={[styles.trailRow, styles.rule]}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        handover.state === 'collected'
                          ? colors.primary
                          : handover.state === 'cancelled'
                            ? colors.error
                            : yolk[400],
                    },
                  ]}
                />
                <AppText style={styles.trailText}>
                  {t(`admin.indents.handover_${handover.state}`, {
                    n: handover.qty,
                    store: handover.store_name,
                    date: dateOf(t, handover.collected_at || handover.issued_at),
                  })}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      <View
        style={[
          styles.effect,
          requested
            ? { backgroundColor: TONE.yolk.wash, borderColor: TONE.yolk.border }
            : { backgroundColor: TONE.blue.wash, borderColor: TONE.blue.border },
        ]}
        testID="admin-indent-effect"
      >
        <Ionicons
          name="information-circle"
          size={18}
          color={requested ? TONE.yolk.text : TONE.blue.text}
        />
        <AppText style={styles.effectText}>{effect}</AppText>
      </View>

      {canIssue && (
        <View ref={qtyRef} collapsable={false} style={styles.field}>
          <View style={styles.fieldHead}>
            <View style={styles.fieldIcon}>
              <Ionicons name="cube-outline" size={13} color={colors.info} />
            </View>
            <AppText style={styles.fieldLabel}>{t('admin.indents.howMany')}</AppText>
          </View>
          <TextInput
            style={[styles.input, numbers.length > 0 && styles.inputLocked]}
            value={numbers.length ? String(numbers.length) : qty}
            onChangeText={text => {
              setHintOverride(null);
              setQty(text.replace(/[^\d]/g, ''));
            }}
            onFocus={() => api.reveal(qtyRef.current)}
            editable={numbers.length === 0}
            keyboardType="number-pad"
            maxLength={6}
            testID="admin-indent-qty"
          />
          <AppText style={styles.hint}>
            {t('admin.indents.qtyHint', { n: indent.qty_requested })}
          </AppText>
        </View>
      )}

      {canIssue && straw && (
        <View ref={strawsRef} collapsable={false} style={styles.field}>
          <View style={styles.fieldHead}>
            <View style={styles.fieldIcon}>
              <Glyph name={STRAW_GLYPH} size={13} color={colors.info} />
            </View>
            <AppText style={[styles.fieldLabel, styles.flex]}>
              {t('admin.indents.strawNumbers')}
            </AppText>
            <AppText style={styles.count} testID="admin-indent-straw-count">
              {numbers.length
                ? t('admin.indents.listed', { n: numbers.length })
                : t('admin.indents.optional')}
            </AppText>
          </View>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={straws}
            onChangeText={text => {
              setHintOverride(null);
              setStraws(text);
            }}
            onFocus={() => api.reveal(strawsRef.current)}
            multiline
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={t('admin.indents.strawPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            testID="admin-indent-straws"
          />
          <AppText
            style={[
              styles.hint,
              (duplicates || tooMany) && styles.hintBad,
              !duplicates && !tooMany && numbers.length > 0 && styles.hintOk,
            ]}
            testID="admin-indent-straw-hint"
          >
            {duplicates
              ? t('admin.indents.strawDuplicate')
              : numbers.length
                ? t('admin.indents.strawSetsQty', { n: numbers.length })
                : t('admin.indents.strawBlank')}
          </AppText>
        </View>
      )}

      <View ref={reasonRef} collapsable={false} style={styles.field}>
        <View style={styles.fieldHead}>
          <View style={[styles.fieldIcon, { backgroundColor: colors.errorWash }]}>
            <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.error} />
          </View>
          <AppText style={styles.fieldLabel}>{t('admin.indents.reasonLabel')}</AppText>
        </View>
        <TextInput
          style={styles.input}
          value={reason}
          onChangeText={text => {
            setHintOverride(null);
            setReason(text);
          }}
          onFocus={() => api.reveal(reasonRef.current)}
          maxLength={200}
          placeholder={t('admin.indents.reasonPlaceholder')}
          placeholderTextColor={colors.textDisabled}
          testID="admin-indent-reason"
        />
        <AppText style={styles.hint}>{t('admin.indents.reasonHint')}</AppText>
      </View>

      {!!problem && (
        <View style={styles.problem} testID="admin-indent-problem">
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <AppText style={styles.problemText}>{problem}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        {requested && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={doApprove}
            style={({ pressed }) => [styles.primary, busy && styles.off, pressed && styles.pressed]}
            testID="admin-indent-approve"
          >
            {approveState.isLoading ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>{t('admin.indents.approve')}</AppText>
          </Pressable>
        )}
        {canIssue && (
          <Pressable
            accessibilityRole="button"
            disabled={busy || duplicates}
            onPress={doIssue}
            style={({ pressed }) => [
              styles.primary,
              (busy || duplicates) && styles.off,
              pressed && styles.pressed,
            ]}
            testID="admin-indent-issue"
          >
            {issueState.isLoading ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Ionicons name="arrow-up-circle-outline" size={18} color={colors.surface} />
            )}
            <AppText style={styles.primaryLabel}>{t('admin.indents.issueStock')}</AppText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={doReject}
          style={({ pressed }) => [styles.danger, busy && styles.off, pressed && styles.pressed]}
          testID="admin-indent-reject"
        >
          {rejectState.isLoading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Ionicons name="close" size={18} color={colors.surface} />
          )}
          <AppText style={styles.primaryLabel}>{t('admin.indents.reject')}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          testID="admin-indent-close"
        >
          <AppText style={styles.secondaryLabel}>{t('admin.indents.close')}</AppText>
        </Pressable>
      </View>
      <AppText style={styles.hint} testID="admin-indent-hint">
        {hint}
      </AppText>
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The queue
// --------------------------------------------------------------------------------------

function IndentCard({ indent, onOpen }: { indent: Indent; onOpen: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const status = statusOf(t, indent);
  const look = TONE[status.tone];
  const action = actionOf(indent);
  const straw = isStraw(indent);
  const depot = depotLine(t, indent);

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-indent-${indent.id}`}
    >
      <View style={styles.cardTop}>
        <View style={[styles.disc, { backgroundColor: look.solid }]}>
          {straw ? (
            <Glyph name={STRAW_GLYPH} size={17} color={look.onSolid} />
          ) : (
            <Ionicons name="cube-outline" size={17} color={look.onSolid} />
          )}
        </View>
        <View style={styles.flex}>
          <View style={[styles.code, { borderColor: look.border }]}>
            <AppText style={[styles.codeLabel, { color: look.text }]}>{`IND-${indent.id}`}</AppText>
          </View>
          <AppText style={styles.cardName}>{indent.mait_name || '—'}</AppText>
          <AppText style={styles.sub}>{indent.mait_code}</AppText>
        </View>
        <Pill label={status.label} tone={status.tone} />
      </View>

      <View style={styles.inset}>
        <View style={[styles.row, styles.ruleBottom]}>
          <AppText style={styles.rowLabel}>{t('admin.indents.item')}</AppText>
          <View style={styles.flex}>
            <AppText style={styles.rowValue}>
              {`${num(indent.qty_requested)} × ${indent.breed || indent.item}`}
            </AppText>
            {!!depot && (
              <AppText style={styles.sub} testID={`admin-indent-depot-${indent.id}`}>
                {depot}
              </AppText>
            )}
          </View>
        </View>
        <View style={styles.row}>
          <AppText style={styles.rowLabel}>{t('admin.indents.raised')}</AppText>
          <AppText style={[styles.rowValue, styles.flex]}>
            {dateOf(t, indent.requested_at)}
            <AppText style={styles.sub}>{`  ${ageOf(t, indent.requested_at)}`}</AppText>
          </AppText>
        </View>
      </View>

      {action && (
        <View style={styles.cardFoot}>
          {action === 'withStore' ? (
            <AppText style={styles.sub}>
              {t('admin.indents.withStore', { store: indent.store_name })}
            </AppText>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={onOpen}
              style={({ pressed }) => [
                action === 'issue' ? styles.primary : styles.reviewButton,
                pressed && styles.pressed,
              ]}
              testID={`admin-indent-open-${indent.id}`}
            >
              <Ionicons
                name={action === 'issue' ? 'arrow-up-circle-outline' : 'eye-outline'}
                size={16}
                color={action === 'issue' ? colors.surface : colors.ink}
              />
              <AppText style={action === 'issue' ? styles.primaryLabel : styles.reviewLabel}>
                {t(action === 'issue' ? 'admin.indents.issue' : 'admin.indents.review')}
              </AppText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export default function AdminIndentsScreen({
  initialStatus = '',
  initialStale = false,
}: {
  initialStatus?: Status;
  initialStale?: boolean;
} = {}): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [status, setStatus] = useState<Status>(initialStatus);
  const [staleOnly, setStaleOnly] = useState(initialStale);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Indent | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);

  const filters = useMemo(
    () => ({ search, status, stale: staleOnly }),
    [search, status, staleOnly],
  );
  const list = useAdminListIndentsQuery({
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.stale ? { stale: true } : {}),
    offset,
  });

  useEffect(() => {
    setOffset(0);
  }, [filters]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open) {
    return (
      <View style={styles.root}>
        <Review
          key={open.id}
          indent={open}
          onBack={() => setOpen(null)}
          onDone={(text, tone) => {
            setOpen(null);
            setFlash({ text, tone });
          }}
        />
      </View>
    );
  }

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  const stale = rows.filter(isStale).length;
  const waiting = rows.filter(i => i.status === 'requested' || i.status === 'approved').length;

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
        testID="admin-indents"
      >
        <AppText style={styles.countLine} testID="admin-indents-count">
          {list.data
            ? [
                t('admin.indents.total', { count, n: num(count) }),
                t('admin.indents.awaiting', { n: waiting }),
                stale ? t('admin.indents.staleCount', { n: stale }) : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : '—'}
        </AppText>

        {!!flash && (
          <Notice
            tone={flash.tone}
            icon={flash.tone === 'green' ? 'checkmark' : 'information'}
            title={flash.text}
            body=""
            testID="admin-indents-flash"
          />
        )}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.indents.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-indents-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          <FilterChip
            label={t('admin.indents.staleFirst')}
            icon="time-outline"
            tone="red"
            active={staleOnly}
            onPress={() => {
              setFlash(null);
              setStaleOnly(on => !on);
            }}
            testID="admin-indents-stale"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statuses}
        >
          {STATUSES.map(s => (
            <FilterChip
              key={s || 'all'}
              label={t(s ? `admin.indents.status_${s}` : 'admin.indents.statusAll')}
              icon={
                s === 'requested'
                  ? 'hourglass-outline'
                  : s === 'approved'
                    ? 'checkmark-circle-outline'
                    : s === 'issued'
                      ? 'arrow-up-circle-outline'
                      : s === 'rejected'
                        ? 'close-circle-outline'
                        : 'list-outline'
              }
              tone={s ? STATUS_TONE[s] : 'slate'}
              active={status === s}
              onPress={() => {
                setFlash(null);
                setStatus(s);
              }}
              testID={`admin-indents-status-${s || 'all'}`}
            />
          ))}
        </ScrollView>

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.indents.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.indents.none')} />
        ) : (
          rows.map(indent => (
            <IndentCard
              key={indent.id}
              indent={indent}
              onOpen={() => {
                setFlash(null);
                setOpen(indent);
              }}
            />
          ))
        )}

        {count > LIMIT && (
          <View style={styles.pager} testID="admin-indents-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.off]}
              testID="admin-indents-prev"
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.indents.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.indents.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(count, offset + rows.length)),
                total: num(count),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= count || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= count && styles.off]}
              testID="admin-indents-next"
            >
              <AppText style={styles.pageStepLabel}>{t('admin.indents.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}

        {/* Two statuses that routinely disagree, and the disagreement is the bug worth
            catching. */}
        <Notice
          tone="blue"
          icon="information"
          title={t('admin.indents.noticeTitle')}
          body={t('admin.indents.noticeBody')}
          testID="admin-indents-notice"
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
  off: { opacity: 0.45 },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  hintBad: { color: colors.error },
  hintOk: { color: colors.primaryDark },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ruleBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },

  countLine: { ...typography.h3, color: colors.ink },
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statuses: { gap: spacing[2], paddingRight: spacing[4] },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  disc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  code: {
    alignSelf: 'flex-start',
    marginBottom: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  codeLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  cardName: { ...typography.h3, color: colors.ink },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], paddingVertical: 8 },
  rowLabel: { ...typography.caption, color: colors.textMuted, width: 56 },
  rowValue: { ...typography.label, color: colors.ink },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  // Review is yolk, the colour this product gives to anything waiting on somebody; Issue keeps
  // the green because the stock actually moves. Never both on one card.
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  reviewLabel: { ...typography.label, color: colors.ink },

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
  pageStepLabel: { ...typography.label, color: colors.info },
  pageOf: { ...typography.caption, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },

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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  heroMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...typography.h2, color: colors.surface },
  heroMeta: { ...typography.caption, color: yolk[300] },

  facts: { flexDirection: 'row', gap: spacing[2] },
  fact: { flex: 1, padding: spacing[3], gap: 2, borderRadius: radius.md, borderWidth: 1 },
  factLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  factValue: { ...typography.h2, color: colors.ink },
  factMeta: { ...typography.caption, color: colors.ink },

  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelTitle: { ...typography.label },
  trailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  trailText: { ...typography.caption, color: colors.ink, flex: 1 },

  effect: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  effectText: { ...typography.label, color: colors.ink, flex: 1 },

  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  fieldIcon: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  fieldLabel: { ...typography.label, color: colors.ink },
  count: { ...typography.caption, color: colors.textMuted },
  input: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  inputLocked: { borderColor: colors.border, backgroundColor: ink[50], color: colors.textMuted },
  textarea: { minHeight: 110, paddingTop: spacing[3], textAlignVertical: 'top' },

  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  problemText: { ...typography.label, color: colors.error, flex: 1 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.label, color: colors.surface },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.error,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },
});
