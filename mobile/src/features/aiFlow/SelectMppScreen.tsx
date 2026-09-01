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
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useListAiEventsQuery, useListMppsQuery } from '@api/endpoints';
import type { MPP } from '@api/types';
import { colors, spacing, typography } from '@theme/tokens';

import {
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  initials,
  OptionCard,
  SearchField,
} from './components';

interface Props {
  onSelect: (mpp: MPP) => void;
  onBack?: () => void;
}

export default function SelectMppScreen({ onSelect, onBack }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useListMppsQuery(
    search.length >= 2 ? { search } : undefined,
  );

  // Sorted by code, which is the order the same list appears in on every printed roster and
  // in the portal. A list whose order changes between the paper and the phone is a list a
  // Mait has to read twice.
  //
  // Memoised because it is an effect dependency below. A fresh array on every render would
  // re-run the auto-select effect continuously.
  const results = useMemo(
    () => [...(data?.results ?? [])].sort((a, b) => a.mpp_code.localeCompare(b.mpp_code)),
    [data],
  );

  // Skip the picker when there is nothing to pick between.
  useEffect(() => {
    if (!search && data && data.count === 1 && results[0]) {
      onSelect(results[0]);
    }
  }, [data, onSelect, results, search]);

  const chosen = results.find(mpp => mpp.mpp_code === selected) ?? null;

  // The MPP the last event was recorded at, marked on its row. Not "nearest" — the MPP
  // master carries no coordinates, so nothing here can honestly claim distance. Where a Mait
  // worked last is the next best guess at where they are standing, and it is true.
  const events = useListAiEventsQuery();
  const lastUsed = events.data?.results?.[0]?.mpp_code ?? null;

  return (
    <FlowScreen
      step={1}
      title={t('aiFlow.whichMpp')}
      subtitle={t('aiFlow.whichMppSubtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !isLoading, onRefresh: refetch }}
      // Pinned under the hero rather than scrolling with the list. The control that filters
      // the list has to stay reachable while the list moves.
      stickyTop={
        (data?.count ?? 0) > 1 ? (
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('aiFlow.searchMppHint')}
            autoCorrect={false}
            testID="mpp-search"
          />
        ) : undefined
      }
      // The chosen row can easily be scrolled off screen by the time a Mait reaches the
      // button, so the button says what it is about to act on. A tick they cannot see is not
      // a confirmation.
      footerNote={
        chosen ? (
          <View style={styles.chosen} testID="mpp-chosen">
            <Ionicons name="checkmark-circle" size={18} color={colors.primaryDark} />
            <Text style={styles.chosenLabel} numberOfLines={1}>
              {t('aiFlow.mppChosen', { name: chosen.mpp_name })}
            </Text>
          </View>
        ) : undefined
      }
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen),
        disabled: !chosen,
        testID: 'mpp-continue',
      }}
    >
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
          // The code identifies it, the member count sizes it — together they tell a Mait
          // covering several which of two similarly named villages this is.
          subtitle={`${mpp.mpp_code} · ${t('aiFlow.mppMembers', { count: mpp.member_count })}`}
          // Its initials rather than a storefront glyph. Three collection points drawn with
          // the same icon are three identical rows a Mait reads word by word; BA, NA and KO
          // are told apart at a glance, and it is the same tile the farmer list uses one step
          // later. Square, not round: a village is a place, and the circles in this flow are
          // people.
          swatchLabel={initials(mpp.mpp_name)}
          tone="neutral"
          size="roomy"
          pill={mpp.mpp_code === lastUsed ? t('aiFlow.lastUsed') : undefined}
          selected={selected === mpp.mpp_code}
          // A tick on the chosen row and nothing on the others, as on every other choice in
          // the flow. An empty ring on each unchosen row is four controls asking to be read.
          check
          onPress={() => setSelected(mpp.mpp_code)}
          testID={`mpp-${mpp.mpp_code}`}
        />
      ))}

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[3],
  },
  chosenLabel: { ...typography.label, color: colors.primaryDark, flex: 1 },
});
