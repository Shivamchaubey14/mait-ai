/**
 * Audit log, for an admin — the portal's `logs.html` (W19) on a handset.
 *
 * Who did what, when, and from where. Append-only: nothing here can be edited or removed, and
 * this screen has no write path at all — reading it is the whole job.
 *
 * **A row is a sentence, not a schema.** The server builds "Completed AI event 64" from the
 * action, the record and whichever metadata key holds the outcome, and each card leads with
 * that line. The rest — a real before/after where one was recorded, the labelled facts, and the
 * request that ties one act's rows together — is folded underneath and opens on a tap.
 *
 * **Personal data is the row that matters.** An Aadhaar card opened, a workbook of bank details
 * taken: those are the entries an auditor scrolls for, so they are the red ones and they have a
 * tile and a chip of their own. Everything else is ordinary work, coloured as ordinary work —
 * created green, changed blue, deleted red, uploads yellow, sign-ins slate.
 *
 * The filters are the portal's: a search for a record, a person, an IP or a request id; the
 * actions present in the trail as chips, each with the count it would show; the record types
 * the same way; and a date range. The workbook export carries exactly those filters and never
 * the paging — fifty rows that happened to be on screen would be a file that looks complete
 * and is not. Taking it is itself a personal-data read, so the trail is reloaded afterwards.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { Banner, EmptyState } from '@/components';
import { SkeletonRows } from '@/components/skeleton';
import { Sheet } from '@/components/BottomSheet';
import DateRangeSheet, { formatRange, isoDate } from '@/components/dateRange';
import { initials } from '@/components/frame';
import { useAdminAuditTrailQuery } from '@api/endpoints';
import { downloadAndShare } from '@api/files';
import type { AuditEntry, AuditQuery } from '@api/types';
import type { RootState } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { Disc, FilterChip, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { Button } from './AdminUsersScreen';
import { useDebounced } from './common';
import { relative } from './AdminZonesScreen';

const PAGE = 50;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The trail's own tones — `good`, `bad`, `warn`, `info`, or none — in this app's colours. */
export function auditTone(tone: string | null | undefined): ToneName {
  switch (tone) {
    case 'good':
      return 'green';
    case 'bad':
      return 'red';
    case 'warn':
      return 'yolk';
    case 'info':
      return 'blue';
    default:
      return 'slate';
  }
}

/** The query as the server reads it; the workbook takes the same one without the paging. */
export function auditParams(query: AuditQuery): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params[key] = String(value);
    }
  }
  return params;
}

function stamp(t: TFunction, iso: string): string {
  const d = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function n(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('en-IN');
}

// --------------------------------------------------------------------------------------
// Parts
// --------------------------------------------------------------------------------------

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText
        style={styles.tileValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        testID={`${testID}-value`}
      >
        {value}
      </AppText>
      <AppText style={styles.hint} testID={`${testID}-foot`}>
        {foot}
      </AppText>
    </View>
  );
}

function Picker({
  icon,
  label,
  active,
  onPress,
  onClear,
  testID,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
  onClear: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.picker, active && styles.pickerOn, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon as never} size={15} color={active ? colors.surface : colors.info} />
      <AppText
        style={[styles.pickerLabel, active && { color: colors.surface }]}
        numberOfLines={1}
        testID={`${testID}-value`}
      >
        {label}
      </AppText>
      {active ? (
        <Pressable onPress={onClear} hitSlop={8} testID={`${testID}-clear`}>
          <Ionicons name="close-circle" size={16} color={colors.surface} />
        </Pressable>
      ) : (
        <Ionicons name="chevron-down" size={15} color={colors.info} />
      )}
    </Pressable>
  );
}

function EntryCard({
  entry,
  open,
  onToggle,
  onTrace,
}: {
  entry: AuditEntry;
  open: boolean;
  onToggle: () => void;
  onTrace: (id: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = auditTone(entry.tone);
  const look = TONE[tone];
  const changes = entry.changes ?? [];
  const facts = entry.facts ?? [];
  const openable = changes.length > 0 || facts.length > 0;
  const who = entry.actor ?? { name: '' };

  const head = (
    <>
      <View style={styles.row}>
        {/* A scheduled job is the absence of a person, so it is grey, not another colour. */}
        <Disc
          tone={who.system ? 'slate' : 'blue'}
          text={who.initials || initials(who.name)}
          size={34}
        />
        <View style={styles.flex}>
          <AppText style={styles.name}>{who.name}</AppText>
          {!!who.role && <AppText style={styles.hint}>{who.role}</AppText>}
        </View>
        <View style={styles.whenCol}>
          <AppText style={styles.when}>{stamp(t, entry.when)}</AppText>
          <AppText style={styles.hint}>{relative(t, entry.when)}</AppText>
        </View>
      </View>
      <View style={styles.what}>
        <Pill label={entry.action_label} tone={tone} />
        <AppText style={styles.summary}>{entry.summary}</AppText>
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="document-text-outline" size={13} color={colors.textMuted} />
        <AppText style={[styles.hint, styles.flex]} numberOfLines={1}>
          {[entry.entity_label, entry.entity_id].filter(Boolean).join(' · ')}
        </AppText>
        <Ionicons name="globe-outline" size={13} color={colors.textMuted} />
        <AppText style={styles.code}>{entry.ip_address || '—'}</AppText>
        {openable && (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        )}
      </View>
    </>
  );

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-audit-${entry.id}`}
    >
      {openable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          style={({ pressed }) => [styles.gap, pressed && styles.pressed]}
          testID={`admin-audit-toggle-${entry.id}`}
        >
          {head}
        </Pressable>
      ) : (
        <View style={styles.gap}>{head}</View>
      )}

      {open && (
        <View style={styles.inset} testID={`admin-audit-detail-${entry.id}`}>
          {/* A diff reads struck-through on the left, as one does. */}
          {changes.map(change => (
            <View key={change.field} style={styles.change}>
              <AppText style={styles.field}>{change.field}</AppText>
              <View style={styles.diff}>
                <AppText style={styles.from}>{change.from || t('admin.audit.empty')}</AppText>
                <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
                <AppText style={styles.to}>{change.to || t('admin.audit.empty')}</AppText>
              </View>
            </View>
          ))}
          {facts.map(fact => (
            <View key={fact.label} style={styles.fact}>
              <AppText style={styles.factLabel}>{fact.label}</AppText>
              <AppText style={styles.factValue}>{fact.value}</AppText>
            </View>
          ))}
          {!!entry.request_id && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onTrace(entry.request_id!)}
              style={({ pressed }) => [styles.trace, pressed && styles.pressed]}
              testID={`admin-audit-trace-${entry.id}`}
            >
              <Ionicons name="git-network-outline" size={14} color={colors.info} />
              <AppText style={styles.traceText}>
                {t('admin.audit.request', { id: entry.request_id })}
              </AppText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The screen
// --------------------------------------------------------------------------------------

export default function AdminAuditScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const scroller = useRef<ScrollView>(null);
  const months = t('calendar.months', { returnObjects: true }) as string[];

  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [pickingType, setPickingType] = useState(false);
  const [pickingDates, setPickingDates] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const query: AuditQuery = useMemo(
    () => ({
      search,
      action,
      entity_type: entity,
      date_from: range?.from,
      date_to: range?.to,
    }),
    [search, action, entity, range],
  );
  const filtered = !!(search || action || entity || range);

  // Any filter change starts from the first page — page four of the old answer is nothing.
  const [asked, setAsked] = useState(query);
  if (asked !== query) {
    setAsked(query);
    setOffset(0);
    setOpenId(null);
  }

  const trail = useAdminAuditTrailQuery({ ...query, offset });
  const data = trail.data;
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const summary = data?.summary;
  const types = data?.facets.entity_types ?? [];
  const typeLabel = types.find(f => f.key === entity)?.label ?? entity;

  const clear = () => {
    setTerm('');
    setAction('');
    setEntity('');
    setRange(null);
  };

  const page = (next: number) => {
    setOffset(next);
    setOpenId(null);
    // Back to the top: a pager at the foot leaves the reader at row fifty of the next page.
    scroller.current?.scrollTo({ y: 0, animated: true });
  };

  /** A request id is followed by searching for it, so the filter bar says what is asked. */
  const trace = (id: string) => {
    setTerm(id);
    setAction('');
    scroller.current?.scrollTo({ y: 0, animated: true });
  };

  const exportWorkbook = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setExporting(true);
    try {
      const qs = Object.entries(auditParams(query))
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      await downloadAndShare(
        `/admin/audit/export/${qs ? `?${qs}` : ''}`,
        `audit-trail-${isoDate(new Date())}.xlsx`,
        XLSX,
        access,
      );
      // The export just wrote a row to the trail; a screen from before it disagrees with the file.
      trail.refetch();
    } catch {
      setProblem(t('admin.audit.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={trail.isFetching && !trail.isLoading}
            onRefresh={() => trail.refetch()}
          />
        }
        testID="admin-audit"
      >
        <View style={styles.row}>
          <Disc tone="slate" icon="shield-checkmark" size={36} />
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.audit.title')}</AppText>
            <AppText style={styles.hint}>{t('admin.audit.subtitle')}</AppText>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Button
              label={t(exporting ? 'admin.audit.preparing' : 'admin.audit.export')}
              icon="download-outline"
              tone="ink"
              disabled={exporting}
              onPress={exportWorkbook}
              testID="admin-audit-export"
            />
          </View>
          <Button
            label={t('admin.audit.refresh')}
            icon="refresh"
            tone="blue"
            outline
            onPress={() => trail.refetch()}
            testID="admin-audit-refresh"
          />
        </View>

        {!!problem && <Banner tone="error" message={problem} testID="admin-audit-problem" />}

        {/* The last thirty days, not the lifetime: an append-only total only ever grows. */}
        {summary && (
          <>
            <View style={styles.tiles}>
              <Tile
                tone="blue"
                icon="document-text"
                label={t('admin.audit.tileEntries')}
                value={n(summary.total)}
                foot={t('admin.audit.inLastDays', { n: summary.window_days })}
                testID="admin-audit-tile-total"
              />
              <Tile
                tone="slate"
                icon="time"
                label={t('admin.audit.tileToday')}
                value={n(summary.today)}
                foot={t('admin.audit.sinceMidnight')}
                testID="admin-audit-tile-today"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="slate"
                icon="people"
                label={t('admin.audit.tilePeople')}
                value={n(summary.people)}
                foot={t('admin.audit.didSomething')}
                testID="admin-audit-tile-people"
              />
              <Tile
                tone="red"
                icon="finger-print"
                label={t('admin.audit.tilePii')}
                value={n(summary.pii_access)}
                foot={t('admin.audit.piiFoot')}
                testID="admin-audit-tile-pii"
              />
            </View>
          </>
        )}

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.audit.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            autoCapitalize="none"
            testID="admin-audit-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Picker
              icon="folder-open-outline"
              label={entity ? typeLabel : t('admin.audit.allTypes')}
              active={!!entity}
              onPress={() => setPickingType(true)}
              onClear={() => setEntity('')}
              testID="admin-audit-type"
            />
          </View>
          <View style={styles.flex}>
            <Picker
              icon="calendar"
              label={range ? formatRange(range.from, range.to, months) : t('admin.audit.anyDate')}
              active={!!range}
              onPress={() => setPickingDates(true)}
              onClear={() => setRange(null)}
              testID="admin-audit-dates"
            />
          </View>
        </View>

        {/* Built from the trail, each with the count it would show. The strip runs out to the
            screen's edges — inside the page's padding it sliced a pill in half 16pt short of
            the edge — while its first pill still lines up with the content above. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipStrip}
          contentContainerStyle={styles.chips}
          testID="admin-audit-actions"
        >
          <FilterChip
            label={t('admin.audit.allActions')}
            icon="list"
            tone="slate"
            active={action === ''}
            onPress={() => setAction('')}
            testID="admin-audit-action-all"
          />
          {(data?.facets.actions ?? []).map(facet => (
            <FilterChip
              key={facet.key}
              label={`${facet.label} ${n(facet.count)}`}
              icon={facet.key === 'pii_access' ? 'finger-print' : 'ellipse'}
              tone={auditTone(facet.tone)}
              active={action === facet.key}
              onPress={() => setAction(facet.key)}
              testID={`admin-audit-action-${facet.key}`}
            />
          ))}
        </ScrollView>

        <View style={styles.row}>
          <Disc tone="slate" icon="shield" size={32} />
          <AppText style={[styles.headTitle, styles.flex]}>{t('admin.audit.trail')}</AppText>
          {data && (
            <AppText style={styles.count} testID="admin-audit-count">
              {t('admin.audit.entriesN', { count })}
            </AppText>
          )}
          {filtered && (
            <Pressable onPress={clear} hitSlop={6} testID="admin-audit-clear">
              <AppText style={styles.clear}>{t('admin.audit.clear')}</AppText>
            </Pressable>
          )}
        </View>

        {trail.isLoading ? (
          <SkeletonRows rows={8} pill={false} />
        ) : trail.isError ? (
          <EmptyState message={t('admin.audit.error')} />
        ) : rows.length === 0 ? (
          <EmptyState message={t(filtered ? 'admin.audit.noMatch' : 'admin.audit.none')} />
        ) : (
          rows.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              open={openId === entry.id}
              onToggle={() => setOpenId(o => (o === entry.id ? null : entry.id))}
              onTrace={trace}
            />
          ))
        )}

        {count > PAGE && (
          <View style={styles.row}>
            <Button
              label={t('admin.audit.previous')}
              icon="chevron-back"
              tone="blue"
              outline
              disabled={offset === 0 || trail.isFetching}
              onPress={() => page(Math.max(0, offset - PAGE))}
              testID="admin-audit-prev"
            />
            <AppText style={[styles.hint, styles.flex, styles.center]} testID="admin-audit-page">
              {t('admin.audit.pageOf', {
                from: offset + 1,
                to: Math.min(offset + PAGE, count),
                count,
              })}
            </AppText>
            <Button
              label={t('admin.audit.next')}
              icon="chevron-forward"
              tone="blue"
              outline
              disabled={offset + PAGE >= count || trail.isFetching}
              onPress={() => page(offset + PAGE)}
              testID="admin-audit-next"
            />
          </View>
        )}
      </ScrollView>

      <Sheet
        visible={pickingType}
        title={t('admin.audit.recordType')}
        onClose={() => setPickingType(false)}
        testID="admin-audit-type-sheet"
      >
        {[
          { key: '', label: t('admin.audit.allTypes'), count: null as number | null },
          ...types,
        ].map(option => {
          const on = option.key === entity;
          return (
            <Pressable
              key={option.key || 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setEntity(option.key);
                setPickingType(false);
              }}
              style={[styles.option, on && styles.optionOn]}
              testID={`admin-audit-type-${option.key || 'all'}`}
            >
              <AppText style={[styles.optionLabel, on && { color: colors.info }]}>
                {option.label}
              </AppText>
              {option.count !== null && <AppText style={styles.hint}>{n(option.count)}</AppText>}
              {on && <Ionicons name="checkmark" size={18} color={colors.info} />}
            </Pressable>
          );
        })}
      </Sheet>

      <DateRangeSheet
        visible={pickingDates}
        from={range?.from ?? null}
        to={range?.to ?? null}
        onClose={() => setPickingDates(false)}
        onApply={(from, to) => {
          setRange({ from, to });
          setPickingDates(false);
        }}
        onClear={() => {
          setRange(null);
          setPickingDates(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  gap: { gap: spacing[2] },
  center: { textAlign: 'center' },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { ...typography.h3, color: colors.ink },
  headTitle: { ...typography.h3, color: colors.ink },
  hint: { ...typography.caption, color: colors.textMuted },
  name: { ...typography.bodyStrong, color: colors.ink },
  count: { ...typography.label, color: colors.info },
  clear: { ...typography.label, color: colors.error },
  code: { ...typography.caption, color: colors.ink, fontVariant: ['tabular-nums'] },
  chipStrip: { marginHorizontal: -spacing[4], flexGrow: 0 },
  chips: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: 2 },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pickerOn: { backgroundColor: colors.info },
  pickerLabel: { ...typography.label, color: colors.ink, flex: 1 },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  whenCol: { alignItems: 'flex-end' },
  when: { ...typography.caption, color: colors.ink, fontFamily: typography.label.fontFamily },
  what: { gap: 6, alignItems: 'flex-start' },
  summary: { ...typography.body, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  inset: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  change: { gap: 2 },
  field: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textMuted,
  },
  diff: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  from: {
    ...typography.label,
    color: TONE.red.text,
    textDecorationLine: 'line-through',
    backgroundColor: TONE.red.wash,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  to: {
    ...typography.label,
    color: TONE.green.text,
    backgroundColor: TONE.green.wash,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  fact: {
    flexDirection: 'row',
    gap: spacing[3],
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  trace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ink[200],
  },
  traceText: { ...typography.caption, color: colors.info, flex: 1 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: colors.infoWash },
  optionLabel: { ...typography.body, color: colors.ink, flex: 1 },
});
