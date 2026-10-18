/**
 * Non-members, for an admin — the farmers Maits registered in the field (W10b).
 *
 * A non-member is registered on a form that ends with cash changing hands, and until the portal
 * grew this screen the only oversight of that was the row's absence from every admin screen. So
 * the record reads back who registered her, whether her Aadhaar card is on file, and what she
 * has done since — the things the back office chases. Search by name, mobile or household name;
 * scoped by the server.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminGetNonMemberQuery, useAdminSearchNonMembersQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, green, radius, spacing, typography } from '@theme/tokens';

import { Field, RecordHead, SearchBar, adminStyles, useDebounced } from './common';

function CardChip({ captured, label }: { captured: boolean; label: string }): React.JSX.Element {
  return (
    <View style={[styles.cardChip, captured ? styles.cardOn : styles.cardOff]}>
      <Ionicons
        name={captured ? 'checkmark-circle' : 'alert-circle'}
        size={13}
        color={captured ? colors.primaryDark : colors.error}
      />
      <Text style={[styles.cardChipLabel, { color: captured ? colors.primaryDark : colors.error }]}>
        {label}
      </Text>
    </View>
  );
}

function Record({ id, onBack }: { id: number; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useAdminGetNonMemberQuery(id);
  const farmer = detail.data;
  return (
    <View style={adminStyles.root}>
      <RecordHead title={farmer?.name ?? t('admin.nonMembers.record')} onBack={onBack} testID="admin-nonmember-back" />
      <ScrollView contentContainerStyle={adminStyles.body}>
        {detail.isLoading ? (
          <Loading />
        ) : !farmer ? (
          <EmptyState message={t('admin.nonMembers.recordMissing')} />
        ) : (
          <>
            <View style={styles.cards}>
              <CardChip captured={farmer.aadhar_front_captured} label={t('admin.nonMembers.aadhaarFront')} />
              <CardChip captured={farmer.aadhar_back_captured} label={t('admin.nonMembers.aadhaarBack')} />
            </View>
            <Field label={t('admin.nonMembers.fieldMobile')} value={farmer.mobile_no} />
            <Field label={t('admin.nonMembers.fieldGuardian')} value={[farmer.father_husband_name, farmer.relation_display].filter(Boolean).join(' · ')} />
            <Field label={t('admin.nonMembers.fieldMpp')} value={[farmer.mpp_name, farmer.mpp_code].filter(Boolean).join(' · ')} />
            <Field label={t('admin.nonMembers.fieldRegisteredBy')} value={[farmer.registered_by, farmer.registered_by_code].filter(Boolean).join(' · ')} />
            <Field label={t('admin.nonMembers.fieldAadhaar')} value={farmer.masked_aadhar} />
            <Field label={t('admin.nonMembers.fieldAddress')} value={farmer.address} />
            <Field label={t('admin.nonMembers.fieldAnimals')} value={String(farmer.animal_count)} />
            <Field label={t('admin.nonMembers.fieldEvents')} value={String(farmer.ai_event_count)} />
            <Field label={t('admin.nonMembers.fieldCattle')} value={farmer.cattle_total ? String(farmer.cattle_total) : null} />
            <Field label={t('admin.nonMembers.fieldYield')} value={farmer.daily_yield_litres ? `${farmer.daily_yield_litres} L` : null} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AdminNonMembersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<number | null>(null);

  const list = useAdminSearchNonMembersQuery({ search }, { skip: search.length < 2 });
  const rows = list.data?.results ?? [];

  useEffect(() => {
    if (open === null) {return;}
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  if (open !== null) {
    return <Record id={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={adminStyles.root}>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder={t('admin.nonMembers.searchPlaceholder')}
        testID="admin-nonmembers-search"
      />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {search.length < 2 ? (
          <EmptyState message={t('admin.nonMembers.start')} />
        ) : list.isFetching && !list.data ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.nonMembers.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.nonMembers.noneFound', { query: search })} />
        ) : (
          rows.map(farmer => (
            <Pressable
              key={farmer.id}
              accessibilityRole="button"
              onPress={() => setOpen(farmer.id)}
              style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
              testID={`admin-nonmember-${farmer.id}`}
            >
              <View style={adminStyles.rowChip}>
                <Ionicons name="person-add" size={18} color={colors.info} />
              </View>
              <View style={adminStyles.rowBody}>
                <Text style={adminStyles.rowName} numberOfLines={1}>
                  {farmer.name}
                </Text>
                <Text style={adminStyles.rowMeta} numberOfLines={1}>
                  {[farmer.mobile_no, farmer.mpp_code, farmer.registered_by].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[1] },
  cardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  cardOn: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  cardOff: { backgroundColor: colors.errorWash, borderColor: colors.error },
  cardChipLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
});
