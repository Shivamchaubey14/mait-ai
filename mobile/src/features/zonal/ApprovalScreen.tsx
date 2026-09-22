/**
 * The decision: one request, and everything each item in it turns on.
 *
 * A manager at a desk approves with the Inventory screen open in the next tab. Standing in a
 * yard there is one screen, so it has to carry the whole answer: who is asking, what they are
 * already holding of each thing, and what the depot that will serve them can actually
 * promise. Approving blind is the failure this screen exists to prevent — and the failure is
 * quiet, because an indent approved against an empty shelf looks exactly like one approved
 * against a full one until the Mait turns up for it.
 *
 * **A request, not an indent.** The Mait raised a list; the queue groups it back together
 * (`groupIndents`) and this screen decides it as one. Each item is a card of its own in the
 * colour of its shelf — green ready, yolk short, red empty, blue no depot — with the two
 * figures it is weighed on. With more than one item, each card carries its own Approve and
 * Reject, because "approve the straws, not the gloves" is an ordinary answer; and the foot
 * does the whole request at once.
 *
 * **Reject is a button.** Red outline beside the green, not a line of red text: it is an
 * action somebody takes on purpose, and it should look like one. Rejecting opens a sheet and
 * asks for a reason, which is not optional here even though the API allows a blank one: the
 * Mait reads the indent, not the audit log, and a bare "rejected" is a phone call somebody has
 * to take.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Glyph from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import {
  useApproveIndentMutation,
  useListZonalApprovalsQuery,
  useRejectIndentMutation,
} from '@api/endpoints';
import type { ZonalApproval } from '@api/types';
import { Sheet } from '@/components/BottomSheet';
import { clock, itemLabel } from '@/components/frame';
import { Toast } from '@/components/toast';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { coveragePill, itemIcon, Pill, ZonalAction, ZonalHero, zonalStyles } from './parts';
import type { IndentGroup, TileTone } from './parts';

/** The shortest reason worth storing. Below this it is a keystroke, not an explanation. */
const MIN_REASON = 4;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ITEM_TONE: Record<ZonalApproval['coverage'], TileTone> = {
  ready: 'good',
  short: 'waiting',
  empty: 'bad',
  'no-store': 'info',
};

/** Which items a reason is being written for: one, or everything still open. */
type Target = number | 'all';

/** One of the two figures an item is weighed on, on a white inset with its glyph. */
function Figure({
  icon,
  label,
  value,
  hint,
  tone,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  hint: string;
  tone: 'good' | 'bad' | 'plain';
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.figure} testID={testID}>
      <View style={styles.figureHead}>
        <Ionicons name={icon} size={13} color={colors.textMuted} />
        <Text style={styles.figureLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.figureValue, styles[`figureValue_${tone}`]]}>{value}</Text>
      <Text style={styles.figureHint} numberOfLines={1}>
        {hint}
      </Text>
    </View>
  );
}

export default function ApprovalScreen({
  group,
  zoneName,
  onBack,
  onDecided,
}: {
  /** The request it was opened from, so the screen paints before the refetch lands. */
  group: IndentGroup;
  zoneName: string;
  onBack: () => void;
  /** Every item in the request is settled — back to the queue. */
  onDecided: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const queue = useListZonalApprovalsQuery();
  const [approve, approving] = useApproveIndentMutation();
  const [reject, rejecting] = useRejectIndentMutation();

  const [problem, setProblem] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  /** What this manager has settled here, so a decided item leaves the screen at once. */
  const [settled, setSettled] = useState<number[]>([]);
  /** The item being worked on right now, so only its buttons spin. */
  const [working, setWorking] = useState<Target | null>(null);

  const ids = useMemo(() => group.rows.map(row => row.id), [group]);

  // The live queue once it has landed, and only it: falling back to the opening rows after a
  // decision would bring back the item just settled.
  const rows = (queue.data ? queue.data.results.filter(row => ids.includes(row.id)) : group.rows)
    .filter(row => !settled.includes(row.id))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const done = rows.length === 0 && settled.length > 0;
  // Once. The navigator hands a fresh callback on every render, and the live beat re-renders
  // it; without the latch a settled request would send the screen back twice.
  const left = useRef(false);
  useEffect(() => {
    if (done && !left.current) {
      left.current = true;
      onDecided();
    }
  }, [done, onDecided]);

  const first = rows[0] ?? group.rows[0]!;

  if (rows.length === 0) {
    if (done) {
      return <View style={zonalStyles.root} />;
    }
    // Gone from the queue while this screen was open — somebody else settled it, or it was
    // withdrawn. Said plainly rather than left as an empty screen with a live Approve on it.
    return (
      <View style={zonalStyles.root}>
        <ZonalHero
          tag={`IND-${group.key}`}
          pill={zoneName}
          title={t('zonal.goneTitle')}
          subtitle={t('zonal.goneBody')}
          onBack={onBack}
        />
        <View style={zonalStyles.footer}>
          <ZonalAction
            label={t('zonal.backToQueue')}
            icon="arrow-back"
            tone="outline"
            onPress={onBack}
            testID="zonal-gone-back"
          />
        </View>
      </View>
    );
  }

  const busy = approving.isLoading || rejecting.isLoading;
  const many = rows.length > 1;
  const raised = new Date(first.requested_at);
  const waited = Math.max(...rows.map(row => row.waiting_days));
  const notes = [...new Set(rows.map(row => row.note.trim()).filter(Boolean))];

  /**
   * Settle some of the request, one indent at a time.
   *
   * In order, and stopping at the first refusal: the server knows why — it was settled a
   * minute ago, it is part-issued, it left this zone — and says so in a sentence. What landed
   * before it stays landed and leaves the screen, so a retry does not settle it twice.
   */
  const decide = async (outcome: 'approved' | 'rejected', which: Target) => {
    setProblem(null);
    setWorking(which);
    const chosen = which === 'all' ? rows : rows.filter(row => row.id === which);
    let landed = 0;
    try {
      for (const row of chosen) {
        if (outcome === 'approved') {
          await approve(row.id).unwrap();
        } else {
          await reject({ id: row.id, reason: reason.trim() }).unwrap();
        }
        landed += 1;
        setSettled(before => [...before, row.id]);
      }
      setTarget(null);
      setReason('');
    } catch (err) {
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      setProblem(
        landed > 0
          ? t('zonal.decidedSome', { done: landed, total: chosen.length })
          : detail || t('zonal.decisionFailed'),
      );
      queue.refetch();
    } finally {
      setWorking(null);
    }
  };

  const verdict = (row: ZonalApproval): string =>
    row.coverage === 'no-store'
      ? t('zonal.coverageNoStore')
      : row.coverage === 'empty'
        ? t('zonal.coverageEmpty', { store: row.store_name })
        : row.coverage === 'short'
          ? t('zonal.coverageShort', {
              store: row.store_name,
              have: row.in_store,
              asked: row.qty_requested,
            })
          : t('zonal.coverageReady', { store: row.store_name, qty: row.qty_requested });

  const onlyItem = itemLabel(first, i18n.language);

  return (
    <View style={zonalStyles.root}>
      <Toast message={problem} onDismiss={() => setProblem(null)} testID="zonal-decision-problem" />

      <ZonalHero
        tag={
          many ? t('zonal.requestTag', { id: group.key, count: rows.length }) : `IND-${first.id}`
        }
        pill={zoneName}
        title={
          many
            ? t('zonal.requestTitle', { count: rows.length })
            : t('zonal.decisionTitle', { qty: first.qty_requested, item: onlyItem })
        }
        subtitle={t('zonal.decisionSubtitle', { mait: first.mait_name, code: first.mait_code })}
        onBack={onBack}
        testID="zonal-decision-hero"
      />

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={queue.isFetching}
            onRefresh={queue.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Who is asking, in yolk — the people colour on every zonal screen. */}
        <View style={[styles.card, styles.cardWarm]} testID="zonal-decision-mait">
          <View style={styles.cardHead}>
            <View style={[styles.chip, styles.chipWarm]}>
              <Ionicons name="person" size={15} color={colors.surface} />
            </View>
            <Text style={[styles.cardTitle, styles.titleWarm]}>{t('zonal.whoIsAsking')}</Text>
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
          <View style={styles.inset}>
            <Text style={styles.fact}>
              <Text style={styles.factLabel}>{`${t('zonal.maitNameLabel')}: `}</Text>
              {first.mait_name}
            </Text>
            <Text style={styles.fact}>
              <Text style={styles.factLabel}>{`${t('zonal.vendorCodeLabel')}: `}</Text>
              {first.mait_code || '—'}
            </Text>
            <Text style={styles.fact}>
              <Text style={styles.factLabel}>{`${t('zonal.raisedLabel')}: `}</Text>
              {`${raised.getDate()} ${MONTHS[raised.getMonth()]} ${raised.getFullYear()}, ${clock(
                first.requested_at,
              )}`}
            </Text>
          </View>
          {!!first.mpp_names.length && (
            <View style={styles.chips}>
              {first.mpp_names.map(name => (
                <View key={name} style={styles.place}>
                  <Ionicons name="location" size={12} color={colors.info} />
                  <Text style={styles.placeLabel} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* What they wrote. Only when there is something — an empty card headed "Their note"
            reads as a note that failed to load. */}
        {!!notes.length && (
          <View style={[styles.card, styles.cardNote]} testID="zonal-decision-note">
            <View style={styles.cardHead}>
              <View style={[styles.chip, styles.chipInk]}>
                <Ionicons name="chatbubble-ellipses" size={14} color={colors.surface} />
              </View>
              <Text style={styles.cardTitle}>{t('zonal.theirNote')}</Text>
            </View>
            {notes.map(note => (
              <Text key={note} style={styles.note}>
                {`“${note}”`}
              </Text>
            ))}
          </View>
        )}

        {many && (
          <Text style={styles.section}>{t('zonal.itemsInRequest', { count: rows.length })}</Text>
        )}

        {rows.map(row => {
          const tone = ITEM_TONE[row.coverage];
          const pill = coveragePill(row, t);
          const item = itemLabel(row, i18n.language);
          return (
            <View
              key={row.id}
              style={[styles.card, styles[`card_${tone}`]]}
              testID={`zonal-decision-item-${row.id}`}
            >
              <View style={styles.itemHead}>
                <View style={[styles.itemIcon, styles[`itemIcon_${tone}`]]}>
                  <Glyph name={itemIcon(row)} size={18} color={colors.surface} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item}
                  </Text>
                  <Text style={styles.itemMeta}>{`IND-${row.id}`}</Text>
                </View>
                <View style={styles.qty}>
                  <Text style={styles.qtyValue}>{row.qty_requested}</Text>
                  <Text style={styles.qtyUnit}>{row.unit || t('zonal.asked')}</Text>
                </View>
              </View>

              {/* The word first, with the sentence that earns it. */}
              <View style={styles.verdict}>
                <Pill
                  label={pill.label}
                  tone={pill.tone}
                  testID={many ? `zonal-decision-pill-${row.id}` : 'zonal-decision-pill'}
                />
                <Text style={styles.verdictBody}>{verdict(row)}</Text>
              </View>

              {/* Read against each other: a Mait holding thirty who asks for twenty-five is a
                  different conversation from one holding none. */}
              <View style={styles.figures}>
                <Figure
                  icon="person-outline"
                  label={t('zonal.maitHolds')}
                  value={String(row.mait_holds)}
                  hint={item}
                  tone={row.mait_holds === 0 ? 'bad' : 'plain'}
                  testID={many ? `zonal-mait-holds-${row.id}` : 'zonal-mait-holds'}
                />
                <Figure
                  icon="storefront-outline"
                  label={t('zonal.atTheDepot')}
                  value={row.in_store < 0 ? '—' : String(row.in_store)}
                  hint={row.store_name || t('zonal.noStoreShort')}
                  tone={row.in_store < 0 ? 'plain' : row.in_store <= 0 ? 'bad' : 'good'}
                  testID={many ? `zonal-in-store-${row.id}` : 'zonal-in-store'}
                />
              </View>

              {many && (
                <View style={styles.itemActions}>
                  <View style={styles.flex}>
                    <ZonalAction
                      label={t('zonal.rejectShort')}
                      icon="close"
                      tone="dangerOutline"
                      disabled={busy}
                      onPress={() => setTarget(row.id)}
                      testID={`zonal-item-reject-${row.id}`}
                    />
                  </View>
                  <View style={styles.flex}>
                    <ZonalAction
                      label={t('zonal.approveShort')}
                      icon="checkmark"
                      busy={approving.isLoading && working === row.id}
                      disabled={busy}
                      onPress={() => decide('approved', row.id)}
                      testID={`zonal-item-approve-${row.id}`}
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.aside}>
          <Ionicons name="information-circle" size={18} color={colors.info} />
          <Text style={styles.asideText}>{t('zonal.whatHappensNext')}</Text>
        </View>
      </ScrollView>

      {/* Both answers as buttons, side by side: red outline for the one that closes the
          request against somebody, green for the one this screen is here for. */}
      <View style={[zonalStyles.footer, styles.footer]}>
        <View style={styles.footerReject}>
          <ZonalAction
            label={many ? t('zonal.rejectAll') : t('zonal.rejectShort')}
            icon="close"
            tone="dangerOutline"
            disabled={busy}
            onPress={() => setTarget('all')}
            testID="zonal-open-reject"
          />
        </View>
        <View style={styles.footerApprove}>
          <ZonalAction
            label={
              many
                ? t('zonal.approveAll', { count: rows.length })
                : t('zonal.approve', { qty: first.qty_requested, item: onlyItem })
            }
            icon="checkmark-done"
            busy={approving.isLoading && working === 'all'}
            disabled={busy}
            onPress={() => decide('approved', 'all')}
            testID="zonal-approve"
          />
        </View>
      </View>

      <Sheet
        visible={target !== null}
        title={
          target === 'all' && many
            ? t('zonal.rejectAllTitle', { count: rows.length })
            : t('zonal.rejectTitle', { id: target === 'all' ? first.id : target })
        }
        subtitle={t('zonal.rejectSubtitle', { mait: first.mait_name })}
        onClose={() => setTarget(null)}
        testID="zonal-reject-sheet"
        footer={
          <View style={styles.sheetFooter}>
            <ZonalAction
              label={t('zonal.rejectConfirm')}
              icon="close"
              tone="danger"
              busy={rejecting.isLoading}
              disabled={reason.trim().length < MIN_REASON || busy}
              onPress={() => target !== null && decide('rejected', target)}
              testID="zonal-reject-confirm"
            />
          </View>
        }
      >
        <Text style={styles.reasonLabel}>{t('zonal.reasonLabel')}</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={t('zonal.reasonPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.reasonInput}
          multiline
          maxLength={200}
          testID="zonal-reason-input"
        />
        <Text style={styles.reasonHint}>{t('zonal.reasonHint')}</Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  // -- cards ------------------------------------------------------------------------------
  card: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[2],
  },
  cardWarm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  cardNote: { backgroundColor: colors.surface, borderColor: colors.border },
  card_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_plain: { backgroundColor: colors.surface, borderColor: colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  chip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipWarm: { backgroundColor: yolk[600] },
  chipInk: { backgroundColor: colors.ink },
  cardTitle: { ...typography.h3, color: colors.ink, flex: 1 },
  titleWarm: { color: yolk[900] },

  waited: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  waitedLong: { backgroundColor: colors.error },
  waitedLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: yolk[800] },
  waitedLabelLong: { color: colors.surface },

  inset: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  fact: { ...typography.body, color: colors.ink },
  factLabel: { fontFamily: typography.label.fontFamily, color: yolk[800] },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: 180,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
  },
  placeLabel: { ...typography.caption, color: colors.info, flexShrink: 1 },

  note: { ...typography.body, color: colors.ink, fontStyle: 'italic' },

  section: { ...typography.label, color: colors.textMuted, marginBottom: spacing[2] },

  // -- an item ------------------------------------------------------------------------------
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIcon_good: { backgroundColor: colors.primary },
  itemIcon_waiting: { backgroundColor: yolk[600] },
  itemIcon_bad: { backgroundColor: colors.error },
  itemIcon_info: { backgroundColor: colors.info },
  itemIcon_plain: { backgroundColor: colors.textMuted },
  itemBody: { flex: 1 },
  itemName: { ...typography.h3, color: colors.ink },
  itemMeta: { ...typography.caption, color: colors.textMuted },
  qty: { alignItems: 'center' },
  qtyValue: { ...typography.h1, color: colors.ink },
  qtyUnit: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginTop: -4 },

  verdict: {
    alignItems: 'flex-start',
    gap: spacing[1],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  verdictBody: { ...typography.caption, color: colors.ink },

  figures: { flexDirection: 'row', gap: spacing[2] },
  figure: {
    flex: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  figureHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  figureLabel: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  figureValue: { ...typography.h1, marginTop: 2 },
  figureValue_good: { color: colors.primaryDark },
  figureValue_bad: { color: colors.error },
  figureValue_plain: { color: colors.ink },
  figureHint: { ...typography.caption, color: colors.textMuted },

  itemActions: { flexDirection: 'row', gap: spacing[2] },

  aside: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  asideText: { ...typography.caption, color: colors.ink, flex: 1 },

  // -- the foot -----------------------------------------------------------------------------
  footer: { flexDirection: 'row', gap: spacing[2] },
  footerReject: { flex: 2 },
  footerApprove: { flex: 3 },

  sheetFooter: { paddingTop: spacing[3] },
  reasonLabel: { ...typography.label, color: colors.primaryDark },
  reasonInput: {
    ...typography.body,
    color: colors.ink,
    minHeight: 96,
    marginTop: spacing[2],
    padding: spacing[3],
    textAlignVertical: 'top',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing[2] },
});
