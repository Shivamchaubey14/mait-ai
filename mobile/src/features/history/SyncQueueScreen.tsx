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
 * *Synced* has reached the server. *Syncing* is on its way. *Waiting* is queued behind a
 * network. Two states are the Mait's problem and carry a button, because they are the two the
 * app cannot finish on its own: *Needs attention* is a payment whose code the farmer never
 * read back, and *Not accepted* is the server having looked at a record and refused it.
 *
 * A refusal is shown in the server's own words and the row is never removed. The commonest
 * one is real and unfixable from here — an animal sold, a farmer moved to another collection
 * point, a straw already spent — and a Mait needs to be able to read it out to the office. A
 * refused record that quietly disappeared would be a day's work gone with no account of where
 * it went, which is the exact fear this screen exists to answer.
 *
 * Nothing here has to be tapped. The queue drains itself the moment the handset finds signal
 * (see the NetInfo listener in navigation), and this screen exists for the Mait who wants to
 * watch it happen, or to push it along at the edge of a village.
 *
 * Four states on the rows, not three: *Waiting* is the ordinary one and *Syncing* belongs only
 * to the capture actually in flight. Marking every queued row as syncing was a lie a Mait can
 * catch — a day's records all claiming to be moving while the count under them sits still —
 * and the screen's whole job is to be believed.
 *
 * The reassurance stays put. The hero, the progress line and the retry button are fixed and
 * only the rows scroll, so a Mait working down twenty of them can still see what is being sent
 * and can still reach the button without scrolling back up for it.
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
  /**
   * What this row is, where it is not an insemination.
   *
   * A Mait registers a farmer and her cow in the same yard as the capture, so on a bad
   * afternoon the list holds three rows bearing one name. Without this they all read as
   * inseminations, and a Mait counting their day would count three.
   */
  kindOfRow?: 'registration' | 'animal';
  /** The one thing the app cannot do for them: the farmer's payment code. */
  needsCode: boolean;
  /** Being sent right now. */
  sending: boolean;
  /**
   * The server looked at this and refused it, and said why.
   *
   * Held as the reason rather than a flag, because the reason is the whole value: "This
   * animal is not registered to that farmer" tells a Mait what to ring the office about, and
   * a red pill on its own tells them to try again forever.
   */
  rejected?: string;
}

interface Props {
  captures: QueuedCapture[];
  /** How far a drain in progress has got — `2 of 3`. Null when nothing is being sent. */
  progress: { done: number; total: number } | null;
  /** Records already gone up, kept on screen so the list is the whole day, not the remainder. */
  synced: QueuedCapture[];
  onRetryAll: () => void;
  /** Put one refused capture back in the queue, once whatever it fell over has been fixed. */
  onRetryCapture: (capture: QueuedCapture) => void;
  onEnterCode: (capture: QueuedCapture) => void;
  onBack: () => void;
}

/**
 * Group the raw jobs into one row per capture — a Mait thinks in inseminations, not in jobs.
 *
 * Each field is taken from the first job that actually carries it, rather than from the first
 * job outright. One capture queues several jobs and they do not all know the same things: the
 * photo is queued before a payment has a mode, so reading the whole row off the earliest job
 * would report a UPI payment as cash for the rest of the day.
 */
export function toCaptures(jobs: QueuedJob[], sendingUuid?: string | null): QueuedCapture[] {
  const byCapture = new Map<string, QueuedCapture>();
  jobs.forEach(job => {
    const label = job.label;
    const capture: QueuedCapture = byCapture.get(job.clientUuid) ?? {
      clientUuid: job.clientUuid,
      farmer: '',
      kind: 'member',
      amount: null,
      at: '',
      needsCode: false,
      sending: false,
    };

    // The first refusal on the capture is the one that stopped it; the jobs behind it never
    // went out at all, so a later one would be a reason for something that never happened.
    if (job.failed && !capture.rejected) {
      capture.rejected = job.lastError || '';
    }

    // First non-empty wins, so the earliest job still decides the time the capture happened
    // and a later one can only fill in what was missing.
    if (label) {
      capture.farmer ||= label.farmer;
      capture.at ||= label.at;
      capture.amount ??= label.amount ?? null;
      capture.mode ??= label.mode;
      capture.kindOfRow ??= label.kindOfRow;
      if (label.kind) {
        capture.kind = label.kind;
      }
    }
    capture.eventId ??= label?.eventId ?? (job.payload.eventId as number | undefined);

    if (job.kind === 'verifyPayment') {
      capture.needsCode = true;
    }
    capture.sending = capture.sending || job.clientUuid === sendingUuid;
    byCapture.set(job.clientUuid, capture);
  });
  // The ones that need a person come first: everything else is the network's problem, and
  // the network sorts itself out. A refusal outranks a missing code — one is a record that
  // will never land without somebody, the other is a record that has landed and is owed a
  // number.
  const weight = (capture: QueuedCapture) =>
    (capture.rejected !== undefined ? 2 : 0) + Number(capture.needsCode);
  return [...byCapture.values()].sort((a, b) => weight(b) - weight(a));
}

/**
 * Which of the four words a waiting row carries.
 *
 * The two that ask for a person win, because they are the only ones a Mait can do anything
 * about — and a refusal wins over a missing code, because it is the one that will never
 * resolve itself. After that the only question is whether this capture is the one on the wire
 * right now.
 */
function status(capture: QueuedCapture): string {
  if (capture.rejected !== undefined) {
    return 'queue.notAccepted';
  }
  if (capture.needsCode) {
    return 'queue.needsAttention';
  }
  return capture.sending ? 'queue.syncing' : 'queue.waiting';
}

function subtitle(capture: QueuedCapture, t: TFunction): string {
  // What the row is, before who it is about. A registration and an insemination for the same
  // farmer are two different things waiting, and the list has to say which is which.
  const who = capture.kindOfRow
    ? t(capture.kindOfRow === 'registration' ? 'queue.aRegistration' : 'queue.anAnimal')
    : t(capture.kind === 'member' ? 'aiFlow.member' : 'aiFlow.nonMember');
  const money =
    capture.amount && capture.kind === 'nonMember'
      ? `₹ ${Math.round(Number(capture.amount))} ${t(
          capture.mode === 'ONLINE' ? 'payment.upi' : 'payment.cash',
        ).toLowerCase()}`
      : '';
  // Joined rather than concatenated, so a capture queued before its time was known reads
  // "Member" and not "Member · " with a separator hanging off the end of it.
  return [who, money, capture.at].filter(Boolean).join(' · ');
}

export default function SyncQueueScreen({
  captures,
  progress,
  synced,
  onRetryAll,
  onRetryCapture,
  onEnterCode,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const needing = captures.filter(
    capture => capture.needsCode || capture.rejected !== undefined,
  ).length;
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
      // The one screen wearing the flow's frame that is not a step, so the one that can carry
      // a pull. Retrying is exactly what a pull means here: these records are waiting on a
      // network, and pulling is how a Mait asks again.
      pull={{ label: t('pull.waiting'), onRefresh: onRetryAll }}
      tabBarBelow
      cta={
        captures.length > 0
          ? { label: t('queue.tryAllAgain'), onPress: onRetryAll, testID: 'queue-retry-all' }
          : undefined
      }
      /* Pinned under the hero rather than sitting at the top of the list. A count moving is the
         difference between "it is working" and "it is stuck", and it is worth least at the one
         moment it used to disappear — when the Mait scrolls down to see how much is left. */
      stickyTop={
        progress ? (
          <FlowNotice
            tone="info"
            body={t('queue.sendingProgress', { done: progress.done, total: progress.total })}
            icon="sync-outline"
            testID="queue-progress"
          />
        ) : undefined
      }
    >
      {captures.map(capture => (
        <View
          key={capture.clientUuid}
          style={capture.needsCode || capture.rejected !== undefined ? styles.attention : undefined}
        >
          <OptionCard
            swatch={false}
            title={capture.farmer || t('queue.unnamedCapture')}
            subtitle={subtitle(capture, t)}
            pill={t(status(capture))}
            /* Green only while it is genuinely moving. A row that is merely queued gets the
               grey, because on a list of ten the colour is what a Mait reads first and it
               should point at the one thing happening. */
            pillTone={
              capture.rejected !== undefined
                ? 'error'
                : capture.needsCode
                  ? 'accent'
                  : capture.sending
                    ? 'primary'
                    : 'muted'
            }
            testID={`queue-${capture.clientUuid}`}
          />

          {/* The server's own sentence, and the one thing left to do about it. Retrying is
              offered rather than done: nothing here will send until whatever the server
              objected to has been fixed, and a row that retried itself would be a Mait told
              hourly that their record still does not work. */}
          {capture.rejected !== undefined && (
            <View style={styles.attentionBody}>
              <Text style={styles.reason} testID={`queue-rejected-${capture.clientUuid}`}>
                {capture.rejected || t('queue.rejectedNoReason')}
              </Text>
              <Text style={styles.reason}>{t('queue.rejectedWhatNow')}</Text>
              <Text
                style={styles.action}
                onPress={() => onRetryCapture(capture)}
                testID={`queue-retry-${capture.clientUuid}`}
              >
                {t('queue.tryThisAgain')}
              </Text>
            </View>
          )}

          {capture.needsCode && capture.rejected === undefined && (
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
