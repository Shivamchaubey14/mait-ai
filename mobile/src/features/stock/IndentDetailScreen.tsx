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
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

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

function stateOf(indent: Indent, step: number): StepState {
  // requested → approved → issued → received. Collection is the Mait's own step, and the
  // only one that moves without the office doing anything.
  if (indent.received_at) {
    return 'done';
  }
  const reached =
    indent.status === 'issued'
      ? 3
      : indent.status === 'approved'
        ? 2
        : indent.status === 'rejected'
          ? 1
          : 1;
  if (step < reached) {
    return 'done';
  }
  if (step === reached) {
    // Issued is finished business for the depot; what is open is the collection after it.
    return indent.status === 'issued' && step === 3 ? 'done' : 'current';
  }
  // The step immediately after issue is the one waiting on the Mait, so it reads as current
  // rather than as something still to be done to them.
  return indent.status === 'issued' && step === 4 ? 'current' : 'waiting';
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

  const confirm = async () => {
    setError(null);
    try {
      await confirmCollection(indentId).unwrap();
    } catch {
      // The server owns the rule — stock not issued yet, or already confirmed. Saying so
      // beats a button that appears to do nothing.
      setError(t('indents.confirmFailed'));
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

  const plants = Array.from(
    new Set((mpps.data?.results ?? []).map(mpp => mpp.plant_name).filter(Boolean)),
  );
  const depot =
    plants.length === 1
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
            ? t('indents.stepApprovedMeta', { qty: indent.qty_requested })
            : t('indents.stepApprovedWaiting'),
        },
        {
          key: 'issued',
          label: t('indents.stepIssued'),
          meta:
            indent.status === 'issued'
              ? [stamp(indent.issued_at), t('indents.stepIssuedMeta', { qty: indent.qty_issued })]
                  .filter(Boolean)
                  .join(' · ')
              : t('indents.stepIssuedWaiting'),
        },
        {
          key: 'received',
          label: t('indents.stepReceived'),
          meta: indent.received_at
            ? (stamp(indent.received_at) ?? t('indents.stepReceivedDone'))
            : indent.status === 'issued'
              ? t('indents.stepReceivedReady')
              : t('indents.stepReceivedWaiting'),
        },
      ];

  const collectable = indent.status === 'issued' && !indent.received_at;
  const issuedPending = indent.qty_issued === 0 && !rejected;

  const confirming = confirmation.isLoading;

  return (
    <View style={styles.root}>
      <Toast message={error} onDismiss={() => setError(null)} testID="indent-confirm-error" />

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

        {indent.sync_status === 'failed' && (
          <FlowNotice
            tone="error"
            title={t('indents.notSyncedTitle')}
            body={t('indents.notSyncedBody')}
            testID="indent-not-synced"
          />
        )}
      </ScrollView>

      {/* Pinned rather than left at the end of the scroll: the step that is the Mait's own
          stays in view however long the timeline runs. Nothing competes with it here — the
          tab bar carries no action on this screen. */}
      <View style={[styles.action, { paddingBottom: spacing[3] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !collectable || confirming, busy: confirming }}
          onPress={confirm}
          disabled={!collectable || confirming}
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

  action: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
