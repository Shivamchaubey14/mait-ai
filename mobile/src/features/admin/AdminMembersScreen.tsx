/**
 * Members, for an admin — the portal's member search on a handset.
 *
 * The SAP member master is 105k+ rows, so this is a search box and nothing else until something
 * is typed: one box over name, member code and mobile, the same one the portal has, scoped by
 * the server to the account's zones. Tapping a result opens the member whole — the record a Mait
 * or the office reads back to a farmer standing in front of them.
 *
 * Read-only here. Changing a member's mobile number is a write with a reason and an audit entry
 * (the portal's own guard), and belongs to a later round rather than a tap on a handset.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminSearchMembersQuery, useGetMemberQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Field({ label, value }: { label: string; value?: string | null }): React.JSX.Element | null {
  if (value === null || value === undefined || value === '') {return null;}
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Record({ memberCode, onBack }: { memberCode: string; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetMemberQuery(memberCode);
  const member = detail.data;

  return (
    <View style={styles.root}>
      <View style={styles.recordHead}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.recordBack} testID="admin-member-back">
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </Pressable>
        <Text style={styles.recordTitle} numberOfLines={1}>
          {member?.member_name ?? t('admin.members.record')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {detail.isLoading ? (
          <Loading />
        ) : !member ? (
          <EmptyState message={t('admin.members.recordMissing')} />
        ) : (
          <>
            <Field label={t('admin.members.fieldCode')} value={member.member_code} />
            <Field label={t('admin.members.fieldMobile')} value={member.mobile_no} />
            <Field label={t('admin.members.fieldGuardian')} value={member.father_husband_name} />
            <Field label={t('admin.members.fieldMpp')} value={`${member.mpp_name} · ${member.mpp_code}`} />
            <Field label={t('admin.members.fieldStatus')} value={member.activation_status} />
            <Field label={t('admin.members.fieldGender')} value={member.gender} />
            <Field label={t('admin.members.fieldAge')} value={member.age ? String(member.age) : null} />
            <Field
              label={t('admin.members.fieldCattle')}
              value={member.cattle_holding ? String(member.cattle_holding) : null}
            />
            <Field label={t('admin.members.fieldAadhaar')} value={member.aadhar_no} />
            <Field label={t('admin.members.fieldBank')} value={member.bank_name} />
            <Field label={t('admin.members.fieldFolio')} value={member.folio_no} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AdminMembersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [open, setOpen] = useState<string | null>(null);

  const list = useAdminSearchMembersQuery({ search }, { skip: search.length < 2 });
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
    return <Record memberCode={open} onBack={() => setOpen(null)} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={term}
          onChangeText={setTerm}
          placeholder={t('admin.members.searchPlaceholder')}
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
          testID="admin-members-search"
        />
        {term.length > 0 && (
          <Pressable onPress={() => setTerm('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {search.length < 2 ? (
          <EmptyState message={t('admin.members.start')} />
        ) : list.isFetching && !list.data ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.members.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.members.noneFound', { query: search })} />
        ) : (
          rows.map(member => (
            <Pressable
              key={member.member_code}
              accessibilityRole="button"
              onPress={() => setOpen(member.member_code)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              testID={`admin-member-${member.member_code}`}
            >
              <View style={styles.rowChip}>
                <Ionicons name="person" size={18} color={colors.info} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {member.member_name}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[member.member_code, member.mobile_no, member.mpp_code].filter(Boolean).join(' · ')}
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
  root: { flex: 1, backgroundColor: colors.background },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[3],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  body: { padding: spacing[4], paddingTop: 0, gap: spacing[3] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.background },
  rowChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoWash,
  },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted },

  recordHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  recordBack: { padding: spacing[1] },
  recordTitle: { ...typography.h3, color: colors.ink, flex: 1 },

  field: { paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border },
  fieldLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  fieldValue: { ...typography.body, color: colors.ink },
});
