/**
 * Recorded (SRS §6.4, C12).
 *
 * The screen a Mait sees a dozen times a day, so it answers the three questions they actually
 * have and stops: is it saved, what did it cost her, and how many straws are left.
 *
 * **Queued is not failed.** An event captured in a village with no signal is complete work
 * sitting on a handset, and the wording says so — *saved on this phone, it will go on its own
 * when there is signal*. A Mait who reads "failed" retakes the whole capture, which is how one
 * insemination becomes two records.
 *
 * The button is *Start another*, because the next animal is usually in the same yard.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import type { AIEvent } from '@api/types';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen } from './components';

interface Props {
  event: AIEvent | null;
  farmerName: string;
  animalLabel: string;
  time: string;
  /** Records still on the handset, waiting for signal. */
  pending: number;
  /** Straws of the breed just used, after the deduction. */
  strawsLeft: number | null;
  strawBreed: string;
  onStartAnother: () => void;
  onHome: () => void;
}

export default function CaptureDoneScreen({
  event,
  farmerName,
  animalLabel,
  time,
  pending,
  strawsLeft,
  strawBreed,
  onStartAnother,
  onHome,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const cost = event?.amount_due ? Math.round(Number(event.amount_due)) : 0;
  const isMember = event?.owner_type === 'member';

  return (
    <FlowScreen
      step={null}
      tone="good"
      done
      title={t('done.recorded')}
      subtitle={`${farmerName} · ${animalLabel} · ${time}`}
      cta={{
        label: t('done.startAnother'),
        onPress: onStartAnother,
        testID: 'done-start-another',
      }}
      link={{ label: t('home.backToHome'), onPress: onHome, testID: 'done-home' }}
    >
      {pending > 0 && (
        <FlowNotice
          tone="accent"
          title={t('done.savedOnThisPhone')}
          body={t('done.willGoOnItsOwn')}
          icon="time-outline"
          testID="done-queued"
        />
      )}

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>{t('done.costToHer')}</Text>
          <Text style={styles.tileValue}>₹ {isMember ? 0 : cost}</Text>
          <Text style={styles.tileNote}>
            {isMember ? t('done.deductedFromMilk') : t('done.collected')}
          </Text>
        </View>

        <View style={[styles.tile, styles.tileGood]}>
          <Text style={[styles.tileLabel, styles.tileLabelGood]}>{t('done.strawsLeft')}</Text>
          <Text style={[styles.tileValue, styles.tileValueGood]}>
            {strawsLeft === null ? '—' : strawsLeft}
          </Text>
          <Text style={[styles.tileNote, styles.tileNoteGood]}>{strawBreed}</Text>
        </View>
      </View>

      {/* The day, not the event: by the third capture the interesting number is how the round
          is going, and whether anything is still waiting to go up. */}
      <Pressable
        accessibilityRole="button"
        onPress={onHome}
        style={({ pressed }) => [styles.today, pressed && styles.todayPressed]}
        testID="done-today"
      >
        <View style={styles.todayText}>
          <Text style={styles.todayLabel}>{t('done.today')}</Text>
          <Text style={styles.todayValue}>
            {pending > 0 ? t('done.todayWithQueue', { pending }) : t('done.todayAllSynced')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  tile: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing[4],
  },
  // The straw count is green because it is the number a Mait acts on: it decides whether they
  // can keep working or need to raise an indent tonight.
  tileGood: { backgroundColor: colors.primaryWash },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileLabelGood: { color: colors.primaryDark },
  tileValue: { ...typography.h1, color: colors.ink, marginTop: 2 },
  tileValueGood: { color: colors.primaryDark },
  tileNote: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  tileNoteGood: { color: colors.primaryDark },

  today: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadows.card,
    padding: spacing[4],
  },
  todayPressed: { backgroundColor: colors.background },
  todayText: { flex: 1 },
  todayLabel: { ...typography.bodyStrong, color: colors.ink },
  todayValue: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
