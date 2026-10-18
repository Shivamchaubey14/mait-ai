/**
 * Indents, for an admin — the requests Maits raise for stock, and the decision on them.
 *
 * The one operational write in this round. A requested indent carries Approve and Reject; the
 * decision posts to the same endpoints the zonal app and the portal use, so the state machine
 * and the audit entry live in one place. A rejection takes a reason — the Mait is told it in
 * their own app — so Reject reveals a box rather than firing on the first tap. Everything else
 * is read: who asked, for what, where it is handed over, and how far it has got.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import {
  useAdminListIndentsQuery,
  useApproveIndentMutation,
  useGetIndentQuery,
  useRejectIndentMutation,
} from '@api/endpoints';
import type { Indent, IndentStatus } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { Field, RecordHead, adminStyles } from './common';

type Filter = 'all' | 'requested' | 'approved' | 'rejected';
const FILTERS: Filter[] = ['all', 'requested', 'approved', 'rejected'];

const LOOK: Record<IndentStatus, { tone: string; wash: string; border: string }> = {
  requested: { tone: yolk[800], wash: colors.secondaryWash, border: yolk[300] },
  approved: { tone: colors.info, wash: colors.infoWash, border: colors.info },
  issued: { tone: colors.primaryDark, wash: colors.primaryWash, border: green[300] },
  rejected: { tone: colors.error, wash: colors.errorWash, border: colors.error },
};

function itemOf(indent: Indent): string {
  return indent.breed || indent.item || '';
}

function Record({
  indentId,
  onBack,
  onDecided,
}: {
  indentId: number;
  onBack: () => void;
  onDecided: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetIndentQuery(indentId);
  const indent = detail.data;
  const [approve, approveState] = useApproveIndentMutation();
  const [reject, rejectState] = useRejectIndentMutation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const busy = approveState.isLoading || rejectState.isLoading;
  const pending = indent?.status === 'requested';

  const doApprove = () => {
    if (!indent) {return;}
    Alert.alert(
      t('admin.indents.approveTitle'),
      t('admin.indents.approveBody', { name: indent.mait_name ?? '', item: itemOf(indent), qty: indent.qty_requested }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.indents.approve'),
          onPress: async () => {
            try {
              await approve(indent.id).unwrap();
              onDecided();
            } catch {
              Alert.alert(t('admin.indents.failedTitle'), t('admin.indents.failedBody'));
            }
          },
        },
      ],
    );
  };

  const doReject = async () => {
    if (!indent || reason.trim().length === 0) {return;}
    try {
      await reject({ id: indent.id, reason: reason.trim() }).unwrap();
      onDecided();
    } catch {
      Alert.alert(t('admin.indents.failedTitle'), t('admin.indents.failedBody'));
    }
  };

  return (
    <View style={adminStyles.root}>
      <RecordHead title={indent?.mait_name ?? t('admin.indents.record')} onBack={onBack} testID="admin-indent-back" />
      <ScrollView contentContainerStyle={adminStyles.body} keyboardShouldPersistTaps="handled">
        {detail.isLoading ? (
          <Loading />
        ) : !indent ? (
          <EmptyState message={t('admin.indents.recordMissing')} />
        ) : (
          <>
            <View style={[styles.banner, { backgroundColor: LOOK[indent.status].wash, borderColor: LOOK[indent.status].border }]}>
              <Text style={[styles.bannerLabel, { color: LOOK[indent.status].tone }]}>
                {indent.status_display}
              </Text>
            </View>
            <Field label={t('admin.indents.fieldMait')} value={[indent.mait_name, indent.mait_code].filter(Boolean).join(' · ')} />
            <Field label={t('admin.indents.fieldItem')} value={itemOf(indent)} />
            <Field label={t('admin.indents.fieldQty')} value={`${indent.qty_requested}`} />
            <Field label={t('admin.indents.fieldStore')} value={indent.store_name} />
            <Field label={t('admin.indents.fieldApprovedBy')} value={indent.approved_by_name} />
            <Field label={t('admin.indents.fieldNote')} value={indent.note} />

            {pending && !rejecting && (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={doApprove}
                  disabled={busy}
                  style={({ pressed }) => [styles.approve, pressed && styles.pressed]}
                  testID="admin-indent-approve"
                >
                  {approveState.isLoading ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color={colors.surface} />
                      <Text style={styles.approveLabel}>{t('admin.indents.approve')}</Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRejecting(true)}
                  disabled={busy}
                  style={({ pressed }) => [styles.reject, pressed && styles.pressed]}
                  testID="admin-indent-reject"
                >
                  <Ionicons name="close" size={16} color={colors.error} />
                  <Text style={styles.rejectLabel}>{t('admin.indents.reject')}</Text>
                </Pressable>
              </View>
            )}

            {pending && rejecting && (
              <View style={styles.rejectBox}>
                <Text style={styles.rejectHint}>{t('admin.indents.rejectHint')}</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={reason}
                  onChangeText={setReason}
                  placeholder={t('admin.indents.reasonPlaceholder')}
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  testID="admin-indent-reason"
                />
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={doReject}
                    disabled={busy || reason.trim().length === 0}
                    style={({ pressed }) => [
                      styles.reject,
                      (busy || reason.trim().length === 0) && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                    testID="admin-indent-reject-confirm"
                  >
                    {rejectState.isLoading ? (
                      <ActivityIndicator color={colors.error} />
                    ) : (
                      <Text style={styles.rejectLabel}>{t('admin.indents.rejectConfirm')}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setRejecting(false);
                      setReason('');
                    }}
                    style={styles.cancel}
                    testID="admin-indent-reject-cancel"
                  >
                    <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function AdminIndentsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('requested');
  const [open, setOpen] = useState<number | null>(null);

  const args = useMemo(() => (filter === 'all' ? {} : { status: filter }), [filter]);
  const list = useAdminListIndentsQuery(args);
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
    return (
      <Record
        indentId={open}
        onBack={() => setOpen(null)}
        onDecided={() => {
          setOpen(null);
          list.refetch();
        }}
      />
    );
  }

  return (
    <View style={adminStyles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map(f => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`admin-indents-filter-${f}`}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {t(`admin.indents.filter_${f}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={adminStyles.body}>
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.indents.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t('admin.indents.none')} />
        ) : (
          rows.map(indent => {
            const look = LOOK[indent.status];
            return (
              <Pressable
                key={indent.id}
                accessibilityRole="button"
                onPress={() => setOpen(indent.id)}
                style={({ pressed }) => [adminStyles.row, pressed && adminStyles.rowPressed]}
                testID={`admin-indent-${indent.id}`}
              >
                <View style={[adminStyles.rowChip, { backgroundColor: look.wash }]}>
                  <Ionicons name="clipboard" size={18} color={look.tone} />
                </View>
                <View style={adminStyles.rowBody}>
                  <Text style={adminStyles.rowName} numberOfLines={1}>
                    {indent.mait_name ?? itemOf(indent)}
                  </Text>
                  <Text style={adminStyles.rowMeta} numberOfLines={1}>
                    {[`${itemOf(indent)} × ${indent.qty_requested}`, indent.store_name]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <View style={[adminStyles.pill, { backgroundColor: look.wash, borderColor: look.border }]}>
                    <Text style={[adminStyles.pillLabel, { color: look.tone }]}>
                      {indent.status_display}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  chipActive: { backgroundColor: colors.info },
  chipLabel: { ...typography.label, color: colors.info },
  chipLabelActive: { color: colors.surface },

  banner: { padding: spacing[3], borderRadius: radius.md, borderWidth: 1 },
  bannerLabel: { ...typography.bodyStrong },

  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  approve: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  approveLabel: { ...typography.bodyStrong, color: colors.surface },
  reject: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  rejectLabel: { ...typography.bodyStrong, color: colors.error },

  rejectBox: { marginTop: spacing[4], gap: spacing[2] },
  rejectHint: { ...typography.caption, color: colors.textMuted },
  reasonInput: {
    ...typography.body,
    color: colors.ink,
    minHeight: 72,
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
  cancel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  cancelLabel: { ...typography.bodyStrong, color: colors.textMuted },
});
