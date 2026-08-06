/**
 * Step 2 of the AI capture flow — choose the farmer (SRS §6.3 step 2, M5).
 *
 * Either a Member from the SAP master for this MPP, or a Non-Member captured on the spot.
 *
 * A member whose record has no usable mobile number is shown but not selectable, with the
 * reason on the row. 1.5% of the real member data is in that state, and starting a flow for
 * one would strand the Mait at the payment step with the insemination already performed and
 * no way to close the event (docs/DATA_FINDINGS.md §2). Hiding those rows instead would be
 * worse: a Mait who cannot find a farmer they know is registered concludes the app is broken.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useListMembersQuery } from '@api/endpoints';
import type { Member, MPP } from '@api/types';

import { FieldCard, FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

interface Props {
  mpp: MPP;
  onSelectMember: (member: Member) => void;
  onAddNonMember: () => void;
  onBack: () => void;
}

export default function SelectFarmerScreen({
  mpp,
  onSelectMember,
  onAddNonMember,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isError } = useListMembersQuery({
    mppCode: mpp.mpp_code,
    search: search.length >= 2 ? search : undefined,
  });

  const members = data?.results ?? [];
  const chosen = members.find(member => member.member_code === selected) ?? null;

  return (
    <FlowScreen
      step={1}
      title={t('aiFlow.whoseAnimal')}
      subtitle={t('aiFlow.whoseAnimalSubtitle')}
      onBack={onBack}
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelectMember(chosen),
        disabled: !chosen,
        testID: 'farmer-continue',
      }}
      link={{
        label: t('aiFlow.addNonMember'),
        onPress: onAddNonMember,
        testID: 'add-non-member',
      }}
    >
      <FieldCard
        label={t('common.search')}
        placeholder={t('aiFlow.searchMemberHint')}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        testID="member-search"
      />

      {isError && <FlowNotice tone="error" title={t('errors.generic')} testID="member-error" />}
      {isLoading && <FlowNotice tone="info" title={t('common.loading')} />}

      {!isLoading && !isError && members.length === 0 && (
        <FlowNotice
          tone="info"
          title={search ? t('aiFlow.noMembersMatch') : t('aiFlow.noMembers')}
          testID="member-empty"
        />
      )}

      {members.map(member => {
        const unreachable = !member.mobile_no;
        return (
          <OptionCard
            key={member.member_code}
            title={member.member_name}
            subtitle={
              member.mobile_no ? `${member.member_code} · ${member.mobile_no}` : member.member_code
            }
            blockedReason={unreachable ? t('aiFlow.memberNoMobile') : undefined}
            pill={unreachable ? t('aiFlow.blocked') : undefined}
            selected={selected === member.member_code}
            onPress={() => setSelected(member.member_code)}
            testID={`member-${member.member_code}`}
          />
        );
      })}

      {/* A way out of the list rather than another thing in it, so it reads as a different
          kind of answer to the question the screen is asking. */}
      <View>
        <OptionCard
          title={t('aiFlow.farmerNotAMember')}
          subtitle={t('aiFlow.farmerNotAMemberBody')}
          tone="accent"
          onPress={onAddNonMember}
          testID="farmer-not-member"
        />
      </View>

      <FlowSpacer />
    </FlowScreen>
  );
}
