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
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

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
          // The same word the waiting list and the AI events row use for this record. A Mait
          // who reads "Queued" here and "Queued" there is reading about one thing.
          pill={t('done.queued')}
          icon="time-outline"
          testID="done-queued"
        />
      )}

      <View style={styles.tiles}>
        {/* What she paid: green once cash is in hand, blue for a member's deduction the dairy
            will settle. */}
        <View
          style={[styles.tile, isMember ? styles.tileInfo : styles.tileGood]}
          testID="done-cost"
        >
          <View style={[styles.chip, { backgroundColor: isMember ? colors.info : colors.primary }]}>
            <Ionicons name={isMember ? 'receipt' : 'cash'} size={16} color={colors.surface} />
          </View>
          <Text style={[styles.tileLabel, isMember ? styles.wordInfo : styles.wordGood]}>
            {t('done.costToHer')}
          </Text>
          <Text style={styles.tileValue}>₹ {isMember ? 0 : cost}</Text>
          <Text style={[styles.tileNote, isMember ? styles.wordInfo : styles.wordGood]}>
            {isMember ? t('done.deductedFromMilk') : t('done.collected')}
          </Text>
        </View>

        {/* Straws in their own colour, blue, with the syringe — as on Inventory. */}
        <View style={[styles.tile, styles.tileInfo]} testID="done-straws">
          <View style={[styles.chip, { backgroundColor: colors.info }]}>
            <Glyph name={STRAW_GLYPH} size={16} color={colors.surface} />
          </View>
          <Text style={[styles.tileLabel, styles.wordInfo]}>{t('done.strawsLeft')}</Text>
          <Text style={styles.tileValue}>{strawsLeft === null ? '—' : strawsLeft}</Text>
          <Text style={[styles.tileNote, styles.wordInfo]}>{strawBreed}</Text>
        </View>
      </View>

      {/* The day, not the event: by the third capture the interesting number is how the round
          is going, and whether anything is still waiting to go up. */}
      <Pressable
        accessibilityRole="button"
        onPress={onHome}
        style={({ pressed }) => [
          styles.today,
          pending > 0 ? styles.todayWaiting : styles.todaySent,
          pressed && styles.todayPressed,
        ]}
        testID="done-today"
      >
        <View style={[styles.chip, { backgroundColor: pending > 0 ? yolk[500] : colors.primary }]}>
          <Ionicons
            name={pending > 0 ? 'cloud-upload' : 'cloud-done'}
            size={18}
            color={pending > 0 ? colors.ink : colors.surface}
          />
        </View>
        <View style={styles.todayText}>
          <Text style={styles.todayLabel}>{t('done.today')}</Text>
          <Text
            style={[styles.todayValue, { color: pending > 0 ? yolk[800] : colors.primaryDark }]}
          >
            {pending > 0 ? t('done.todayWithQueue', { pending }) : t('done.todayAllSynced')}
          </Text>
        </View>
        <View style={styles.go}>
          <Ionicons name="chevron-forward" size={16} color={colors.ink} />
        </View>
      </Pressable>
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  // In a colour, like every card in the app: the figure's glyph on a solid chip over it.
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[3],
  },
  tileGood: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  tileInfo: { backgroundColor: colors.infoWash, borderColor: colors.info },
  chip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  wordGood: { color: colors.primaryDark },
  wordInfo: { color: colors.info },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  tileValue: { ...typography.h1, color: colors.ink, marginTop: 2 },
  tileNote: { ...typography.caption, marginTop: 2 },

  today: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[3],
  },
  todaySent: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  todayWaiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  todayPressed: { opacity: 0.85 },
  todayText: { flex: 1 },
  todayLabel: { ...typography.bodyStrong, color: colors.ink },
  todayValue: { ...typography.caption, marginTop: 2 },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
