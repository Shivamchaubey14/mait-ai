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
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { FlowNotice } from '@/features/aiFlow/components';
import { shortDate, shortTime, statusTone } from '@/features/stock/IndentsScreen';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

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
          <View style={styles.heroPill} testID="indent-status">
            <Text style={styles.heroPillLabel}>{status.label}</Text>
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
        <View style={styles.timeline}>
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
                  />
                  {!last && <View style={[styles.line, state === 'done' && styles.lineDone]} />}
                </View>

                <View style={styles.stepBody}>
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

        <Text style={styles.section}>{t('indents.quantities')}</Text>

        <View style={styles.qtyRow} testID="indent-qty-requested">
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.requested')}</Text>
            <Text style={styles.qtyMeta}>{breedLabel || indent.item}</Text>
          </View>
          <Text style={styles.qtyValue}>{indent.qty_requested}</Text>
        </View>

        <View style={styles.qtyRow} testID="indent-qty-approved">
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.approved')}</Text>
            <Text style={styles.qtyMeta}>
              {approvedReached ? breedLabel || indent.item : t('indents.notApprovedYet')}
            </Text>
          </View>
          <Text style={[styles.qtyValue, !approvedReached && styles.qtyValueMuted]}>
            {approvedReached ? indent.qty_requested : '—'}
          </Text>
        </View>

        <View
          style={[styles.qtyRow, issuedPending && styles.qtyRowWaiting]}
          testID="indent-qty-issued"
        >
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.issuedSoFar')}</Text>
            {/* Where to go and get it — except when there is nothing to go and get. Amber and
                a depot name on a refused indent are both promises of a delivery. */}
            <Text style={styles.qtyMeta}>{rejected ? t('indents.nothingToIssue') : depot}</Text>
          </View>
          <Text style={[styles.qtyValue, issuedPending && styles.qtyValueWaiting]}>
            {indent.qty_issued}
          </Text>
        </View>

        {/* One row per trip across the counter. The figures above are running totals, and an
            indent the store fills in two batches has to say which straws came when — or the
            Mait who collected 2 reads "5" and believes five went into the flask. */}
        {handovers.length > 0 && (
          <>
            <Text style={[styles.section, styles.sectionSpaced]}>{t('indents.tripsTitle')}</Text>
            {handovers.map(trip => (
              <View key={trip.id} style={styles.qtyRow} testID={`indent-trip-${trip.id}`}>
                <View style={styles.qtyBody}>
                  <Text style={styles.qtyLabel}>
                    {t('indents.tripLine', { qty: trip.qty, item: itemName })}
                  </Text>
                  <Text style={styles.qtyMeta}>
                    {trip.collected_at
                      ? t('indents.tripCollected', {
                          store: trip.store_name,
                          when: stamp(trip.collected_at),
                        })
                      : t('indents.tripWaiting', {
                          store: trip.store_name,
                          when: stamp(trip.issued_at),
                        })}
                  </Text>
                </View>
                <Text
                  style={[styles.qtyValue, !trip.collected_at && styles.qtyValueWaiting]}
                >{`+${trip.qty}`}</Text>
              </View>
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
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
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

  timeline: { marginBottom: spacing[5] },
  step: { flexDirection: 'row', gap: spacing[3] },
  rail: { alignItems: 'center', width: 18 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  // Hollow yellow: this is the step the indent is sitting on, not one that has happened.
  dotCurrent: { borderColor: colors.secondary, backgroundColor: colors.surface },
  // Solid red, and the trail stops here. A hollow dot would read as a step still to come.
  dotRefused: { backgroundColor: colors.error, borderColor: colors.error },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: colors.primary },

  stepBody: { flex: 1, paddingBottom: spacing[4] },
  stepLabel: { ...typography.bodyStrong, color: colors.ink },
  stepLabelWaiting: { color: colors.textMuted },
  stepLabelRefused: { color: colors.error },
  stepMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  stepMetaRefused: { color: colors.error },

  section: { ...typography.h3, color: colors.ink, marginBottom: spacing[3] },
  sectionSpaced: { marginTop: spacing[3] },

  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  qtyRowWaiting: { backgroundColor: colors.secondaryWash },
  qtyBody: { flex: 1 },
  qtyLabel: { ...typography.bodyStrong, color: colors.ink },
  qtyMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  qtyValue: { ...typography.h2, color: colors.ink },
  qtyValueMuted: { color: colors.textDisabled },
  qtyValueWaiting: { color: colors.secondaryPressed },

  codeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  codeText: { flex: 1 },
  codeLabel: { ...typography.bodyStrong, color: colors.ink },
  codeHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  codeInput: {
    ...typography.h1,
    width: 132,
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
