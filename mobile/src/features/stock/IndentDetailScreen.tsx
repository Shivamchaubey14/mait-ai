/**
 * One indent, and where it has got to.
 *
 * The timeline is the point of the screen. A Mait asking "is my stock coming" is really
 * asking which of four things has happened, and a status word alone does not answer that —
 * "approved" tells them the office agreed, not whether the depot has packed anything.
 *
 * The last step is theirs: stock is only really theirs once collected, and confirming that is
 * how the count on the Stock screen changes.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useGetIndentQuery } from '@api/endpoints';
import type { Indent } from '@api/types';
import { ErrorState, SkeletonList } from '@/components/states';
import { FlowNotice, FlowScreen, FlowSpacer } from '@/features/aiFlow/components';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

type StepState = 'done' | 'current' | 'waiting';

function stateOf(indent: Indent, step: number): StepState {
  // requested → approved → issued → received. `received` has no server field yet, so an
  // issued indent shows collection as the step still open rather than claiming it happened.
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
    return indent.status === 'issued' && step === 3 ? 'done' : 'current';
  }
  return 'waiting';
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

  if (query.isLoading || !indent) {
    return (
      <FlowScreen
        step={null}
        stepLabel={t('indents.label')}
        title={t('indents.one')}
        onBack={onBack}
      >
        {query.isError ? (
          <ErrorState title={t('indents.errorTitle')} onRetry={() => query.refetch()} />
        ) : (
          <SkeletonList rows={4} />
        )}
        <FlowSpacer />
      </FlowScreen>
    );
  }

  const steps: { key: string; label: string; meta: string }[] = [
    {
      key: 'requested',
      label: t('indents.stepRequested'),
      meta: t('indents.stepRequestedMeta', { qty: indent.qty_requested }),
    },
    {
      key: 'approved',
      label: t('indents.stepApproved'),
      meta:
        indent.status === 'requested'
          ? t('indents.stepApprovedWaiting')
          : t('indents.stepApprovedMeta', { qty: indent.qty_requested }),
    },
    {
      key: 'issued',
      label: t('indents.stepIssued'),
      meta:
        indent.status === 'issued'
          ? t('indents.stepIssuedMeta', { qty: indent.qty_issued })
          : t('indents.stepIssuedWaiting'),
    },
    {
      key: 'received',
      label: t('indents.stepReceived'),
      meta: t('indents.stepReceivedWaiting'),
    },
  ];

  return (
    <FlowScreen
      step={null}
      stepLabel={t('indents.label')}
      title={`IND-${indent.id}`}
      subtitle={t('indents.raisedOn', {
        item: indent.item,
        date: new Date(indent.requested_at).toDateString().slice(4, 10),
      })}
      onBack={onBack}
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

      <View style={styles.qtyRow}>
        <View style={styles.qtyBody}>
          <Text style={styles.qtyLabel}>{t('indents.requested')}</Text>
          <Text style={styles.qtyMeta}>{indent.item}</Text>
        </View>
        <Text style={styles.qtyValue}>{indent.qty_requested}</Text>
      </View>

      <View style={[styles.qtyRow, indent.qty_issued === 0 && styles.qtyRowWaiting]}>
        <View style={styles.qtyBody}>
          <Text style={styles.qtyLabel}>{t('indents.issuedSoFar')}</Text>
          <Text style={styles.qtyMeta}>{t('indents.collectAtMpp')}</Text>
        </View>
        <Text style={[styles.qtyValue, indent.qty_issued === 0 && styles.qtyValueWaiting]}>
          {indent.qty_issued}
        </Text>
      </View>

      {/* Stated rather than left as a disabled button with no explanation. */}
      <FlowNotice
        tone="info"
        title={t('indents.collectionTitle')}
        body={t('indents.collectionBody')}
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

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
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
  qtyValueWaiting: { color: colors.secondaryPressed },
});
