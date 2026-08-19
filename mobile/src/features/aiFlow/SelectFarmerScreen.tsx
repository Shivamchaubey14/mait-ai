/**
 * Step 3 of the AI capture flow — which member (SRS §6.3 step 2, C3).
 *
 * Reached only when step 1 said Member. The roster is this MPP's, searched by code, name or
 * mobile, because a Mait is told a name in the yard and reads a code off a passbook.
 *
 * A member whose record has no usable mobile number is shown but not selectable, with the
 * reason on the row. 1.5% of the real member data is in that state, and starting a flow for
 * one would strand the Mait at the payment step with the insemination already performed and
 * no way to close the event (docs/DATA_FINDINGS.md §2). Hiding those rows instead would be
 * worse: a Mait who cannot find a farmer they know is registered concludes the app is broken.
 * So the row stays, greyed, and one line under the list says what to do about it — the fix is
 * at the collection point, not on this screen.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useListMembersQuery } from '@api/endpoints';
import type { Member, MPP } from '@api/types';

import {
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  groupedMobile,
  initials,
  OptionCard,
  SearchField,
} from './components';

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

  const { data, isLoading, isError, isFetching, refetch } = useListMembersQuery({
    mppCode: mpp.mpp_code,
    search: search.length >= 2 ? search : undefined,
  });

  const members = data?.results ?? [];
  const chosen = members.find(member => member.member_code === selected) ?? null;
  const anyBlocked = members.some(member => !member.mobile_no);

  return (
    <FlowScreen
      step={2}
      title={t('aiFlow.whichMember')}
      subtitle={t('aiFlow.whichMemberSubtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !isLoading, onRefresh: refetch }}
      // Pinned under the hero rather than scrolling with the list: the control that filters a
      // roster of hundreds has to stay reachable while the roster moves.
      stickyTop={
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('aiFlow.searchMemberHint')}
          autoCorrect={false}
          testID="member-search"
        />
      }
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelectMember(chosen),
        disabled: !chosen,
        testID: 'farmer-continue',
      }}
      // A text link, not a second card in the list: it is a different kind of answer to the
      // question the screen is asking, and it leaves the flow rather than advancing it.
      link={{
        label: t('aiFlow.sheIsNotAMember'),
        onPress: onAddNonMember,
        testID: 'add-non-member',
      }}
    >
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
            swatchLabel={initials(member.member_name)}
            round
            // Stretched like the two steps before it. It costs about one row per screenful on
            // a long roster, which is the trade — but a Mait picking the wrong Kavita is a
            // capture recorded against the wrong household, and the name and the code both
            // have room to be read here rather than skimmed.
            size="roomy"
            title={member.member_name}
            subtitle={
              member.mobile_no
                ? `${member.member_code} · ${groupedMobile(member.mobile_no)}`
                : member.member_code
            }
            blockedReason={unreachable ? t('aiFlow.memberNoMobile') : undefined}
            pill={unreachable ? t('aiFlow.blocked') : undefined}
            check
            selected={selected === member.member_code}
            onPress={() => setSelected(member.member_code)}
            testID={`member-${member.member_code}`}
          />
        );
      })}

      {anyBlocked && (
        <FlowNotice
          tone="info"
          body={t('aiFlow.memberNoMobileBody')}
          testID="member-blocked-note"
        />
      )}

      <FlowSpacer />
    </FlowScreen>
  );
}
