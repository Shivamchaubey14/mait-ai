/**
 * Step 1 of the AI capture flow — choose the MPP (SRS §6.3 step 1).
 *
 * The list is whatever the server returns, which is already restricted to this Mait's
 * assigned MPPs (SRS §6.2.3). The app sends no "which Mait am I" filter, because a filter
 * the client supplies is a filter the client can omit.
 *
 * A Mait covering a single MPP is the common case, so that one is selected outright rather
 * than making them tap through a list of one.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useListMppsQuery } from '@api/endpoints';
import type { MPP } from '@api/types';
import { Banner, EmptyState, Loading, ListRow, Screen, TextField } from '@/components';
import { spacing } from '@theme/tokens';

interface Props {
  onSelect: (mpp: MPP) => void;
}

export default function SelectMppScreen({ onSelect }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, refetch, isFetching } = useListMppsQuery(
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

  if (isLoading) {
    return (
      <Screen>
        <Loading label={t('common.loading')} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <Banner message={t('errors.generic')} testID="mpp-error" />
        <ListRow title={t('common.retry')} onPress={refetch} testID="mpp-retry" />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Searching only matters for a Mait covering several MPPs; below two characters the
          query is not worth a round trip on a rural connection. */}
      {(data?.count ?? 0) > 5 && (
        <TextField
          label={t('common.search')}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          testID="mpp-search"
        />
      )}

      <FlatList
        data={results}
        keyExtractor={item => item.mpp_code}
        contentContainerStyle={styles.list}
        refreshing={isFetching}
        onRefresh={refetch}
        ListEmptyComponent={<EmptyState message={t('aiFlow.noMppsAssigned')} />}
        renderItem={({ item }) => (
          <ListRow
            title={item.mpp_name}
            subtitle={item.mpp_code}
            onPress={() => onSelect(item)}
            testID={`mpp-${item.mpp_code}`}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing[6] },
});
