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
 * A refusal is shown in the server's own words and the row is never removed on its own. The
 * commonest one is real and unfixable from here — an animal sold, a farmer moved to another
 * collection point, a straw already spent — and a Mait needs to be able to read it out to the
 * office. A refused record that quietly disappeared would be a day's work gone with no account
 * of where it went, which is the exact fear this screen exists to answer.
 *
 * But a refusal that will never be accepted — a duplicate registration, a record the office
 * has told the Mait to drop — would otherwise sit on this list for good, retrying forever. So a
 * refused row also offers *Remove*: a deliberate, confirmed delete that takes it off the phone.
 * It is never automatic and the confirm reminds the Mait to read the reason to the office first,
 * so the record is let go on purpose rather than lost.
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
import { Alert, StyleSheet, View } from 'react-native';
import AppText from '@/components/AppText';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { QueuedJob } from '@api/queue';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, OptionCard } from '../aiFlow/components';

/**
 * What a manual "Try all again" did, counted the way the rest of the screen counts — in
 * **records** (captures), not in the jobs a record is made of. A member's capture can queue two
 * or three jobs; reporting the jobs read "2 still waiting" over a list that showed one record,
 * which is exactly the disagreement this screen exists to avoid.
 */
export interface SyncSummary {
  /** Records that went up this drain. */
  sent: number;
  /** Records still on the phone after it — whatever they are waiting on. */
  remaining: number;
}

/**
 * The one line the finished sync leaves behind: how many records went, how many are still here.
 *
 * In the same unit as the header ("one record is on this phone") and the rows below, so the two
 * can never disagree. Returns `null` when there is nothing to say — an empty queue that sent
 * nothing — so the caller shows it only when it means something.
 */
export function syncSummaryLine(summary: SyncSummary, t: TFunction): string | null {
  const parts: string[] = [];
  if (summary.sent > 0) {
    parts.push(t('queue.summarySent', { n: summary.sent }));
  }
  if (summary.remaining > 0) {
    parts.push(t('queue.summaryWaiting', { n: summary.remaining }));
  }
  if (parts.length === 0) {
    return null;
  }
  return parts.join(' · ');
}

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
  /**
   * What the last manual "Try all again" did, shown once it has finished. Null before any manual
   * sync and while one is still running (the progress line speaks for that).
   */
  summary?: SyncSummary | null;
  /** Records already gone up, kept on screen so the list is the whole day, not the remainder. */
  synced: QueuedCapture[];
  onRetryAll: () => void;
  /** Put one refused capture back in the queue, once whatever it fell over has been fixed. */
  onRetryCapture: (capture: QueuedCapture) => void;
  /** Take one refused capture off the phone for good — for a refusal that will never be accepted. */
  onDiscardCapture: (capture: QueuedCapture) => void;
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

    // A non-member's payment waits on her code. A member's never does: she pays nothing in
    // the yard, the charge comes off her milk, and the queued job only records that — so it
    // is not something the Mait owes. Counting it as a code sent a member's capture to the
    // cash-and-UPI proof screen, which cannot close a member's AI however often it is tapped.
    if (job.kind === 'verifyPayment' && (job.label?.kind ?? capture.kind) !== 'member') {
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
  summary,
  synced,
  onRetryAll,
  onRetryCapture,
  onDiscardCapture,
  onEnterCode,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  // Deliberate and confirmed, never a swipe or a stray tap: the record is being let go for good,
  // so the Mait says so to a dialog that reminds them to read its reason to the office first.
  const confirmDiscard = (capture: QueuedCapture) => {
    Alert.alert(t('queue.removeTitle'), t('queue.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('queue.removeAction'),
        style: 'destructive',
        onPress: () => onDiscardCapture(capture),
      },
    ]);
  };

  // The finished-sync line, built only when a manual sync has run and nothing is in flight.
  const summaryLine = !progress && summary ? syncSummaryLine(summary, t) : null;
  // Green when the phone is empty, calm blue while records are still waiting on a network — not
  // alarm, because waiting for signal is nobody's problem to fix.
  const summaryClean = !!summary && summary.remaining === 0;

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
        ) : summaryLine ? (
          // The plain answer a Mait wants when the send stops: what went, what was refused, what
          // is still waiting. Green when all clear, amber when something needs a person.
          <FlowNotice
            tone={summaryClean ? 'good' : 'info'}
            title={t('queue.summaryHeading')}
            body={summaryLine}
            icon={summaryClean ? 'checkmark-circle-outline' : 'sync-outline'}
            testID="queue-summary"
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
              <AppText style={styles.reason} testID={`queue-rejected-${capture.clientUuid}`}>
                {capture.rejected || t('queue.rejectedNoReason')}
              </AppText>
              <AppText style={styles.reason}>{t('queue.rejectedWhatNow')}</AppText>
              <AppText
                style={styles.action}
                onPress={() => onRetryCapture(capture)}
                testID={`queue-retry-${capture.clientUuid}`}
              >
                {t('queue.tryThisAgain')}
              </AppText>
              {/* The quieter, deliberate way out, under the retry: for a refusal that will never
                  be accepted. Muted, not red — the red lives in the confirm's destructive button,
                  where the decision to let the record go is actually made. */}
              <AppText
                style={styles.remove}
                onPress={() => confirmDiscard(capture)}
                testID={`queue-remove-${capture.clientUuid}`}
              >
                {t('queue.removeThis')}
              </AppText>
            </View>
          )}

          {capture.needsCode && capture.rejected === undefined && (
            <View style={styles.attentionBody}>
              <AppText style={styles.reason}>{t('queue.codeNeverEntered')}</AppText>
              <AppText
                style={styles.action}
                onPress={() => onEnterCode(capture)}
                testID={`queue-enter-code-${capture.clientUuid}`}
              >
                {t('queue.enterTheCode')}
              </AppText>
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
  // Secondary to the retry above it: a plain muted link, no box, so letting the record go reads
  // as the deliberate smaller choice rather than a second button competing with Try again.
  remove: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingTop: spacing[3],
  },
});
