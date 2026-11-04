/**
 * Reports & export, for an admin — the portal's `reports.html` on a handset.
 *
 * Build a query, preview it, export it — deliberately in that order: an operator who exports
 * blind discovers a wrong date range only after sending the file to someone. The preview runs
 * the same filters against the list endpoint, so what is on screen is what lands in the file.
 *
 * **The file is the query that was run, not the one being typed.** The builder holds a draft;
 * Run query makes it the query. Export takes the query that was run, and while the draft differs
 * the screen says so — a download that quietly followed half-edited fields would disagree with
 * the preview it was taken from.
 *
 * The CSV is fetched with the session's token and handed to the share sheet (Drive, WhatsApp,
 * Files) because a phone has no Downloads folder an app may write to. It carries no personal
 * data — the endpoint enforces that, and the screen says it, because an operator who believes
 * the file is complete goes looking for a way to add Aadhaar to it.
 *
 * On a database with nothing in it yet, an unfiltered preview shows a worked example, plainly
 * marked as one and never tappable. A filtered query that matches nothing is a result, and says so.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { Banner, EmptyState } from '@/components';
import { SkeletonTable } from '@/components/skeleton';
import DateRangeSheet, { isoDate, parseIsoDate } from '@/components/dateRange';
import { useAdminListAiEventsQuery } from '@api/endpoints';
import { downloadAndShare, XLSX_MIME } from '@api/files';
import type { AIEvent, AIEventStatus } from '@api/types';
import type { RootState } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { EventRecord, MppSheet } from './AdminEventsScreen';
import { presetRange } from './AdminLeaderboardScreen';
import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

/** Ten, as the portal previews: enough to recognise the answer, not a second list screen. */
const PREVIEW_ROWS = 10;

type StatusFilter = '' | 'completed' | 'payment_pending' | 'straw_verified' | 'cancelled';
const STATUSES: StatusFilter[] = [
  '',
  'completed',
  'payment_pending',
  'straw_verified',
  'cancelled',
];

type Quick = 'today' | '7' | '30' | 'this-month' | 'all';
const QUICK: Quick[] = ['today', '7', '30', 'this-month', 'all'];

export interface Query {
  from: string | null;
  to: string | null;
  mpp: { code: string; name: string } | null;
  search: string;
  status: StatusFilter;
}

const EMPTY: Query = { from: null, to: null, mpp: null, search: '', status: '' };

const STATUS_TONE: Record<AIEventStatus, ToneName> = {
  completed: 'green',
  payment_pending: 'yolk',
  photo_captured: 'blue',
  straw_verified: 'blue',
  draft: 'slate',
  cancelled: 'red',
};

/** The filters as the API spells them — one function, so the preview and the file agree. */
export function exportParams(query: Query): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.from) {
    params.date_from = query.from;
  }
  if (query.to) {
    params.date_to = query.to;
  }
  if (query.mpp) {
    params.mpp = query.mpp.code;
  }
  if (query.status) {
    params.status = query.status;
  }
  if (query.search.trim()) {
    params.search = query.search.trim();
  }
  return params;
}

function same(a: Query, b: Query): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    (a.mpp?.code ?? null) === (b.mpp?.code ?? null) &&
    a.search.trim() === b.search.trim() &&
    a.status === b.status
  );
}

function quickRange(quick: Quick): { from: string | null; to: string | null } {
  if (quick === 'all') {
    return { from: null, to: null };
  }
  if (quick === 'today') {
    const today = isoDate(new Date());
    return { from: today, to: today };
  }
  return presetRange(quick);
}

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function rupees(value: string | number): string {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

function day(t: TFunction, iso: string): string {
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const d = parseIsoDate(iso);
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function dayTime(t: TFunction, iso: string): string {
  const at = new Date(iso);
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${at.getDate()} ${months[at.getMonth()] ?? ''} ${at.getFullYear()}, ${hh}:${mm}`;
}

/** One field of the builder: a glyph, a label, the control, and a line on what it does. */
function Field({
  tone,
  icon,
  label,
  hint,
  children,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Disc tone={tone} icon={icon} size={24} />
        <AppText style={styles.fieldLabel}>{label}</AppText>
      </View>
      {children}
      <AppText style={styles.hint}>{hint}</AppText>
    </View>
  );
}

/** A tappable box that opens a sheet — the date range, or the MPP. */
function Picker({
  value,
  placeholder,
  icon,
  onPress,
  onClear,
  testID,
}: {
  value: string | null;
  placeholder: string;
  icon: string;
  onPress: () => void;
  onClear?: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
      testID={testID}
    >
      <AppText
        style={[styles.pickerValue, !value && styles.pickerEmpty]}
        numberOfLines={1}
        testID={`${testID}-value`}
      >
        {value ?? placeholder}
      </AppText>
      {value && onClear ? (
        <Pressable onPress={onClear} hitSlop={8} testID={`${testID}-clear`}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : (
        <Ionicons name={icon as never} size={18} color={colors.info} />
      )}
    </Pressable>
  );
}

/** The person-and-code pair the portal's table cells show. */
function Identity({ label, name, code }: { label: string; name: string; code: string }) {
  return (
    <View style={styles.identity}>
      <AppText style={styles.hint}>{label}</AppText>
      <AppText style={styles.identityName} numberOfLines={1}>
        {name || '—'}
      </AppText>
      {!!code && <AppText style={styles.hint}>{code}</AppText>}
    </View>
  );
}

interface PreviewLine {
  key: string;
  code: string;
  when: string;
  mpp: [string, string];
  mait: [string, string];
  amount: string;
  status: string;
  tone: ToneName;
}

function lineOf(t: TFunction, event: AIEvent): PreviewLine {
  return {
    key: String(event.id),
    code: `#${event.id}`,
    when: dayTime(t, event.created_at),
    mpp: [event.mpp_name, event.mpp_code],
    mait: [event.mait_name ?? '', event.mait_code ?? ''],
    amount: event.payment ? rupees(event.payment.amount) : '—',
    status: t(`admin.reports.status_${event.status}`, { defaultValue: event.status_display }),
    tone: STATUS_TONE[event.status] ?? 'slate',
  };
}

/**
 * A worked example for a database with nothing in it yet: what an operator is about to get.
 * Unmistakably not data — badged, greyed, not tappable — and never exported: the file is
 * streamed from the API, which has never heard of these.
 */
function sampleLines(t: TFunction): PreviewLine[] {
  const s = (key: string) => t(`admin.reports.status_${key}`);
  return [
    {
      key: 's1',
      code: 'AI-100482',
      when: '12 Aug 2026, 08:14',
      mpp: ['BARWALA', 'MPP000412'],
      mait: ['SUNITA DEVI', '5500000054'],
      amount: '₹300',
      status: s('completed'),
      tone: 'green',
    },
    {
      key: 's2',
      code: 'AI-100481',
      when: '12 Aug 2026, 07:52',
      mpp: ['KHERI JAT', 'MPP000188'],
      mait: ['RAMESH KUMAR', '5500000091'],
      amount: '₹300',
      status: s('completed'),
      tone: 'green',
    },
    {
      key: 's3',
      code: 'AI-100479',
      when: '11 Aug 2026, 17:30',
      mpp: ['BARWALA', 'MPP000412'],
      mait: ['SUNITA DEVI', '5500000054'],
      amount: '₹300',
      status: s('payment_pending'),
      tone: 'yolk',
    },
    {
      key: 's4',
      code: 'AI-100476',
      when: '11 Aug 2026, 16:05',
      mpp: ['DHANANA', 'MPP000233'],
      mait: ['ANIL SINGH', '5500000117'],
      amount: '—',
      status: s('straw_verified'),
      tone: 'blue',
    },
    {
      key: 's5',
      code: 'AI-100470',
      when: '11 Aug 2026, 09:41',
      mpp: ['KHERI JAT', 'MPP000188'],
      mait: ['RAMESH KUMAR', '5500000091'],
      amount: '—',
      status: s('cancelled'),
      tone: 'red',
    },
  ];
}

function PreviewCard({
  line,
  sample,
  onOpen,
}: {
  line: PreviewLine;
  sample?: boolean;
  onOpen?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const look = sample ? TONE.slate : TONE[line.tone];
  const body = (
    <>
      <View style={styles.rowTop}>
        <AppText style={[styles.code, sample && styles.sampleText]}>{line.code}</AppText>
        <AppText style={styles.hint}>{line.when}</AppText>
        <View style={styles.flex} />
        <Pill label={line.status} tone={sample ? 'slate' : line.tone} />
      </View>
      <View style={styles.inset}>
        <View style={styles.identities}>
          <Identity label={t('admin.reports.mpp')} name={line.mpp[0]} code={line.mpp[1]} />
          <Identity label={t('admin.reports.mait')} name={line.mait[0]} code={line.mait[1]} />
        </View>
        <View style={[styles.payRow, styles.rule]}>
          <AppText style={styles.hint}>{t('admin.reports.payment')}</AppText>
          <AppText style={styles.amount} testID={`admin-report-amount-${line.key}`}>
            {line.amount}
          </AppText>
        </View>
      </View>
      {!sample && (
        <View style={styles.openRow}>
          <AppText style={[styles.openLabel, { color: look.text }]}>
            {t('admin.reports.openEvent')}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={look.text} />
        </View>
      )}
    </>
  );
  const style = [
    styles.row,
    { backgroundColor: look.wash, borderColor: look.border },
    sample && styles.sample,
  ];
  if (sample || !onOpen) {
    return (
      <View style={style} testID={`admin-report-${line.key}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
      testID={`admin-report-${line.key}`}
    >
      {body}
    </Pressable>
  );
}

export default function AdminReportsScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  // Live on open: the unfiltered query — the most recent events — is the honest starting point.
  const [draft, setDraft] = useState<Query>(EMPTY);
  const [ran, setRan] = useState<Query>(EMPTY);
  const [quick, setQuick] = useState<Quick | null>('all');
  const [pickingDates, setPickingDates] = useState(false);
  const [pickingMpp, setPickingMpp] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<number | null>(null);

  const params = useMemo(() => exportParams(ran), [ran]);
  const filtered = Object.keys(params).length > 0;
  const preview = useAdminListAiEventsQuery({
    dateFrom: params.date_from,
    dateTo: params.date_to,
    mpp: params.mpp,
    status: params.status,
    search: params.search,
    limit: PREVIEW_ROWS,
  });
  const page = preview.data;
  const edited = !same(draft, ran);

  useEffect(() => {
    if (openEvent === null) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenEvent(null);
      return true;
    });
    return () => sub.remove();
  }, [openEvent]);

  const set = (patch: Partial<Query>) => setDraft(d => ({ ...d, ...patch }));

  const run = () => {
    setProblem(null);
    setFlash(null);
    setRan({ ...draft, search: draft.search.trim() });
    if (same(draft, ran)) {
      preview.refetch();
    }
  };

  const clear = () => {
    setDraft(EMPTY);
    setRan(EMPTY);
    setQuick('all');
    setProblem(null);
    setFlash(null);
  };

  /** The file is the query that was run — the one the preview is showing. */
  const exportCsv = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setFlash(null);
    setExporting(true);
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    try {
      await downloadAndShare(
        `/reports/export/${query ? `?${query}` : ''}`,
        'ai-events.xlsx',
        XLSX_MIME,
        access,
      );
      setFlash(t('admin.reports.exported'));
    } catch {
      setProblem(t('admin.reports.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (openEvent !== null) {
    return (
      <EventRecord
        eventId={openEvent}
        canDelete={false}
        onBack={() => setOpenEvent(null)}
        onDeleted={() => setOpenEvent(null)}
      />
    );
  }

  const dateValue =
    draft.from && draft.to
      ? draft.from === draft.to
        ? day(t, draft.from)
        : `${day(t, draft.from)} – ${day(t, draft.to)}`
      : null;

  const count = page?.count ?? 0;
  const showSample = !!page && !count && !filtered;
  const lines = (page?.results ?? []).map(event => lineOf(t, event));
  const summary = page?.summary;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={preview.isFetching && !preview.isLoading}
            onRefresh={() => preview.refetch()}
          />
        }
        testID="admin-reports"
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <AppText style={styles.title}>{t('admin.reports.title')}</AppText>
            <AppText style={styles.hint}>{t('admin.reports.subtitle')}</AppText>
          </View>
          {/* Ink, as every export is: a file leaving the platform. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: exporting }}
            disabled={exporting}
            onPress={exportCsv}
            style={({ pressed }) => [styles.export, pressed && styles.pressed]}
            testID="admin-reports-export"
          >
            <Ionicons name="download-outline" size={16} color={colors.surface} />
            <AppText style={styles.exportLabel}>
              {t(exporting ? 'admin.reports.preparing' : 'admin.reports.exportCsv')}
            </AppText>
          </Pressable>
        </View>

        {!!problem && <Banner tone="error" message={problem} testID="admin-reports-problem" />}
        {!!flash && <Banner tone="info" message={flash} testID="admin-reports-flash" />}

        {/* The builder: what is reported, when, where, and which rows. */}
        <View style={styles.builder} testID="admin-reports-builder">
          <View style={styles.builderHead}>
            <Disc tone="blue" icon="construct" size={36} />
            <View style={styles.flex}>
              <AppText style={styles.builderTitle}>{t('admin.reports.build')}</AppText>
              <AppText style={styles.hint}>{t('admin.reports.buildHint')}</AppText>
            </View>
          </View>

          <Field
            tone="blue"
            icon="document-text"
            label={t('admin.reports.report')}
            hint={t('admin.reports.reportHint')}
          >
            <View style={styles.fixed}>
              <Ionicons name="medkit" size={16} color={TONE.green.text} />
              <AppText style={styles.fixedLabel}>{t('admin.reports.aiEvents')}</AppText>
            </View>
          </Field>

          <Field
            tone="green"
            icon="calendar"
            label={t('admin.reports.dates')}
            hint={t('admin.reports.datesHint')}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {QUICK.map(q => (
                <FilterChip
                  key={q}
                  label={t(`admin.reports.quick_${q.replace('-', '_')}`)}
                  icon={q === 'all' ? 'infinite' : 'time-outline'}
                  tone="green"
                  active={quick === q}
                  onPress={() => {
                    setQuick(q);
                    set(quickRange(q));
                  }}
                  testID={`admin-reports-quick-${q}`}
                />
              ))}
            </ScrollView>
            <Picker
              value={dateValue}
              placeholder={t('admin.reports.anyDate')}
              icon="calendar-outline"
              onPress={() => setPickingDates(true)}
              onClear={() => {
                setQuick('all');
                set({ from: null, to: null });
              }}
              testID="admin-reports-dates"
            />
          </Field>

          <Field
            tone="blue"
            icon="location"
            label={t('admin.reports.mpp')}
            hint={t('admin.reports.mppHint')}
          >
            <Picker
              value={draft.mpp ? `${draft.mpp.name} · ${draft.mpp.code}` : null}
              placeholder={t('admin.reports.allMpps')}
              icon="chevron-down"
              onPress={() => setPickingMpp(true)}
              onClear={() => set({ mpp: null })}
              testID="admin-reports-mpp"
            />
          </Field>

          <Field
            tone="slate"
            icon="search"
            label={t('admin.reports.search')}
            hint={t('admin.reports.searchHint')}
          >
            <TextInput
              style={styles.input}
              value={draft.search}
              onChangeText={search => set({ search })}
              placeholder={t('admin.reports.searchPlaceholder')}
              placeholderTextColor={colors.textDisabled}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={run}
              testID="admin-reports-search"
            />
          </Field>

          <Field
            tone="yolk"
            icon="flag"
            label={t('admin.reports.statusLabel')}
            hint={t('admin.reports.statusHint')}
          >
            <View style={styles.wrap}>
              {STATUSES.map(s => (
                <FilterChip
                  key={s || 'all'}
                  label={t(s ? `admin.reports.status_${s}` : 'admin.reports.allStatuses')}
                  icon={s === 'completed' ? 'checkmark-circle' : 'ellipse-outline'}
                  tone={s ? STATUS_TONE[s] : 'slate'}
                  active={draft.status === s}
                  onPress={() => set({ status: s })}
                  testID={`admin-reports-status-${s || 'all'}`}
                />
              ))}
            </View>
          </Field>

          {edited && (
            <View style={styles.edited} testID="admin-reports-edited">
              <Ionicons name="create-outline" size={14} color={TONE.yolk.text} />
              <AppText style={styles.editedText}>{t('admin.reports.edited')}</AppText>
            </View>
          )}

          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              onPress={run}
              style={({ pressed }) => [styles.runButton, pressed && styles.pressed]}
              testID="admin-reports-run"
            >
              <Ionicons name="play" size={16} color={TONE.green.onSolid} />
              <AppText style={[styles.buttonLabel, { color: TONE.green.onSolid }]}>
                {t('admin.reports.run')}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={clear}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
              testID="admin-reports-clear"
            >
              <Ionicons name="refresh" size={16} color={colors.ink} />
              <AppText style={styles.buttonLabel}>{t('admin.reports.clear')}</AppText>
            </Pressable>
          </View>
          <AppText style={styles.hint}>{t('admin.reports.noPersonal')}</AppText>
        </View>

        <Notice
          tone="blue"
          icon="shield-checkmark"
          title={t('admin.reports.noticeTitle')}
          body={t('admin.reports.noticeBody')}
          testID="admin-reports-notice"
        />

        {/* The answer to what was asked above. */}
        <View style={styles.previewHead}>
          <Disc tone="green" icon="eye" size={32} />
          <AppText style={styles.builderTitle}>{t('admin.reports.preview')}</AppText>
          <View style={styles.flex} />
          {showSample ? (
            <View testID="admin-reports-count">
              <Pill label={t('admin.reports.sampleBadge')} tone="slate" />
            </View>
          ) : page ? (
            <AppText style={styles.countText} testID="admin-reports-count">
              {t('admin.reports.matching', {
                n: num(count),
                shown: num(Math.min(PREVIEW_ROWS, count)),
              })}
            </AppText>
          ) : null}
        </View>

        {!!summary && !showSample && count > 0 && (
          <View style={styles.split} testID="admin-reports-split">
            <Pill
              label={t('admin.reports.splitCompleted', { n: num(summary.completed) })}
              tone="green"
            />
            <Pill
              label={t('admin.reports.splitOpen', { n: num(summary.unfinished) })}
              tone="yolk"
            />
            <Pill
              label={t('admin.reports.splitCancelled', { n: num(summary.cancelled) })}
              tone="red"
            />
          </View>
        )}

        {preview.isLoading || (preview.isFetching && !page) ? (
          <SkeletonTable />
        ) : preview.isError ? (
          // The example is never a stand-in for a failed request.
          <EmptyState message={t('admin.reports.error')} />
        ) : showSample ? (
          <>
            <AppText style={styles.hint} testID="admin-reports-sample">
              {t('admin.reports.sampleNote')}
            </AppText>
            {sampleLines(t).map(line => (
              <PreviewCard key={line.key} line={line} sample />
            ))}
          </>
        ) : lines.length === 0 ? (
          <EmptyState message={t('admin.reports.none')} />
        ) : (
          lines.map(line => (
            <PreviewCard key={line.key} line={line} onOpen={() => setOpenEvent(Number(line.key))} />
          ))
        )}
      </ScrollView>

      <DateRangeSheet
        visible={pickingDates}
        from={draft.from}
        to={draft.to}
        onClose={() => setPickingDates(false)}
        onApply={(from, to) => {
          // Dates chosen by hand are a range of one's own: no shortcut describes it any more.
          setQuick(null);
          set({ from, to });
          setPickingDates(false);
        }}
        onClear={() => {
          setQuick('all');
          set({ from: null, to: null });
          setPickingDates(false);
        }}
      />
      <MppSheet
        visible={pickingMpp}
        selected={draft.mpp?.code ?? null}
        onSelect={mpp => set({ mpp })}
        onClose={() => setPickingMpp(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  hint: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  title: { ...typography.h3, color: colors.ink },
  export: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  exportLabel: { ...typography.label, color: colors.surface },

  builder: {
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: TONE.blue.wash,
    borderColor: TONE.blue.border,
  },
  builderHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  builderTitle: { ...typography.bodyStrong, color: colors.ink },
  field: {
    gap: 6,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  fieldLabel: { ...typography.label, color: colors.ink },
  fixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: TONE.green.border,
    backgroundColor: TONE.green.wash,
  },
  fixedLabel: { ...typography.label, color: TONE.green.text },
  chips: { gap: spacing[2], paddingRight: spacing[2] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pickerValue: { ...typography.label, color: colors.ink, flex: 1 },
  pickerEmpty: { color: colors.textMuted },
  input: {
    ...typography.body,
    color: colors.ink,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  edited: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: TONE.yolk.wash,
    borderWidth: 1,
    borderColor: TONE.yolk.border,
  },
  editedText: { ...typography.caption, color: TONE.yolk.text, flex: 1 },
  buttons: { flexDirection: 'row', gap: spacing[2] },
  runButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: TONE.green.solid,
  },
  clearButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  buttonLabel: { ...typography.label, color: colors.ink },

  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  countText: { ...typography.caption, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  split: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  row: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  sample: { opacity: 0.6 },
  sampleText: { color: colors.textMuted },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  code: { ...typography.label, color: colors.ink },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  identities: { flexDirection: 'row', gap: spacing[3], paddingVertical: 4 },
  identity: { flex: 1 },
  identityName: { ...typography.label, color: colors.ink },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  amount: { ...typography.label, color: colors.ink },
  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  openLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
});
