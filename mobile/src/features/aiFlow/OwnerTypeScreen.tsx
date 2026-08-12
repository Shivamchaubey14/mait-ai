/**
 * Step 1 — member or non-member (SRS §6.3, §11).
 *
 * The fork. A member is found in the MPP's roster and pays nothing today, because the dairy
 * deducts the service from her milk payment; a non-member is typed in from scratch and pays
 * the Mait on the spot. Every screen after this one is built on the answer, which is why it
 * is asked first rather than discovered halfway down the farmer list.
 *
 * It defaults to member. That is the overwhelming majority of the work, and a default that is
 * usually right turns the commonest capture into one tap instead of two.
 */

import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import { NON_MEMBER_FEE } from '@/config/env';
import { colors, spacing, typography } from '@theme/tokens';

import { FlowScreen, FlowSpacer, OptionCard } from './components';

export type OwnerType = 'member' | 'nonMember';

export default function OwnerTypeScreen({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (choice: OwnerType) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<OwnerType>('member');

  return (
    <FlowScreen
      step={0}
      title={t('aiFlow.ownerTypeTitle')}
      subtitle={t('aiFlow.ownerTypeSubtitle')}
      onBack={onBack}
      cta={{
        label: t('common.continue'),
        onPress: () => onContinue(choice),
        testID: 'owner-type-continue',
      }}
    >
      {/* A person already ticked off against a list, versus a bare person. Ionicons has no
          account-with-check, and the pair has to come from one family or the two cards read as
          two different weights of drawing. */}
      <OptionCard
        title={t('aiFlow.member')}
        subtitle={t('aiFlow.memberSubtitle')}
        iconNode={
          <MaterialCommunityIcons name="account-check-outline" size={22} color={colors.primary} />
        }
        selected={choice === 'member'}
        radio
        onPress={() => setChoice('member')}
        testID="owner-member"
      />

      <OptionCard
        title={t('aiFlow.nonMember')}
        // The figure is only named when the build has one configured. Quoting a price the
        // system cannot charge is worse than not quoting one — the farmer hears it as final.
        subtitle={
          NON_MEMBER_FEE === null
            ? t('aiFlow.nonMemberSubtitlePlain')
            : t('aiFlow.nonMemberSubtitle', { amount: NON_MEMBER_FEE })
        }
        iconNode={
          <MaterialCommunityIcons name="account-outline" size={22} color={colors.textMuted} />
        }
        tone="neutral"
        selected={choice === 'nonMember'}
        radio
        onPress={() => setChoice('nonMember')}
        testID="owner-non-member"
      />

      <Text style={styles.note}>{t('aiFlow.ownerTypeNote')}</Text>

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  note: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[4],
  },
});
