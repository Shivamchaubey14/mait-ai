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

import { colors, spacing, typography } from '@theme/tokens';

import { FlowScreen, FlowSpacer, OptionCard } from './components';
import { useServiceRate } from './rates';

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
  const rate = useServiceRate('nonMember');

  /**
   * "You collect ₹ 100 today", with the figure picked out.
   *
   * The amount is the only part of this row that decides anything — it is what the Mait will
   * be holding and what the farmer will be handing over — so it carries the colour and the
   * rest of the sentence stays quiet. Split on the rendered figure rather than assembled from
   * two strings, so a translation is free to put it wherever the sentence needs it.
   */
  const nonMemberSubtitle = () => {
    if (rate === null) {
      return t('aiFlow.nonMemberSubtitlePlain');
    }
    const amount = `₹ ${rate}`;
    const sentence = t('aiFlow.nonMemberSubtitle', { amount: rate });
    const at = sentence.indexOf(amount);
    if (at === -1) {
      return sentence;
    }
    return (
      <>
        {sentence.slice(0, at)}
        <Text style={styles.amount}>{amount}</Text>
        {sentence.slice(at + amount.length)}
      </>
    );
  };

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
        // Two choices and a whole screen to make them in. A list-tight row here reads as an
        // item lifted out of a list that is not on the page, and the question deserves the
        // room — everything after this step is built on the answer.
        size="roomy"
        iconNode={
          <MaterialCommunityIcons name="account-check-outline" size={22} color={colors.primary} />
        }
        selected={choice === 'member'}
        // A tick on the chosen card and nothing on the other, which is how every other choice
        // in this flow is drawn. An empty ring beside the option a Mait did not pick is a
        // control asking to be read; the answer is already on the card that is filled.
        check
        onPress={() => setChoice('member')}
        testID="owner-member"
      />

      <OptionCard
        title={t('aiFlow.nonMember')}
        // Named from the dairy's own rates, and only where every breed shares one. Quoting a
        // price the system cannot charge is worse than not quoting one — the farmer hears it
        // as final.
        subtitle={nonMemberSubtitle()}
        size="roomy"
        iconNode={
          <MaterialCommunityIcons name="account-outline" size={22} color={colors.textMuted} />
        }
        tone="neutral"
        selected={choice === 'nonMember'}
        check
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
  amount: { color: colors.primaryDark, fontFamily: typography.bodyStrong.fontFamily },
});
