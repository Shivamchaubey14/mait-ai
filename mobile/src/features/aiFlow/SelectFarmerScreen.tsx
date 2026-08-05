/**
 * Step 2 of the AI capture flow — choose the farmer (SRS §6.3 step 2).
 *
 * Either a Member from the SAP master for this MPP, or a Non-Member captured on the spot.
 *
 * A member whose record has no usable mobile number is shown but not selectable. 1.5% of
 * the real member data is in that state, and starting a flow for one would strand the Mait
 * at the payment step with the insemination already performed and no way to close the event
 * (docs/DATA_FINDINGS.md §2).
 */

import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useListMembersQuery } from '@api/endpoints';
import type { Member, MPP } from '@api/types';
import { Banner, Button, EmptyState, ListRow, Loading, Screen, TextField } from '@/components';
import { spacing } from '@theme/tokens';

interface Props {
  mpp: MPP;
  onSelectMember: (member: Member) => void;
  onAddNonMember: () => void;
}

export default function SelectFarmerScreen({
  mpp,
  onSelectMember,
  onAddNonMember,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, isFetching, refetch } = useListMembersQuery({
    mppCode: mpp.mpp_code,
    search: search.length >= 2 ? search : undefined,
  });

  const members = data?.results ?? [];

  return (
    <Screen>
      <TextField
        label={t('common.search')}
        hint={t('aiFlow.searchMemberHint')}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        testID="member-search"
      />

      {isError && <Banner message={t('errors.generic')} testID="member-error" />}

      {isLoading ? (
        <Loading label={t('common.loading')} />
      ) : (
        <FlatList
          data={members}
          keyExtractor={item => item.member_code}
          contentContainerStyle={styles.list}
          refreshing={isFetching}
          onRefresh={refetch}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState message={search ? t('aiFlow.noMembersMatch') : t('aiFlow.noMembers')} />
          }
          renderItem={({ item }) => {
            const unreachable = !item.mobile_no;
            return (
              <ListRow
                title={item.member_name}
                subtitle={
                  item.father_husband_name
                    ? `${item.member_code} · ${item.father_husband_name}`
                    : item.member_code
                }
                meta={item.mobile_no || undefined}
                warning={unreachable ? t('aiFlow.memberNoMobile') : undefined}
                disabled={unreachable}
                onPress={() => onSelectMember(item)}
                testID={`member-${item.member_code}`}
              />
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Button
          label={t('aiFlow.addNonMember')}
          variant="ghost"
          onPress={onAddNonMember}
          testID="add-non-member"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: spacing[4] },
  footer: { paddingTop: spacing[2] },
});
