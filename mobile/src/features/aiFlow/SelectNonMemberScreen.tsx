/**
 * Step 3 of the capture flow — which non-member (SRS §6.3 step 2, C4b).
 *
 * Reached when step 1 said *non-member* and the collection point has been chosen. Until this
 * screen existed the flow went straight from the MPP into the registration form, which quietly
 * assumed every non-member is a new one. She usually is not: a farmer without membership is
 * served again the next season, and the second visit was registering her a second time.
 *
 * That was survivable while duplicates were merely untidy. It stopped being survivable when
 * one Aadhaar became one farmer — the form now refuses her card, correctly, and a Mait with no
 * way to reach the record that already exists is a Mait who cannot serve the woman standing in
 * front of them. This screen is that way.
 *
 * The list is read in a yard, out loud, against a person. So a row is not just a name: the same
 * names repeat in a village, and what tells two of them apart is the household, the number, and
 * how her animals have been served. A farmer nobody has inseminated yet says so on the row —
 * that is the ordinary state of a registration whose capture never finished, and it is what a
 * Mait is usually looking for.
 *
 * The way out is the dashed card at the end, not a link in the footer. A Mait at an MPP nobody
 * has registered anybody at yet arrives to an empty list, and on that screen a footer link is
 * the one thing they will not find.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useListNonMembersQuery } from '@api/endpoints';
import type { MPP, NonMemberSummary } from '@api/types';

import {
  AddCard,
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
  onSelect: (nonMember: NonMemberSummary) => void;
  /** Register somebody who is genuinely new. */
  onAddNew: () => void;
  onBack: () => void;
}

export default function SelectNonMemberScreen({
  mpp,
  onSelect,
  onAddNew,
  onBack,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useListNonMembersQuery({
    mppCode: mpp.mpp_code,
    search: search.length >= 2 ? search : undefined,
  });

  const farmers = data?.results ?? [];
  const chosen = farmers.find(farmer => farmer.id === selected) ?? null;

  /**
   * Whose household she is from, in the words the row has space for.
   *
   * The relation is spelled out where it is known, because "Sunita w/o Ram" and "Sunita d/o
   * Ram" are two women. Rows registered before the app asked carry neither and fall back to
   * the number alone, which is still the most reliable thing on the row.
   */
  const describe = (farmer: NonMemberSummary): string => {
    const mobile = farmer.mobile_no ? groupedMobile(farmer.mobile_no) : '';
    if (!farmer.father_husband_name) {
      return mobile;
    }
    const household = farmer.relation_display
      ? `${farmer.relation_display}: ${farmer.father_husband_name}`
      : farmer.father_husband_name;
    return mobile ? `${household} · ${mobile}` : household;
  };

  return (
    <FlowScreen
      step={2}
      title={t('aiFlow.whichNonMember')}
      subtitle={t('aiFlow.whichNonMemberSubtitle', { mpp: mpp.mpp_name })}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !isLoading, onRefresh: refetch }}
      // Pinned under the hero: the control that filters the list has to stay reachable while
      // the list moves.
      stickyTop={
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('aiFlow.searchNonMemberHint')}
          autoCorrect={false}
          testID="non-member-search"
        />
      }
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen),
        disabled: !chosen,
        testID: 'non-member-continue',
      }}
    >
      {isError && <FlowNotice tone="error" title={t('errors.generic')} testID="non-member-error" />}
      {isLoading && <FlowNotice tone="info" title={t('common.loading')} />}

      {!isLoading && !isError && farmers.length === 0 && (
        <FlowNotice
          tone="info"
          title={search ? t('aiFlow.noNonMembersMatch') : t('aiFlow.noNonMembersYet')}
          body={search ? undefined : t('aiFlow.noNonMembersYetBody')}
          testID="non-member-empty"
        />
      )}

      {farmers.map(farmer => (
        <OptionCard
          key={farmer.id}
          swatchLabel={initials(farmer.name)}
          round
          title={farmer.name}
          subtitle={describe(farmer)}
          // Grey, not amber. A farmer nobody has served yet is the ordinary state of a fresh
          // registration and the usual reason a Mait is here — it is a fact about the row, not
          // something that has gone wrong.
          pill={
            farmer.ai_event_count
              ? t('aiFlow.aiCount', { count: farmer.ai_event_count })
              : t('aiFlow.neverInseminated')
          }
          pillTone={farmer.ai_event_count ? 'primary' : 'muted'}
          check
          selected={selected === farmer.id}
          onPress={() => setSelected(farmer.id)}
          testID={`non-member-${farmer.id}`}
        />
      ))}

      {/* Ends the list, the way it ends the animal list: a place for a record rather than
          another record. Present even while a search is filtering, because "she is not in
          here" is exactly the moment a Mait needs it. */}
      <AddCard
        title={t('aiFlow.registerNewNonMember')}
        subtitle={t('aiFlow.registerNewNonMemberBody')}
        onPress={onAddNew}
        testID="non-member-add-card"
      />

      <FlowSpacer />
    </FlowScreen>
  );
}
