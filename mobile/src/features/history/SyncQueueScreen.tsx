/**
 * Waiting to sync (S7) — what is still on this phone, and what to do about it.
 *
 * Reached from the yellow tile on Home, which until now only kicked a drain and gave no
 * account of itself. A Mait who can see a number but not the records behind it has no way to
 * tell "the network is bad" from "I have lost a day's work", and the second fear is the one
 * that makes people re-capture inseminations that were never lost.
 *
 * So the title is the reassurance, and the list is the evidence: **nothing here is lost.**
 *
 * Three states, and only one of them is the Mait's problem. *Synced* has reached the server.
 * *Syncing* is on its way. *Needs attention* is the one case the app cannot finish alone — a
 * payment whose code the farmer never read back — and it is the only row that carries a
 * button, because it is the only row a Mait can act on.
 *
 * Nothing here has to be tapped. The queue drains itself the moment the handset finds signal
 * (see the NetInfo listener in navigation), and this screen exists for the Mait who wants to
 * watch it happen, or to push it along at the edge of a village.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { QueuedJob } from '@api/queue';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, OptionCard } from '../aiFlow/components';

/** One capture, however many jobs it is waiting on. */
export interface QueuedCapture {
  clientUuid: string;
  farmer: string;
  kind: 'member' | 'nonMember';
  amount?: string | null;
  mode?: 'COD' | 'ONLINE';
  at: string;
  eventId?: number;
  /** The one thing the app cannot do for them: the farmer's payment code. */
  needsCode: boolean;
  /** Being sent right now. */
  sending: boolean;
}

interface Props {
  captures: QueuedCapture[];
  /** How far a drain in progress has got — `2 of 3`. Null when nothing is being sent. */
  progress: { done: number; total: number } | null;
  /** Records already gone up, kept on screen so the list is the whole day, not the remainder. */
  synced: QueuedCapture[];
  onRetryAll: () => void;
  onEnterCode: (capture: QueuedCapture) => void;
  onBack: () => void;
}

/** Group the raw jobs into one row per capture — a Mait thinks in inseminations, not in jobs. */
export function toCaptures(jobs: QueuedJob[], sendingUuid?: string | null): QueuedCapture[] {
  const byCapture = new Map<string, QueuedCapture>();
  jobs.forEach(job => {
    const label = job.label;
    const existing = byCapture.get(job.clientUuid);
    const capture: QueuedCapture = existing ?? {
      clientUuid: job.clientUuid,
      farmer: label?.farmer ?? '',
      kind: label?.kind ?? 'member',
      amount: label?.amount ?? null,
      mode: label?.mode,
      at: label?.at ?? '',
      eventId: label?.eventId ?? (job.payload.eventId as number | undefined),
      needsCode: false,
      sending: false,
    };
    if (job.kind === 'verifyPayment') {
      capture.needsCode = true;
    }
    capture.sending = capture.sending || job.clientUuid === sendingUuid;
    byCapture.set(job.clientUuid, capture);
  });
  // The ones that need a person come first: everything else is the network's problem.
  return [...byCapture.values()].sort((a, b) => Number(b.needsCode) - Number(a.needsCode));
}

function subtitle(capture: QueuedCapture, t: TFunction): string {
  const who = t(capture.kind === 'member' ? 'aiFlow.member' : 'aiFlow.nonMember');
  const money =
    capture.amount && capture.kind === 'nonMember'
      ? ` · ₹ ${Math.round(Number(capture.amount))} ${t(
          capture.mode === 'ONLINE' ? 'payment.upi' : 'payment.cash',
        ).toLowerCase()}`
      : '';
  return `${who}${money} · ${capture.at}`;
}

export default function SyncQueueScreen({
  captures,
  progress,
  synced,
  onRetryAll,
  onEnterCode,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const needing = captures.filter(capture => capture.needsCode).length;
  const total = captures.length + synced.length;

  return (
    <FlowScreen
      step={null}
      eyebrow={t('queue.eyebrow')}
      title={t('queue.nothingIsLost')}
      // Two sentences, two keys: how many are here, and how many want a person. One key
      // cannot pluralise on two different numbers, and a Hindi translator should not have to
      // write four variants of a sentence to say it.
      subtitle={
        t('queue.subtitle', { count: total }) +
        (needing > 0 ? ' ' + t('queue.needsYou', { count: needing }) : '')
      }
      onBack={onBack}
      cta={
        captures.length > 0
          ? { label: t('queue.tryAllAgain'), onPress: onRetryAll, testID: 'queue-retry-all' }
          : undefined
      }
    >
      {/* Progress, where there is any. A count moving is the difference between "it is working"
          and "it is stuck", and on one bar of signal that difference takes a minute to show. */}
      {!!progress && (
        <FlowNotice
          tone="info"
          body={t('queue.sendingProgress', { done: progress.done, total: progress.total })}
          icon="sync-outline"
          testID="queue-progress"
        />
      )}

      {captures.map(capture => (
        <View key={capture.clientUuid} style={capture.needsCode ? styles.attention : undefined}>
          <OptionCard
            swatch={false}
            title={capture.farmer || t('queue.unnamedCapture')}
            subtitle={subtitle(capture, t)}
            pill={t(capture.needsCode ? 'queue.needsAttention' : 'queue.syncing')}
            pillTone={capture.needsCode ? 'accent' : 'primary'}
            testID={`queue-${capture.clientUuid}`}
          />

          {capture.needsCode && (
            <View style={styles.attentionBody}>
              <Text style={styles.reason}>{t('queue.codeNeverEntered')}</Text>
              <Text
                style={styles.action}
                onPress={() => onEnterCode(capture)}
                testID={`queue-enter-code-${capture.clientUuid}`}
              >
                {t('queue.enterTheCode')}
              </Text>
            </View>
          )}
        </View>
      ))}

      {/* Kept on the list rather than disappearing: a Mait counting their day wants the whole
          round, and a record that vanishes the moment it lands looks like one that was lost. */}
      {synced.map(capture => (
        <OptionCard
          key={capture.clientUuid}
          swatch={false}
          title={capture.farmer || t('queue.unnamedCapture')}
          subtitle={subtitle(capture, t)}
          pill={t('queue.synced')}
          testID={`queue-synced-${capture.clientUuid}`}
        />
      ))}

      {captures.length === 0 && synced.length === 0 && (
        <FlowNotice
          tone="good"
          title={t('queue.allSent')}
          body={t('queue.allSentBody')}
          testID="queue-empty"
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // A red surround rather than a red row: the record is fine, and it is the thing missing from
  // it that is wrong. Colouring the whole card would read as a failed insemination.
  attention: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.lg,
    backgroundColor: colors.errorWash,
    padding: spacing[2],
    marginBottom: spacing[3],
    ...shadows.card,
  },
  attentionBody: { paddingHorizontal: spacing[3], paddingBottom: spacing[2] },
  reason: { ...typography.caption, color: colors.error, marginBottom: spacing[3] },
  action: {
    ...typography.bodyStrong,
    color: colors.error,
    textAlign: 'center',
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
});
