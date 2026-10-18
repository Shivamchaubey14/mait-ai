/**
 * AI events, for an admin — the portal's AI events roster on a handset.
 *
 * The whole network's inseminations, newest first, behind one search box (event number, farmer,
 * straw, MPP code, Mait name or code — the same box the portal has) and a status filter whose
 * counts come from the server's set-wide `summary`, not from the page on screen. Tapping a row
 * opens the record; an admin or super admin can delete it there, which is the one irreversible
 * back-office correction this screen exists to allow. A Normal User reaches everything but that.
 *
 * List and record are one screen with its own back handler, so the Android gesture closes the
 * record before the drawer or the app does.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  useAdminListAiEventsQuery,
  useDeleteAiEventMutation,
  useGetAiEventQuery,
} from '@api/endpoints';
import type { AIEvent, AIEventStatus } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { useAppSelector } from '@/store';
import { colors, green, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

type Filter = 'all' | 'completed' | 'unfinished' | 'cancelled';
type Kind = 'completed' | 'unfinished' | 'cancelled';

const FILTERS: Filter[] = ['all', 'completed', 'unfinished', 'cancelled'];

function kindOf(status: AIEventStatus): Kind {
  if (status === 'completed') {return 'completed';}
  if (status === 'cancelled') {return 'cancelled';}
  return 'unfinished';
}

const LOOK: Record<Kind, { tone: string; wash: string; border: string; icon: string }> = {
  completed: { tone: colors.primaryDark, wash: colors.primaryWash, border: green[300], icon: 'checkmark-done' },
  unfinished: { tone: yolk[800], wash: colors.secondaryWash, border: yolk[300], icon: 'time' },
  cancelled: { tone: ink[500], wash: ink[50], border: ink[200], icon: 'close-circle' },
};

function useDebounced(value: string, ms = 350): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function when(iso: string | null): string {
  if (!iso) {return '';}
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------------------
// Record
// --------------------------------------------------------------------------------------
function Field({ label, value }: { label: string; value?: string | null }): React.JSX.Element | null {
  if (!value) {return null;}
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function Record({
  eventId,
  canDelete,
  onBack,
  onDeleted,
}: {
  eventId: number;
  canDelete: boolean;
  onBack: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useGetAiEventQuery(eventId);
  const [remove, removeState] = useDeleteAiEventMutation();
  const event = detail.data;

  const confirmDelete = () => {
    if (!event) {return;}
    Alert.alert(t('admin.events.deleteTitle'), t('admin.events.deleteBody', { name: event.owner_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.events.deleteConfirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await remove(eventId).unwrap();
            onDeleted();
          } catch {
            Alert.alert(t('admin.events.deleteFailedTitle'), t('admin.events.deleteFailedBody'));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.recordHead}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.recordBack} testID="admin-event-back">
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </Pressable>
        <Text style={styles.recordTitle} numberOfLines={1}>
          {event?.owner_name ?? t('admin.events.record')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {detail.isLoading ? (
          <Loading />
        ) : !event ? (
          <EmptyState message={t('admin.events.recordMissing')} />
        ) : (
          <>
            <View style={[styles.statusBanner, { backgroundColor: LOOK[kindOf(event.status)].wash, borderColor: LOOK[kindOf(event.status)].border }]}>
              <Ionicons name={LOOK[kindOf(event.status)].icon as never} size={18} color={LOOK[kindOf(event.status)].tone} />
              <Text style={[styles.statusBannerLabel, { color: LOOK[kindOf(event.status)].tone }]}>
                {event.status_display}
              </Text>
            </View>

            <Field label={t('admin.events.fieldOwner')} value={`${event.owner_name} · ${t(event.owner_type === 'member' ? 'history.member' : 'history.nonMember')}`} />
            <Field label={t('admin.events.fieldMember')} value={event.member_code} />
            <Field label={t('admin.events.fieldMait')} value={[event.mait_name, event.mait_code].filter(Boolean).join(' · ')} />
            <Field label={t('admin.events.fieldMpp')} value={`${event.mpp_name} · ${event.mpp_code}`} />
            <Field label={t('admin.events.fieldAnimal')} value={[event.breed, event.ear_tag_no].filter(Boolean).join(' · ')} />
            <Field label={t('admin.events.fieldStraw')} value={event.straw_unique_no} />
            <Field label={t('admin.events.fieldDoses')} value={event.doses ? String(event.doses) : null} />
            <Field label={t('admin.events.fieldAmount')} value={event.amount_due ? `₹ ${event.amount_due}` : null} />
            <Field
              label={t('admin.events.fieldPayment')}
              value={event.payment ? `${event.payment.mode_display} · ${event.payment.status_display}` : null}
            />
            <Field label={t('admin.events.fieldPerformed')} value={when(event.performed_at)} />
            <Field label={t('admin.events.fieldCompleted')} value={when(event.completed_at)} />

            {canDelete && (
              <Pressable
                accessibilityRole="button"
                onPress={confirmDelete}
                disabled={removeState.isLoading}
                style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
                testID="admin-event-delete"
              >
                {removeState.isLoading ? (
                  <ActivityIndicator color={colors.error} />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color={colors.error} />
                    <Text style={styles.deleteLabel}>{t('admin.events.delete')}</Text>
                  </>
                )}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// List
// --------------------------------------------------------------------------------------
export default function AdminEventsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const role = useAppSelector(state => state.auth.user?.role);
  const canDelete = role === 'super_admin' || role === 'admin';

  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const args = useMemo(
    () => ({
      ...(search ? { search } : {}),
      ...(filter === 'completed' ? { status: 'completed' } : {}),
      ...(filter === 'cancelled' ? { status: 'cancelled' } : {}),
      ...(filter === 'unfinished' ? { unfinished: true } : {}),
      offset,
    }),
    [search, filter, offset],
  );
  const list = useAdminListAiEventsQuery(args);

  // A new search or filter starts the page over.
  useEffect(() => {
    setOffset(0);
  }, [search, filter]);

  const rows = list.data?.results ?? [];
  const summary = list.data?.summary;
  const total = list.data?.count ?? 0;

  // Close the record on the Android back gesture before anything above this screen sees it.
  useEffect(() => {
    if (open === null) {return;}
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const countFor = useCallback(
    (f: Filter): number | null => {
      if (!summary) {return null;}
      if (f === 'all') {return summary.completed + summary.unfinished + summary.cancelled;}
      return summary[f];
    },
    [summary],
  );

  if (open !== null) {
    return (
      <Record
        eventId={open}
        canDelete={canDelete}
        onBack={() => setOpen(null)}
        onDeleted={() => {
          setOpen(null);
          list.refetch();
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={term}
          onChangeText={setTerm}
          placeholder={t('admin.events.searchPlaceholder')}
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
          testID="admin-events-search"
        />
        {term.length > 0 && (
          <Pressable onPress={() => setTerm('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {FILTERS.map(f => {
          const active = filter === f;
          const count = countFor(f);
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`admin-events-filter-${f}`}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {t(`admin.events.filter_${f}`)}
                {count !== null ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body}>
        {list.isLoading ? (
          <Loading />
        ) : list.isError ? (
          <EmptyState message={t('admin.events.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={search ? t('admin.events.noneFound', { query: search }) : t('admin.events.none')} />
        ) : (
          <>
            {rows.map(event => (
              <EventRow key={event.id} event={event} onPress={() => setOpen(event.id)} />
            ))}

            {offset + rows.length < total && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setOffset(o => o + 25)}
                disabled={list.isFetching}
                style={styles.more}
                testID="admin-events-more"
              >
                {list.isFetching ? (
                  <ActivityIndicator color={colors.info} />
                ) : (
                  <Text style={styles.moreLabel}>{t('admin.events.loadMore')}</Text>
                )}
              </Pressable>
            )}
            <Text style={styles.count}>{t('admin.events.showing', { shown: rows.length, total })}</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function EventRow({ event, onPress }: { event: AIEvent; onPress: () => void }): React.JSX.Element {
  const kind = kindOf(event.status);
  const look = LOOK[kind];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`admin-event-${event.id}`}
    >
      <View style={[styles.rowChip, { backgroundColor: look.wash, borderColor: look.border }]}>
        <Ionicons name={look.icon as never} size={18} color={look.tone} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {event.owner_name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[event.mait_name, event.mpp_code, when(event.created_at)].filter(Boolean).join(' · ')}
        </Text>
        <View style={[styles.rowPill, { backgroundColor: look.wash, borderColor: look.border }]}>
          <Text style={[styles.rowPillLabel, { color: look.tone }]}>{event.status_display}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
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
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

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
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  rowName: { ...typography.h3, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  rowPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: 2,
  },
  rowPillLabel: { ...typography.caption, fontSize: 11 },

  more: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  moreLabel: { ...typography.label, color: colors.info },
  count: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  // -- record ----------------------------------------------------------------------------
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

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statusBannerLabel: { ...typography.bodyStrong },

  field: {
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 2 },
  fieldValue: { ...typography.body, color: colors.ink },

  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    marginTop: spacing[5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  deletePressed: { opacity: 0.85 },
  deleteLabel: { ...typography.bodyStrong, color: colors.error },
});
