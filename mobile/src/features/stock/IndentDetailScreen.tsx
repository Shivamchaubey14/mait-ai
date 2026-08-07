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
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useConfirmIndentCollectionMutation, useGetIndentQuery } from '@api/endpoints';
import type { Indent } from '@api/types';
import { Button } from '@/components';
import PageHero from '@/components/hero';
import { ErrorState, SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { FlowNotice } from '@/features/aiFlow/components';
import { shortDate, shortTime, statusTone } from '@/features/stock/IndentsScreen';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

type StepState = 'done' | 'current' | 'waiting';

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
  const { t } = useTranslation();
  const query = useGetIndentQuery(indentId);
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

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      onPress={onBack}
      style={styles.back}
      testID="indent-back"
    >
      <Ionicons name="arrow-back" size={18} color={colors.surface} />
    </Pressable>
  );

  if (query.isLoading || !indent) {
    return (
      <View style={styles.root}>
        <PageHero title={t('indents.one')} top={back} />
        <ScrollView contentContainerStyle={styles.body}>
          {query.isError ? (
            <ErrorState title={t('indents.errorTitle')} onRetry={() => query.refetch()} />
          ) : (
            <SkeletonList rows={4} />
          )}
        </ScrollView>
      </View>
    );
  }

  const status = statusTone(indent);

  // The server keeps no separate approved quantity: approval is of the whole request, so an
  // indent past `requested` had all of it approved. Shown as a dash until then rather than
  // as a number the office has not agreed to.
  const approvedReached = indent.status === 'approved' || indent.status === 'issued';

  const steps: { key: string; label: string; meta: string }[] = [
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

  const confirming = confirmation.isLoading;

  return (
    <View style={styles.root}>
      <Toast message={error} onDismiss={() => setError(null)} testID="indent-confirm-error" />

      <PageHero
        title={`IND-${indent.id}`}
        subtitle={t('indents.raisedOn', {
          item: indent.item,
          date: shortDate(indent.requested_at),
        })}
        top={back}
      >
        {/* The status rides in the hero, where the mockup puts it: it is the answer to the
            question that brought the Mait to this screen. */}
        <View style={styles.heroPill} testID="indent-status">
          <View
            style={[
              styles.heroDot,
              status.tone === 'good' && styles.heroDotGood,
              status.tone === 'warn' && styles.heroDotWarn,
            ]}
          />
          <Text style={styles.heroPillLabel}>{status.label}</Text>
        </View>
      </PageHero>

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
            const state = stateOf(indent, index + 1);
            const last = index === steps.length - 1;
            return (
              <View key={step.key} style={styles.step}>
                <View style={styles.rail}>
                  <View
                    style={[
                      styles.dot,
                      state === 'done' && styles.dotDone,
                      state === 'current' && styles.dotCurrent,
                    ]}
                  />
                  {!last && <View style={[styles.line, state === 'done' && styles.lineDone]} />}
                </View>

                <View style={styles.stepBody}>
                  <Text style={[styles.stepLabel, state === 'waiting' && styles.stepLabelWaiting]}>
                    {step.label}
                  </Text>
                  <Text style={styles.stepMeta}>{step.meta}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <Text style={styles.section}>{t('indents.quantities')}</Text>

        <View style={styles.qtyRow} testID="indent-qty-requested">
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.requested')}</Text>
            <Text style={styles.qtyMeta}>{indent.breed || indent.item}</Text>
          </View>
          <Text style={styles.qtyValue}>{indent.qty_requested}</Text>
        </View>

        <View style={styles.qtyRow} testID="indent-qty-approved">
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.approved')}</Text>
            <Text style={styles.qtyMeta}>
              {approvedReached ? indent.breed || indent.item : t('indents.notApprovedYet')}
            </Text>
          </View>
          <Text style={[styles.qtyValue, !approvedReached && styles.qtyValueMuted]}>
            {approvedReached ? indent.qty_requested : '—'}
          </Text>
        </View>

        <View
          style={[styles.qtyRow, indent.qty_issued === 0 && styles.qtyRowWaiting]}
          testID="indent-qty-issued"
        >
          <View style={styles.qtyBody}>
            <Text style={styles.qtyLabel}>{t('indents.issuedSoFar')}</Text>
            <Text style={styles.qtyMeta}>{t('indents.collectAtMpp')}</Text>
          </View>
          <Text style={[styles.qtyValue, indent.qty_issued === 0 && styles.qtyValueWaiting]}>
            {indent.qty_issued}
          </Text>
        </View>

        {/* Whichever it is, said in words. A button that cannot be pressed with nothing
            explaining why reads as a broken screen. */}
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
      <View style={styles.action}>
        <Button
          label={indent.received_at ? t('indents.collectedLabel') : t('indents.confirmCollection')}
          onPress={confirm}
          disabled={!collectable || confirming}
          loading={confirming}
          testID="indent-confirm-collection"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },

  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    alignSelf: 'flex-start',
    marginTop: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
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
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: colors.primary },

  stepBody: { flex: 1, paddingBottom: spacing[4] },
  stepLabel: { ...typography.bodyStrong, color: colors.ink },
  stepLabelWaiting: { color: colors.textMuted },
  stepMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

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
