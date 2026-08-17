/**
 * Everything still owed a finish (SRS §6.3, C13).
 *
 * A capture is six steps and four of them write to the server, so it can be abandoned in four
 * different places — a farmer walks off, a phone dies, a Mait is called to the next yard. Home
 * used to admit to exactly one of those: a single line, only for a straw scanned today whose
 * photo never arrived, and tapping it always dropped the Mait at the camera. Everything else
 * simply disappeared. An event stopped one tap short of its payment looked, from the app, like
 * an event that had never happened.
 *
 * That is the worst kind of missing record, because the work was done: the animal was served
 * and a straw was spent. So this screen lists all of them, says what each is actually waiting
 * for, and puts the Mait back at the step it stopped on rather than at the start.
 *
 * Not the same list as the waiting-to-sync queue, and deliberately kept apart. A queued record
 * is finished work held up by a network — nothing is owed and nobody has to do anything. These
 * are owed something by the person reading the screen.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListAiEventsQuery } from '@api/endpoints';
import type { AIEvent } from '@api/types';
import { AI_FLOW_STEPS } from '@/config/env';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, FlowSpacer, initials, OptionCard } from './components';
import { resumePoint, resumeTone } from './resume';

interface Props {
  onResume: (event: AIEvent) => void;
  onBack: () => void;
}

/** "10:42" — the clock, because these are all from the round in progress. */
function clock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function UnfinishedScreen({ onResume, onBack }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { data, isLoading, isError, isFetching, refetch } = useListAiEventsQuery({
    unfinished: true,
  });

  const events = data?.results ?? [];

  return (
    <FlowScreen
      step={null}
      eyebrow={t('unfinished.eyebrow')}
      title={t('unfinished.title')}
      subtitle={t('unfinished.subtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !isLoading, onRefresh: refetch }}
      tabBarBelow
    >
      {isLoading && <FlowNotice tone="info" title={t('common.loading')} />}
      {isError && <FlowNotice tone="error" title={t('errors.generic')} testID="unfinished-error" />}

      {!isLoading && !isError && events.length === 0 && (
        // Green, and said as an answer rather than as an absence. A Mait opening this screen
        // is checking whether they have left anything behind; "nothing" is the good news.
        <FlowNotice
          tone="good"
          title={t('unfinished.allDoneTitle')}
          body={t('unfinished.allDoneBody')}
          testID="unfinished-empty"
        />
      )}

      {events.map(event => {
        const point = resumePoint(event);
        const animal = event.ear_tag_no
          ? t('aiFlow.animalWithTag', {
              type: t(`aiFlow.animalType.${event.animal_type}`),
              tag: event.ear_tag_no,
            })
          : t('aiFlow.noEarTag', { type: t(`aiFlow.animalType.${event.animal_type}`) });

        return (
          <View key={event.id}>
            <OptionCard
              swatchLabel={initials(event.owner_name)}
              round
              title={event.owner_name}
              subtitle={`${animal} · ${clock(event.created_at)}`}
              // What it is waiting for, in the pill, because that is the reason the row is
              // here and the thing that decides where tapping it goes.
              pill={t(point.missingKey)}
              pillTone={resumeTone(event) === 'accent' ? 'accent' : 'muted'}
              onPress={() => onResume(event)}
              testID={`unfinished-${event.id}`}
            />
            {/* How far it got, under its own row: a Mait deciding which to pick up first wants
                to know which is nearly done. */}
            <View style={styles.progress}>
              <Ionicons name="arrow-forward-circle-outline" size={14} color={colors.textMuted} />
              <Text style={styles.progressText}>
                {t('unfinished.stoppedAt', {
                  done: point.done,
                  total: AI_FLOW_STEPS.length,
                })}
              </Text>
            </View>
          </View>
        );
      })}

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // Tucked under the card it belongs to, and indented past the avatar so it reads as a
  // footnote on that row rather than as a new one.
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingLeft: spacing[4],
    marginTop: -spacing[2],
    marginBottom: spacing[3],
    borderRadius: radius.sm,
  },
  progressText: { ...typography.caption, color: colors.textMuted },
});
