/**
 * Navigation shell (SRS §6.3, §10.3).
 *
 * The AI capture flow is a fixed six-step sequence, so a stack that always moves forward
 * fits it better than free navigation. Steps 3–6 land in Phase 3; the header already shows
 * the full progress so the Mait can see where they are in the whole flow, not just the part
 * that exists yet.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Member, MPP, NonMember } from '@api/types';
import { Banner, Screen } from '@/components';
import { AI_FLOW_STEPS } from '@/config/env';
import AddNonMemberScreen from '@/features/aiFlow/AddNonMemberScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import { useAppSelector } from '@/store';
import { colors, radius, spacing, typography } from '@theme/tokens';

type FlowScreen = 'selectMpp' | 'selectFarmer' | 'addNonMember' | 'notBuiltYet';

/**
 * Progress across all six steps (SRS §10.3).
 *
 * Shows every step, including the ones not yet implemented — a Mait needs to know how much
 * is left, and hiding future steps would make the flow feel unpredictable.
 */
function ProgressBar({ current }: { current: number }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.progress}>
      <Text style={styles.progressLabel}>
        {t('aiFlow.stepOf', { current: current + 1, total: AI_FLOW_STEPS.length })}
      </Text>
      <View style={styles.progressTrack}>
        {AI_FLOW_STEPS.map((step, index) => (
          <View
            key={step}
            style={[
              styles.progressSegment,
              index < current && styles.progressDone,
              index === current && styles.progressCurrent,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function RootNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const accessToken = useAppSelector(state => state.auth.accessToken);

  const [screen, setScreen] = useState<FlowScreen>('selectMpp');
  const [mpp, setMpp] = useState<MPP | null>(null);
  const [farmer, setFarmer] = useState<Member | NonMember | null>(null);

  if (!accessToken) {
    return <LoginScreen />;
  }

  const stepIndex = screen === 'selectMpp' ? 0 : screen === 'notBuiltYet' ? 2 : 1;

  const proceedToAnimal = (selected: Member | NonMember) => {
    setFarmer(selected);
    setScreen('notBuiltYet');
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t(`aiFlow.${AI_FLOW_STEPS[stepIndex]}`)}</Text>
        {!!mpp && <Text style={styles.headerSubtitle}>{mpp.mpp_name}</Text>}
      </View>
      <ProgressBar current={stepIndex} />

      {screen === 'selectMpp' && (
        <SelectMppScreen
          onSelect={selected => {
            setMpp(selected);
            setScreen('selectFarmer');
          }}
        />
      )}

      {screen === 'selectFarmer' && mpp && (
        <SelectFarmerScreen
          mpp={mpp}
          onSelectMember={proceedToAnimal}
          onAddNonMember={() => setScreen('addNonMember')}
        />
      )}

      {screen === 'addNonMember' && mpp && (
        <AddNonMemberScreen
          mpp={mpp}
          onCreated={proceedToAnimal}
          onCancel={() => setScreen('selectFarmer')}
        />
      )}

      {screen === 'notBuiltYet' && (
        <Screen>
          <Banner tone="info" message={t('aiFlow.comingNext')} testID="not-built-yet" />
          <Text style={styles.selected}>
            {farmer && 'member_name' in farmer ? farmer.member_name : farmer?.name}
          </Text>
        </Screen>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  headerTitle: { ...typography.h2, color: colors.surface },
  headerSubtitle: { ...typography.caption, color: colors.surface, opacity: 0.8 },
  progress: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.surface,
  },
  progressLabel: { ...typography.caption, color: colors.textMuted },
  progressTrack: {
    flexDirection: 'row',
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral,
    opacity: 0.25,
  },
  progressDone: { backgroundColor: colors.success, opacity: 1 },
  progressCurrent: { backgroundColor: colors.accent, opacity: 1 },
  selected: { ...typography.h3, color: colors.text, textAlign: 'center' },
});
