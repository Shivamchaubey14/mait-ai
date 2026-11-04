/**
 * Needs attention — everything on this Mait's phone that will not sort itself out.
 *
 * The phone holds four kinds of thing a person has to act on, and they used to live in two
 * places, one of them two taps from Home and one of them nowhere at all:
 *
 * - **Not accepted** — a record the server looked at and refused, with its reason. The waiting
 *   list showed these, mixed in among rows that only needed signal.
 * - **Payment code still owed** — a payment saved with no signal, whose authorisation code the
 *   farmer has yet to read back.
 * - **Office code not on record** — a farmer checked with no signal against a code the office
 *   has no record of giving (`api/fieldCode`). The insemination is recorded; what is owed is a
 *   call to the office, because either the office forgot to write it down or somebody made the
 *   code up. Nothing anywhere showed these before — the server flagged them and nobody saw.
 * - **Unfinished** — a capture stopped before its last step.
 *
 * Plus one line for what is merely waiting for signal, so a Mait asking "is anything still on
 * my phone?" gets the whole answer here, but kept to a line: it needs nobody.
 *
 * This is the Mait's list, not an office queue: every row says what *they* do next, and the
 * tap goes there.
 */

import React from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import AppText from '@/components/AppText';
import { useTranslation } from 'react-i18next';

import { useCancelAiEventMutation, useListAiEventsQuery } from '@api/endpoints';
import { localDay } from '@api/fieldCode';
import type { AIEvent } from '@api/types';
import { colors, spacing, typography } from '@theme/tokens';

import type { QueuedCapture } from '../history/SyncQueueScreen';
import { FlowLabel, FlowNotice, FlowScreen, FlowSpacer, initials, OptionCard } from './components';
import { resumePoint } from './resume';

/** How far back a flagged office code stays on the list — long enough to get to the office. */
export const UNMATCHED_DAYS = 30;

export interface Attention {
  refused: QueuedCapture[];
  needsCode: QueuedCapture[];
  unmatched: AIEvent[];
  unfinished: AIEvent[];
  /** Queued and needing nothing but signal. */
  waiting: number;
  /** What needs a person — everything above except `waiting`. */
  total: number;
  isFetching: boolean;
  refetch: () => void;
}

function since(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return localDay(at);
}

/**
 * The list, from the phone's queue and the server's two answers.
 *
 * A capture in the queue is not counted twice: the unfinished list is the server's, and an
 * event the server has is never also a queued capture still waiting to be created.
 */
export function useNeedsAttention(captures: QueuedCapture[], skip = false): Attention {
  const unfinishedQuery = useListAiEventsQuery({ unfinished: true }, { skip });
  const unmatchedQuery = useListAiEventsQuery(
    { farmerCheck: 'office_call_unmatched', dateFrom: since(UNMATCHED_DAYS) },
    { skip },
  );

  const refused = captures.filter(capture => capture.rejected !== undefined);
  const needsCode = captures.filter(capture => capture.needsCode && capture.rejected === undefined);
  const waiting = captures.length - refused.length - needsCode.length;
  const unmatched = unmatchedQuery.data?.results ?? [];
  // An event whose photo + finalize is already queued on the phone is NOT "photo not taken" —
  // the photo WAS taken and is waiting on a network. The server still reads `straw_verified`
  // (the finalize has not landed), but the capture is represented by its queued job, counted on
  // the "waiting for signal" line below. So it is dropped from the server's unfinished list
  // rather than shown there too, where it wrongly says "photo not taken" and, worse, sends a
  // Mait back to the camera to retake a photo they already have. Matched by the capture's
  // `client_uuid`, which both the queued job and the server event carry.
  const queuedUuids = new Set(captures.map(capture => capture.clientUuid));
  const unfinished = (unfinishedQuery.data?.results ?? []).filter(
    event => !queuedUuids.has(event.client_uuid ?? ''),
  );

  return {
    refused,
    needsCode,
    unmatched,
    unfinished,
    waiting,
    total: refused.length + needsCode.length + unmatched.length + unfinished.length,
    isFetching: unfinishedQuery.isFetching || unmatchedQuery.isFetching,
    refetch: () => {
      unfinishedQuery.refetch();
      unmatchedQuery.refetch();
    },
  };
}

interface Props {
  attention: Attention;
  /** The waiting list, where a refused record is tried again and the queue can be pushed. */
  onOpenQueue: () => void;
  onEnterCode: (capture: QueuedCapture) => void;
  onResume: (event: AIEvent) => void;
  onOpenEvent: (eventId: number) => void;
  onBack: () => void;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function NeedsAttentionScreen({
  attention,
  onOpenQueue,
  onEnterCode,
  onResume,
  onOpenEvent,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { refused, needsCode, unmatched, unfinished, waiting, total } = attention;
  const [cancelEvent, { isLoading: discarding }] = useCancelAiEventMutation();

  // Abandon a capture that will never be finished — the photo was never going to be taken, the
  // wrong animal was picked. Confirmed first; the server frees the held straw, and the list
  // refetches on its own (the mutation invalidates the AIEvent tag), so the row leaves.
  const confirmDiscard = (event: AIEvent) => {
    Alert.alert(t('unfinished.discardTitle'), t('unfinished.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('unfinished.discard'),
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelEvent({ id: event.id }).unwrap();
          } catch {
            Alert.alert(t('unfinished.discardFailedTitle'), t('unfinished.discardFailedBody'));
          }
        },
      },
    ]);
  };

  return (
    <FlowScreen
      step={null}
      eyebrow={t('attention.eyebrow')}
      title={t('attention.title')}
      subtitle={t('attention.subtitle')}
      onBack={onBack}
      refresh={{ refreshing: attention.isFetching, onRefresh: attention.refetch }}
      tabBarBelow
    >
      {total === 0 && (
        <FlowNotice
          tone="good"
          title={t('attention.allClearTitle')}
          body={t('attention.allClearBody')}
          testID="attention-empty"
        />
      )}

      {refused.length > 0 && (
        <View testID="attention-refused">
          <FlowLabel style={styles.heading}>{t('attention.refusedHeading')}</FlowLabel>
          {refused.map(capture => (
            <OptionCard
              key={capture.clientUuid}
              swatchLabel={initials(capture.farmer)}
              round
              title={capture.farmer || t('attention.aRecord')}
              // The server's own words: it is what the Mait reads out to the office.
              subtitle={capture.rejected || t('attention.refusedNoReason')}
              pill={t('attention.refusedPill')}
              pillTone="error"
              onPress={onOpenQueue}
              testID={`attention-refused-${capture.clientUuid}`}
            />
          ))}
        </View>
      )}

      {unmatched.length > 0 && (
        <View testID="attention-unmatched">
          <FlowLabel style={styles.heading}>{t('attention.unmatchedHeading')}</FlowLabel>
          <AppText style={styles.explain}>{t('attention.unmatchedBody')}</AppText>
          {unmatched.map(event => (
            <OptionCard
              key={event.id}
              swatchLabel={initials(event.owner_name)}
              round
              title={event.owner_name}
              subtitle={t('attention.unmatchedRow', {
                date: shortDate(event.performed_at ?? event.created_at),
                mpp: event.mpp_name,
              })}
              pill={t('attention.unmatchedPill')}
              pillTone="error"
              onPress={() => onOpenEvent(event.id)}
              testID={`attention-unmatched-${event.id}`}
            />
          ))}
        </View>
      )}

      {needsCode.length > 0 && (
        <View testID="attention-code">
          <FlowLabel style={styles.heading}>{t('attention.codeHeading')}</FlowLabel>
          {needsCode.map(capture => (
            <OptionCard
              key={capture.clientUuid}
              swatchLabel={initials(capture.farmer)}
              round
              title={capture.farmer}
              subtitle={
                capture.amount
                  ? t('attention.codeRowAmount', { amount: capture.amount, at: capture.at })
                  : t('attention.codeRow', { at: capture.at })
              }
              pill={t('attention.codePill')}
              pillTone="accent"
              onPress={() => onEnterCode(capture)}
              testID={`attention-code-${capture.clientUuid}`}
            />
          ))}
        </View>
      )}

      {unfinished.length > 0 && (
        <View testID="attention-unfinished">
          <FlowLabel style={styles.heading}>{t('attention.unfinishedHeading')}</FlowLabel>
          {unfinished.map(event => (
            <View key={event.id}>
              <OptionCard
                swatchLabel={initials(event.owner_name)}
                round
                title={event.owner_name}
                subtitle={shortDate(event.created_at)}
                pill={t(resumePoint(event).missingKey)}
                pillTone="accent"
                onPress={() => onResume(event)}
                testID={`attention-unfinished-${event.id}`}
              />
              {/* Finishing is the whole card (the obvious tap); discarding is the smaller,
                  deliberate one, pushed to the end so a thumb reaching for Resume never lands it. */}
              <View style={styles.discardRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: discarding }}
                  onPress={() => confirmDiscard(event)}
                  disabled={discarding}
                  hitSlop={spacing[2]}
                  testID={`attention-discard-${event.id}`}
                >
                  <AppText style={styles.discard}>{t('unfinished.discard')}</AppText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Not a problem, and so not in yolk or red: one grey line, for the Mait asking whether
          anything at all is still on the phone. */}
      {waiting > 0 && (
        <View testID="attention-waiting">
          <FlowLabel style={styles.heading}>{t('attention.waitingHeading')}</FlowLabel>
          <OptionCard
            icon="cloud-upload-outline"
            title={t('attention.waitingRow', { count: waiting })}
            subtitle={t('attention.waitingBody')}
            tone="neutral"
            onPress={onOpenQueue}
            testID="attention-waiting-row"
          />
        </View>
      )}

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: spacing[4], marginBottom: spacing[2] },
  explain: { ...typography.caption, color: colors.textMuted, marginBottom: spacing[3] },
  // The discard tucked under its row, pushed to the end — a footnote on that capture, not a
  // control competing with Resume.
  discardRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing[3],
    marginTop: -spacing[2],
    marginBottom: spacing[3],
  },
  discard: { ...typography.caption, color: colors.textMuted, textDecorationLine: 'underline' },
});
