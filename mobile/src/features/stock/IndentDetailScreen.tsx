/**
 * One indent, and where it has got to.
 *
 * The timeline is the point of the screen. A Mait asking "is my stock coming" is really
 * asking which of four things has happened, and a status word alone does not answer that —
 * "approved" tells them the office agreed, not whether the depot has packed anything.
 *
 * The last step is theirs: stock is only really theirs once collected, and confirming it is
 * how the count on the Stock screen changes. Before the stock is issued the button is shown
 * inert with the reason beside it rather than left off the screen — a Mait who cannot see the
 * last step does not know one is coming.
 *
 * Wears the same green hero as every other tab screen rather than the capture flow's stepped
 * one. This is a place a Mait looks something up, not a sequence they are part-way through.
 *
 * **Stock handed over at a store needs the store's code.** The keeper reads four digits out
 * across the counter and the Mait types them here; that is what proves they were standing
 * there when it happened, and it is the only way the count on Inventory moves. The server
 * never sends the code to this app — a handset that already knew it would prove nothing. A
 * store short of stock hands over what it has and the rest stays open on the same indent, so
 * this screen can be collected from more than once.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useConfirmIndentCollectionMutation,
  useGetIndentQuery,
  useListBreedsQuery,
  useListMppsQuery,
} from '@api/endpoints';
import type { Indent } from '@api/types';
import Glyph, { GlyphName, STRAW_GLYPH } from '@/components/glyph';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { FlowNotice } from '@/features/aiFlow/components';
import {
  indentState,
  shortDate,
  shortTime,
  STATE_GLYPH,
  statusTone,
  TONE_PAINT,
} from '@/features/stock/IndentsScreen';
import { colors, green, ink, radius, spacing, typography, yolk } from '@theme/tokens';

type StepState = 'done' | 'current' | 'waiting' | 'refused';

/**
 * The reason the office gave, pulled back out of the note.
 *
 * `reject_indent` appends it to the indent's note as "… · Rejected: <reason>" rather than
 * keeping a field of its own, so the app has to undo that to show it. Read from the last
 * occurrence, because the Mait's own note is in front of it and there is nothing stopping
 * them having written the word themselves.
 *
 * Exported for the test: this is string surgery on a format owned by another codebase, which
 * is exactly the kind of thing that breaks quietly.
 */
export function rejectionReason(note: string): string | null {
  const marker = 'Rejected:';
  const at = note.lastIndexOf(marker);
  if (at === -1) {
    return null;
  }
  const reason = note.slice(at + marker.length).trim();
  return reason || null;
}

/**
 * What is at a counter with this Mait's name on it right now.
 *
 * The server says so directly; an indent cached before it did is worked out the old way —
 * issued and not yet collected means the whole issue is waiting.
 */
export function toCollect(indent: Indent): number {
  if (indent.qty_to_collect !== undefined) {
    return indent.qty_to_collect;
  }
  return indent.status === 'issued' && !indent.received_at ? indent.qty_issued : 0;
}

function stateOf(indent: Indent, step: number): StepState {
  // requested → approved → issued → received. Collection is the Mait's own step, and the
  // only one that moves without the office doing anything.
  if (indent.received_at) {
    return 'done';
  }
  // A store part-way through handing it over has issued, even though the indent is still
  // open for the rest — so any quantity out of the store reaches the third step.
  const issuedAny = indent.status === 'issued' || indent.qty_issued > 0;
  const reached = issuedAny ? 3 : indent.status === 'approved' ? 2 : 1;
  const waitingOnYou = toCollect(indent) > 0;
  if (step < reached) {
    return 'done';
  }
  if (step === reached) {
    // Issued is finished business for the depot; what is open is the collection after it.
    return issuedAny && step === 3 ? 'done' : 'current';
  }
  // The step immediately after issue is the one waiting on the Mait, so it reads as current
  // rather than as something still to be done to them.
  return waitingOnYou && step === 4 ? 'current' : 'waiting';
}

/** Each step's glyph, drawn in its dot once the step is reached. */
const STEP_GLYPH: Record<string, GlyphName> = {
  requested: 'paper-plane',
  approved: 'thumbs-up',
  issued: 'storefront',
  received: 'checkmark-done',
  rejected: 'close',
};

/**
 * A figure on a coloured row: its glyph on a chip, what it is, and the number on a badge.
 * Blue asked, green agreed or in hand, yolk waiting at a counter, slate not yet, red refused.
 */
function QtyRow({
  icon,
  tone,
  label,
  meta,
  value,
  testID,
}: {
  icon: GlyphName;
  tone: keyof typeof TONE_PAINT;
  label: string;
  meta: string;
  value: string | number;
  testID?: string;
}): React.JSX.Element {
  const paint = TONE_PAINT[tone];
  return (
    <View
      style={[styles.qtyRow, { backgroundColor: paint.wash, borderColor: paint.edge }]}
      testID={testID}
    >
      <View style={[styles.chip, { backgroundColor: paint.solid }]}>
        <Glyph name={icon} size={18} color={paint.onSolid} />
      </View>
      <View style={styles.qtyBody}>
        <Text style={styles.qtyLabel}>{label}</Text>
        <Text style={[styles.qtyMeta, { color: paint.word }]}>{meta}</Text>
      </View>
      <View style={[styles.qtyBadge, { backgroundColor: paint.solid }]}>
        <Text style={[styles.qtyValue, { color: paint.onSolid }]}>{value}</Text>
      </View>
    </View>
  );
}

/** Date and time on one line, in the order a timeline is read. */
function stamp(iso: string | null): string | null {
  return iso ? `${shortDate(iso)} · ${shortTime(iso)}` : null;
}

export default function IndentDetailScreen({
  indentId,
  onBack,
}: {
  indentId: number;
  onBack: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const query = useGetIndentQuery(indentId);
  const online = useOnline();
  const breeds = useListBreedsQuery();
  const mpps = useListMppsQuery();
  const indent = query.data;
  const [confirmCollection, confirmation] = useConfirmIndentCollectionMutation();
  const [error, setError] = useState<string | null>(null);
  /** The four digits the store keeper read out. Never known to this app until typed. */
  const [code, setCode] = useState('');
  /** What the collection just added to the Mait's stock — this trip, not the indent's total. */
  const [added, setAdded] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    const adding = indent ? toCollect(indent) : 0;
    try {
      await confirmCollection({ id: indentId, code: code || undefined }).unwrap();
      setCode('');
      // Said as a number, because the indent's own figures are running totals: a second batch
      // of 2 against an indent of 5 leaves "Issued so far 5" on the screen, and a Mait who reads
      // that as five more straws plans a round around three they do not have.
      if (adding > 0) {
        setAdded(t('indents.addedToStock', { qty: adding, item: itemName }));
      }
    } catch (err) {
      // A wrong code and a locked one need two different things from the Mait: read it again,
      // or ask for a new one. Anything else is the server's own rule — not issued yet, or
      // already confirmed — and saying so beats a button that appears to do nothing.
      switch (errorCodeOf(err)) {
        case ErrorCode.COLLECTION_CODE_INVALID:
          setError(t('indents.codeWrong'));
          setCode('');
          break;
        case ErrorCode.COLLECTION_CODE_LOCKED:
          setError(t('indents.codeLocked'));
          setCode('');
          break;
        default:
          setError(t('indents.confirmFailed'));
      }
    }
  };

  /** Back, and the name of the list this was opened from. The same shape that list wears. */
  const heroTop = (
    <View style={styles.heroTop}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        testID="indent-back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.surface} />
      </Pressable>
      <Text style={styles.eyebrow}>{t('indents.title')}</Text>
    </View>
  );

  if (query.isLoading || !indent) {
    return (
      <View style={styles.root}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>{heroTop}</View>
        <ScrollView contentContainerStyle={styles.body}>
          {query.isError ? (
            <Problem
              kind={online ? 'server' : 'offline'}
              onRetry={() => query.refetch()}
              busy={query.isFetching}
              testID="indent-error"
            />
          ) : (
            <SkeletonList rows={4} />
          )}
        </ScrollView>
      </View>
    );
  }

  const status = statusTone(indent, t);
  const statusPaint = TONE_PAINT[status.tone];

  /**
   * A refused indent is a different shape of screen, not the same one with a red word on it.
   *
   * Nothing after "requested" is ever going to happen to it, and a timeline still offering
   * "Approved by store · Waiting on the store" underneath a status reading Rejected is the
   * screen telling a Mait to keep waiting for something that is not coming.
   */
  const rejected = indent.status === 'rejected';
  const reason = rejectionReason(indent.note);

  /**
   * The breed as the rest of the app spells it, and where the goods are actually waiting.
   *
   * `item` comes back from the server as "25 MURRAH" — the code, not the name a Mait reads on
   * every other screen. The depot is the plant the Mait's MPPs report into; there is no plant
   * on the indent itself and no plant master to look one up in, so it is read off the MPPs and
   * left unnamed rather than guessed at when they span more than one.
   */
  const hindi = i18n.language.startsWith('hi');
  const breedConfig = (breeds.data ?? []).find(config => config.code === indent.breed);
  const breedLabel = (hindi && breedConfig?.name_hi) || breedConfig?.name || indent.breed;
  const item = indent.breed ? `${indent.qty_requested} ${breedLabel}` : indent.item;
  /** The thing itself, with no quantity in front — "Murrah", or the product's name. */
  const itemName = breedLabel || indent.item.replace(/^\d+\s*(×\s*)?/, '');

  const plants = Array.from(
    new Set((mpps.data?.results ?? []).map(mpp => mpp.plant_name).filter(Boolean)),
  );
  // The store the server routed it to, when there is one: that is where the Mait goes, and it
  // is a name the keeper behind the counter will recognise.
  const depot = indent.store_name
    ? t('indents.collectAtStore', { store: indent.store_name })
    : plants.length === 1
      ? t('indents.collectAtNamed', { plant: plants[0] })
      : t('indents.collectAtMpp');

  // The server keeps no separate approved quantity: approval is of the whole request, so an
  // indent past `requested` had all of it approved. Shown as a dash until then rather than
  // as a number the office has not agreed to.
  const approvedReached = indent.status === 'approved' || indent.status === 'issued';

  const steps: { key: string; label: string; meta: string; state?: StepState }[] = rejected
    ? [
        {
          key: 'requested',
          label: t('indents.stepRequested'),
          meta: [
            stamp(indent.requested_at),
            t('indents.stepRequestedMeta', { qty: indent.qty_requested }),
          ]
            .filter(Boolean)
            .join(' · '),
          state: 'done',
        },
        {
          key: 'rejected',
          label: t('indents.stepRejected'),
          // The reason, on the trail, at the step it belongs to — not tucked into a note
          // field further down the page. It is the only thing on this screen a Mait might
          // have to read back to the office over the phone.
          meta: reason
            ? t('indents.stepRejectedMeta', { reason })
            : t('indents.stepRejectedNoReason'),
          state: 'refused',
        },
      ]
    : [
        {
          key: 'requested',
          label: t('indents.stepRequested'),
          meta: [
            stamp(indent.requested_at),
            t('indents.stepRequestedMeta', { qty: indent.qty_requested }),
          ]
            .filter(Boolean)
            .join(' · '),
        },
        {
          key: 'approved',
          label: t('indents.stepApproved'),
          meta: approvedReached
            ? indent.approved_by_name
              ? t('indents.stepApprovedBy', {
                  qty: indent.qty_requested,
                  name: indent.approved_by_name,
                })
              : t('indents.stepApprovedMeta', { qty: indent.qty_requested })
            : t('indents.stepApprovedWaiting'),
        },
        {
          key: 'issued',
          label: t('indents.stepIssued'),
          meta:
            indent.status === 'issued' || indent.qty_issued > 0
              ? [
                  stamp(indent.issued_at),
                  indent.store_name
                    ? t('indents.stepIssuedAt', {
                        qty: indent.qty_issued,
                        store: indent.store_name,
                      })
                    : t('indents.stepIssuedMeta', { qty: indent.qty_issued }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('indents.stepIssuedWaiting'),
        },
        {
          key: 'received',
          label: t('indents.stepReceived'),
          meta: indent.received_at
            ? (stamp(indent.received_at) ?? t('indents.stepReceivedDone'))
            : toCollect(indent) > 0
              ? t('indents.stepReceivedReady')
              : t('indents.stepReceivedWaiting'),
        },
      ];

  const waitingQty = toCollect(indent);
  /** Each trip across a store's counter, oldest first — the order they happened in. */
  const handovers = [...(indent.handovers ?? [])]
    .filter(trip => trip.state !== 'cancelled')
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at));
  const collectable = waitingQty > 0;
  const needsCode = collectable && !!indent.needs_code;
  const issuedPending = indent.qty_issued === 0 && !rejected;
  // Some handed over and the rest still owed: the store issues it when the next batch lands.
  const partOpen = !rejected && indent.qty_issued > 0 && (indent.qty_open ?? 0) > 0;

  const confirming = confirmation.isLoading;

  return (
    <View style={styles.root}>
      <Toast message={error} onDismiss={() => setError(null)} testID="indent-confirm-error" />
      <Toast
        message={added}
        tone="success"
        onDismiss={() => setAdded(null)}
        testID="indent-added"
      />

      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        {heroTop}

        {/* The status sits beside the number rather than under it: it is the answer to the
            question that brought the Mait here, and the number is only how they found it. */}
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroTitle}>{`IND-${indent.id}`}</Text>
          <View
            style={[styles.heroPill, { backgroundColor: statusPaint.solid }]}
            testID="indent-status"
          >
            <Glyph name={STATE_GLYPH[indentState(indent)]} size={13} color={statusPaint.onSolid} />
            <Text style={[styles.heroPillLabel, { color: statusPaint.onSolid }]}>
              {status.label}
            </Text>
          </View>
        </View>

        <Text style={styles.heroSubtitle}>
          {t('indents.raisedOn', { item, date: shortDate(indent.requested_at) })}
        </Text>
      </View>

      {/* The timeline moves when the office acts, not when the Mait does, so this screen goes
          stale while it is being read. Pulling is the gesture they already use on the list. */}
      <ScrollView
        contentContainerStyle={styles.body}
        testID="indent-scroll"
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={query.refetch}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.timeline} testID="indent-timeline">
          {steps.map((step, index) => {
            // The refused trail carries its own states; the ordinary one is derived.
            const state = step.state ?? stateOf(indent, index + 1);
            const last = index === steps.length - 1;
            return (
              <View key={step.key} style={styles.step}>
                <View style={styles.rail}>
                  <View
                    style={[
                      styles.dot,
                      state === 'done' && styles.dotDone,
                      state === 'current' && styles.dotCurrent,
                      state === 'refused' && styles.dotRefused,
                    ]}
                  >
                    <Glyph
                      name={state === 'current' ? 'time' : (STEP_GLYPH[step.key] ?? 'ellipse')}
                      size={13}
                      color={
                        state === 'waiting'
                          ? ink[300]
                          : state === 'current'
                            ? colors.ink
                            : colors.surface
                      }
                    />
                  </View>
                  {!last && <View style={[styles.line, state === 'done' && styles.lineDone]} />}
                </View>

                <View
                  style={[
                    styles.stepBody,
                    state === 'done' && styles.stepBodyDone,
                    state === 'current' && styles.stepBodyCurrent,
                    state === 'refused' && styles.stepBodyRefused,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepLabel,
                      state === 'waiting' && styles.stepLabelWaiting,
                      state === 'refused' && styles.stepLabelRefused,
                    ]}
                  >
                    {step.label}
                  </Text>
                  <Text style={[styles.stepMeta, state === 'refused' && styles.stepMetaRefused]}>
                    {step.meta}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.sectionRow}>
          <View style={[styles.chipSmall, { backgroundColor: colors.info }]}>
            <Ionicons name="stats-chart" size={14} color={colors.surface} />
          </View>
          <Text style={styles.section}>{t('indents.quantities')}</Text>
        </View>

        <QtyRow
          icon={indent.breed ? STRAW_GLYPH : 'flask'}
          tone="info"
          label={t('indents.requested')}
          meta={breedLabel || indent.item}
          value={indent.qty_requested}
          testID="indent-qty-requested"
        />

        <QtyRow
          icon={rejected ? 'close-circle' : 'thumbs-up'}
          tone={rejected ? 'bad' : approvedReached ? 'good' : 'plain'}
          label={t('indents.approved')}
          meta={approvedReached ? breedLabel || indent.item : t('indents.notApprovedYet')}
          value={approvedReached ? indent.qty_requested : '—'}
          testID="indent-qty-approved"
        />

        {/* Where to go and get it — except when there is nothing to go and get. Amber and a
            depot name on a refused indent are both promises of a delivery. */}
        <QtyRow
          icon="storefront"
          tone={
            rejected
              ? 'plain'
              : issuedPending || collectable
                ? 'waiting'
                : indent.qty_issued > 0
                  ? 'good'
                  : 'plain'
          }
          label={t('indents.issuedSoFar')}
          meta={rejected ? t('indents.nothingToIssue') : depot}
          value={indent.qty_issued}
          testID="indent-qty-issued"
        />

        {/* One row per trip across the counter. The figures above are running totals, and an
            indent the store fills in two batches has to say which straws came when — or the
            Mait who collected 2 reads "5" and believes five went into the flask. */}
        {handovers.length > 0 && (
          <>
            <View style={[styles.sectionRow, styles.sectionSpaced]}>
              <View style={[styles.chipSmall, { backgroundColor: colors.primary }]}>
                <Ionicons name="swap-horizontal" size={14} color={colors.surface} />
              </View>
              <Text style={styles.section}>{t('indents.tripsTitle')}</Text>
            </View>
            {handovers.map(trip => (
              <QtyRow
                key={trip.id}
                icon={trip.collected_at ? 'checkmark-done' : 'time'}
                tone={trip.collected_at ? 'good' : 'waiting'}
                label={t('indents.tripLine', { qty: trip.qty, item: itemName })}
                meta={
                  trip.collected_at
                    ? t('indents.tripCollected', {
                        store: trip.store_name,
                        when: stamp(trip.collected_at),
                      })
                    : t('indents.tripWaiting', {
                        store: trip.store_name,
                        when: stamp(trip.issued_at),
                      })
                }
                value={`+${trip.qty}`}
                testID={`indent-trip-${trip.id}`}
              />
            ))}
          </>
        )}

        {/* Whichever it is, said in words. A button that cannot be pressed with nothing
            explaining why reads as a broken screen. */}
        {rejected ? (
          <FlowNotice
            tone="error"
            title={t('indents.rejectedTitle')}
            // The reason is on the trail and only on the trail. Repeating it here put the
            // same sentence on the screen twice, six inches apart, which reads as two
            // separate refusals rather than as one said clearly.
            body={t('indents.rejectedBody')}
            testID="indent-rejected"
          />
        ) : (
          <FlowNotice
            tone={collectable ? 'accent' : 'info'}
            title={
              indent.received_at
                ? t('indents.collectedTitle')
                : collectable
                  ? t('indents.collectionReadyTitle')
                  : t('indents.collectionTitle')
            }
            body={
              indent.received_at
                ? t('indents.collectedBody')
                : collectable
                  ? t('indents.collectionReadyBody')
                  : t('indents.collectionBody')
            }
            testID="indent-collection"
          />
        )}

        {partOpen && (
          <FlowNotice
            tone="accent"
            title={t('indents.partOpenTitle', { qty: indent.qty_open })}
            body={t('indents.partOpenBody')}
            pill={t('indents.state_part')}
            icon="time-outline"
            testID="indent-part-open"
          />
        )}
      </ScrollView>

      {/* Pinned rather than left at the end of the scroll: the step that is the Mait's own
          stays in view however long the timeline runs. Nothing competes with it here — the
          tab bar carries no action on this screen. */}
      <View style={[styles.action, { paddingBottom: spacing[3] + insets.bottom }]}>
        {/* The store's code, above the button it unlocks. Four wide cells' worth of one input,
            number pad only, because it is read aloud across a counter and typed by a thumb. */}
        {needsCode && (
          <View style={styles.codeWrap} testID="indent-code">
            <View style={[styles.chipSmall, { backgroundColor: yolk[500] }]}>
              <Ionicons name="keypad" size={16} color={colors.ink} />
            </View>
            <View style={styles.codeText}>
              <Text style={styles.codeLabel}>{t('indents.codeLabel')}</Text>
              <Text style={styles.codeHint}>
                {indent.store_name
                  ? t('indents.codeHint', { store: indent.store_name })
                  : t('indents.codeHintPlain')}
              </Text>
              {/* The code is never on this phone — a handset that knew it would prove nothing
                  — so a lost one comes from the counter, and the Mait needs telling that. */}
              <Text style={styles.codeHint} testID="indent-code-lost">
                {t('indents.codeLost')}
              </Text>
            </View>
            <TextInput
              value={code}
              onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="····"
              placeholderTextColor={colors.textDisabled}
              style={styles.codeInput}
              accessibilityLabel={t('indents.codeLabel')}
              testID="indent-code-input"
            />
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: !collectable || confirming || (needsCode && code.length < 4),
            busy: confirming,
          }}
          onPress={confirm}
          disabled={!collectable || confirming || (needsCode && code.length < 4)}
          style={({ pressed }) => [
            styles.cta,
            collectable ? styles.ctaReady : styles.ctaInert,
            pressed && collectable && styles.ctaPressed,
          ]}
          testID="indent-confirm-collection"
        >
          {confirming ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <>
              {collectable && <Ionicons name="checkmark" size={18} color={colors.surface} />}
              <Text style={[styles.ctaLabel, !collectable && styles.ctaLabelInert]}>
                {indent.received_at
                  ? t('indents.collectedLabel')
                  : rejected
                    ? t('indents.rejectedLabel')
                    : needsCode
                      ? t('indents.confirmQty', { qty: waitingQty })
                      : t('indents.confirmCollection')}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

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
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chip: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSmall: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.lg,
  },
  ctaReady: { backgroundColor: colors.primary },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaInert: { backgroundColor: colors.disabledFill },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  ctaLabelInert: { color: colors.textDisabled },
  // A glyph-free dot would carry the state in colour alone, so the label always says it too.
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.surface },
  heroDotGood: { backgroundColor: colors.primaryWash },
  heroDotWarn: { backgroundColor: colors.secondary },
  heroPillLabel: { ...typography.label, color: colors.surface },

  // Slate, the colour of a trail — what has happened to this indent, in order.
  timeline: {
    padding: spacing[3],
    marginBottom: spacing[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ink[100],
    backgroundColor: ink[50],
  },
  step: { flexDirection: 'row', gap: spacing[3] },
  rail: { alignItems: 'center', width: 26 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  // Yolk: this is the step the indent is sitting on, not one that has happened.
  dotCurrent: { backgroundColor: yolk[500], borderColor: yolk[500] },
  // Solid red, and the trail stops here.
  dotRefused: { backgroundColor: colors.error, borderColor: colors.error },
  line: { flex: 1, width: 2, backgroundColor: ink[200], marginVertical: 2 },
  lineDone: { backgroundColor: colors.primary },

  stepBody: {
    flex: 1,
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[100],
    backgroundColor: colors.surface,
  },
  stepBodyDone: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  stepBodyCurrent: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  stepBodyRefused: { backgroundColor: colors.errorWash, borderColor: colors.error },
  stepLabel: { ...typography.bodyStrong, color: colors.ink },
  stepLabelWaiting: { color: ink[400] },
  stepLabelRefused: { color: colors.error },
  stepMeta: { ...typography.caption, color: ink[500], marginTop: 2 },
  stepMetaRefused: { color: colors.error },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  section: { ...typography.h3, color: colors.ink },
  sectionSpaced: { marginTop: spacing[3] },

  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  qtyBody: { flex: 1 },
  qtyLabel: { ...typography.bodyStrong, color: colors.ink },
  qtyMeta: { ...typography.caption, marginTop: 2 },
  qtyBadge: {
    minWidth: 44,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  qtyValue: { ...typography.h3 },

  codeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: yolk[300],
    backgroundColor: colors.secondaryWash,
  },
  codeText: { flex: 1 },
  codeLabel: { ...typography.bodyStrong, color: colors.ink },
  codeHint: { ...typography.caption, color: yolk[800], marginTop: 2 },
  codeInput: {
    ...typography.h1,
    width: 112,
    minHeight: 54,
    textAlign: 'center',
    letterSpacing: 8,
    color: colors.ink,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },

  action: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
