/**
 * Step 1 of the AI capture flow — choose the MPP (SRS §6.3 step 1, M4).
 *
 * The list is whatever the server returns, which is already restricted to this Mait's
 * assigned MPPs (SRS §6.2.3). The app sends no "which Mait am I" filter, because a filter
 * the client supplies is a filter the client can omit.
 *
 * A Mait covering a single MPP is the common case, so that one is selected outright rather
 * than making them tap through a list of one.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useListMppsQuery } from '@api/endpoints';
import type { MPP } from '@api/types';

import { FieldCard, FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

interface Props {
  onSelect: (mpp: MPP) => void;
}

export default function SelectMppScreen({ onSelect }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useListMppsQuery(
    search.length >= 2 ? { search } : undefined,
  );

  // Memoised because it is an effect dependency below. A fresh `[]` on every render would
  // re-run the auto-select effect continuously.
  const results = useMemo(() => data?.results ?? [], [data]);

  // Skip the picker when there is nothing to pick between.
  useEffect(() => {
    if (!search && data && data.count === 1 && results[0]) {
      onSelect(results[0]);
    }
  }, [data, onSelect, results, search]);

  const chosen = results.find(mpp => mpp.mpp_code === selected) ?? null;

  return (
    <FlowScreen
      step={0}
      title={t('aiFlow.whichMpp')}
      subtitle={t('aiFlow.whichMppSubtitle')}
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen),
        disabled: !chosen,
        testID: 'mpp-continue',
      }}
    >
      {/* Searching only matters for a Mait covering several MPPs; below two characters the
          query is not worth a round trip on a rural connection. */}
      {(data?.count ?? 0) > 5 && (
        <FieldCard
          label={t('common.search')}
          value={search}
          onChangeText={setSearch}
          placeholder={t('aiFlow.searchMppHint')}
          autoCorrect={false}
          testID="mpp-search"
        />
      )}

      {isError && (
        <View>
          <FlowNotice tone="error" title={t('errors.generic')} testID="mpp-error" />
          <OptionCard title={t('common.retry')} onPress={refetch} testID="mpp-retry" />
        </View>
      )}

      {isLoading && <FlowNotice tone="info" title={t('common.loading')} />}

      {!isLoading && !isError && results.length === 0 && (
        <FlowNotice tone="info" title={t('aiFlow.noMppsAssigned')} testID="mpp-empty" />
      )}

      {results.map(mpp => (
        <OptionCard
          key={mpp.mpp_code}
          title={mpp.mpp_name}
          subtitle={mpp.mpp_code}
          selected={selected === mpp.mpp_code}
          onPress={() => setSelected(mpp.mpp_code)}
          testID={`mpp-${mpp.mpp_code}`}
        />
      ))}

      <FlowSpacer />
    </FlowScreen>
  );
}
