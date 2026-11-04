/**
 * Mait payment, for an admin — the portal's `mait-payment.html` on a handset.
 *
 * What the month owes each Mait, and what comes back out of it. Preview then download, as
 * Reports does and for a stronger reason: the workbook is a payment instruction. Somebody opens
 * it and money moves, so the person sending it reads it first — against the rates it was built
 * from, which are on the same screen and editable there.
 *
 * The portal draws the office's nineteen-column sheet; a phone cannot, and shrinking it is how a
 * payout sheet becomes unreadable. So each Mait is a card that leads with the figure that leaves
 * the building — net payable — and opens to every column of their row, in the sheet's order:
 * what was earned, what was issued and recovered, what is paid, and where it is paid to. Nothing
 * on the sheet is left out, so the preview cannot agree with itself and disagree with the file.
 *
 * Money is formatted and quantities are not: "₹71" for seventy-one straws is the kind of thing
 * noticed a month later. Bank details are masked here and whole only in the workbook, which is
 * why downloading asks first.
 *
 * Colours: a Mait who owes more than they earned is red — that row is not a payment. A Mait
 * with no bank details on file is yellow — waiting on somebody to enter them. The rest are green.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { SkeletonOverview } from '@/components/skeleton';
import { Sheet } from '@/components/BottomSheet';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import { initials } from '@/components/frame';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import { useAdminMaitPaymentQuery, useAdminUpdatePayoutSchemeMutation } from '@api/endpoints';
import { downloadAndShare } from '@api/files';
import type { MaitPaymentReport, MaitPaymentRow } from '@api/types';
import type { RootState } from '@/store';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The four material columns, in the order the office's sheet reads them. */
const MATERIALS = ['semen', 'ln2', 'sheath', 'gloves'] as const;

/** Payroll starts here: the server refuses any month before it. */
const EARLIEST = { year: 2026, month: 1 };

/** As far back as anybody re-opens a payout: a year and the run-up to it. */
const MONTH_CHOICES = 18;

type Filter = 'all' | 'overdrawn' | 'noBank';

/** "2026-10" for a date. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The months on offer, newest first, starting at the one in progress — never before payroll
 * began, because the server answers those with an error rather than an empty sheet.
 */
export function monthChoices(today: Date = new Date()): string[] {
  const months: string[] = [];
  for (let back = 0; back < MONTH_CHOICES; back += 1) {
    const when = new Date(today.getFullYear(), today.getMonth() - back, 1);
    if (
      when.getFullYear() < EARLIEST.year ||
      (when.getFullYear() === EARLIEST.year && when.getMonth() + 1 < EARLIEST.month)
    ) {
      break;
    }
    months.push(monthKey(when));
  }
  return months;
}

function monthLabel(t: TFunction, key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) {
    return key;
  }
  const names = t('admin.payment.monthNames', { returnObjects: true }) as string[];
  return `${names[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

/** Whole rupees — the sheet has never carried paise. A minus sign, never brackets. */
export function money(value: string | number | null | undefined): string {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) {
    return '—';
  }
  return `${n < 0 ? '−₹' : '₹'}${Math.abs(n).toLocaleString('en-IN')}`;
}

function count(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString('en-IN');
}

function toneOf(row: MaitPaymentRow): ToneName {
  if (row.overdrawn) {
    return 'red';
  }
  return row.has_bank_details ? 'green' : 'yolk';
}

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  footTone,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value: string;
  foot: string;
  footTone?: ToneName;
  testID: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
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
      <AppText
        style={[styles.tileFoot, footTone && { color: TONE[footTone].text }]}
        testID={`${testID}-foot`}
      >
        {foot}
      </AppText>
    </View>
  );
}

/** One line of a card's breakdown. `strong` for the sub-totals the sheet rules off. */
function Line({
  label,
  value,
  strong,
  tone,
  testID,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: ToneName;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.line, strong && styles.lineStrong]}>
      <AppText style={[styles.lineLabel, strong && styles.lineLabelStrong]}>{label}</AppText>
      <AppText
        style={[
          styles.lineValue,
          strong && styles.lineValueStrong,
          tone && { color: TONE[tone].text },
        ]}
        testID={testID}
      >
        {value}
      </AppText>
    </View>
  );
}

function Section({ icon, title }: { icon: string; title: string }): React.JSX.Element {
  return (
    <View style={styles.section}>
      {icon === 'straw' ? (
        <Glyph name={STRAW_GLYPH} size={14} color={colors.textMuted} />
      ) : (
        <Ionicons name={icon as never} size={14} color={colors.textMuted} />
      )}
      <AppText style={styles.sectionLabel}>{title}</AppText>
    </View>
  );
}

function MaitCard({
  row,
  open,
  onToggle,
}: {
  row: MaitPaymentRow;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = toneOf(row);
  const look = TONE[tone];
  const code = row.vendor_code || String(row.mait_id);
  const added = MATERIALS.filter(m => Number(row.admin_quantities?.[m]) > 0);

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-payment-${code}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        testID={`admin-payment-toggle-${code}`}
      >
        <View style={styles.cardTop}>
          <View style={styles.serial}>
            <AppText style={styles.serialLabel}>{row.serial}</AppText>
          </View>
          <Disc tone={tone} text={initials(row.mait_name)} size={34} />
          <View style={styles.flex}>
            <AppText style={styles.cardName}>{row.mait_name}</AppText>
            <AppText style={styles.hint}>
              {[row.vendor_code, row.mcc_name].filter(Boolean).join(' · ')}
            </AppText>
          </View>
          <View style={styles.netBox}>
            <AppText
              style={[styles.netValue, { color: look.text }]}
              testID={`admin-payment-net-${code}`}
            >
              {money(row.net_payable)}
            </AppText>
            <AppText style={styles.hint}>{t('admin.payment.net')}</AppText>
          </View>
        </View>
        <View style={styles.cardMeta}>
          <Pill label={t('admin.payment.aiN', { count: row.ai_performed })} tone="blue" />
          {row.overdrawn && <Pill label={t('admin.payment.overdrawn')} tone="red" />}
          {!row.has_bank_details && <Pill label={t('admin.payment.noBank')} tone="yolk" />}
          <View style={styles.flex} />
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </View>
      </Pressable>

      {open && (
        <View style={styles.inset} testID={`admin-payment-detail-${code}`}>
          <Section icon="trending-up" title={t('admin.payment.earned')} />
          <Line label={t('admin.payment.aiPerformed')} value={count(row.ai_performed)} />
          <Line label={t('admin.payment.commission')} value={money(row.commission)} />
          <Line label={t('admin.payment.fixed')} value={money(row.fixed_amount)} />
          <Line
            label={t('admin.payment.total')}
            value={money(row.gross)}
            strong
            testID={`admin-payment-gross-${code}`}
          />

          <Section icon="straw" title={t('admin.payment.issued')} />
          {MATERIALS.map(m => (
            <Line
              key={m}
              label={t(`admin.payment.m_${m}`)}
              value={
                Number(row.recoveries?.[m]) > 0
                  ? `${count(row.quantities?.[m])} · ${money(row.recoveries?.[m])}`
                  : count(row.quantities?.[m])
              }
              testID={`admin-payment-${m}-${code}`}
            />
          ))}
          {added.length > 0 && (
            <AppText style={styles.added} testID={`admin-payment-added-${code}`}>
              {t('admin.payment.addedByAdmin', {
                list: added
                  .map(m => `${count(row.admin_quantities?.[m])} ${t(`admin.payment.m_${m}`)}`)
                  .join(', '),
              })}
            </AppText>
          )}
          <Line
            label={t('admin.payment.deduction')}
            value={money(row.deduction)}
            tone="yolk"
            testID={`admin-payment-deduction-${code}`}
          />
          <Line
            label={t('admin.payment.afterDeduction')}
            value={money(row.after_deduction)}
            strong
          />
          <Line label={t('admin.payment.tagging')} value={money(row.tagging)} />
          <Line
            label={t('admin.payment.netPayable')}
            value={money(row.net_payable)}
            strong
            tone={row.overdrawn ? 'red' : 'green'}
          />

          <Section icon="card" title={t('admin.payment.paidTo')} />
          <Line
            label={t('admin.payment.account')}
            value={row.bank_account_no || '—'}
            testID={`admin-payment-account-${code}`}
          />
          <Line label={t('admin.payment.ifsc')} value={row.ifsc_code || '—'} />
          <Line label={t('admin.payment.pan')} value={row.pan_no || '—'} />
          <Line label={t('admin.payment.vendor')} value={row.vendor_code || '—'} />
          {!row.has_bank_details && (
            <AppText style={styles.warn}>{t('admin.payment.noBankBody')}</AppText>
          )}
        </View>
      )}
    </View>
  );
}

/** The sheet's total row: the same columns, summed. */
function Totals({ report }: { report: MaitPaymentReport }): React.JSX.Element {
  const { t } = useTranslation();
  const totals = report.totals;
  return (
    <View style={styles.totals} testID="admin-payment-totals">
      <View style={styles.cardTop}>
        <Disc tone="slate" icon="calculator" size={32} />
        <AppText style={[styles.cardName, styles.flex]}>{t('admin.payment.totalRow')}</AppText>
        <AppText style={styles.totalsNet}>{money(totals.net_payable)}</AppText>
      </View>
      <View style={styles.inset}>
        <Line label={t('admin.payment.aiPerformed')} value={count(totals.ai_performed)} />
        <Line label={t('admin.payment.commission')} value={money(totals.commission)} />
        <Line label={t('admin.payment.fixed')} value={money(totals.fixed_amount)} />
        <Line label={t('admin.payment.total')} value={money(totals.gross)} strong />
        {MATERIALS.map(m => (
          <Line key={m} label={t(`admin.payment.m_${m}`)} value={count(totals.quantities?.[m])} />
        ))}
        <Line label={t('admin.payment.deduction')} value={money(totals.deduction)} tone="yolk" />
        <Line
          label={t('admin.payment.afterDeduction')}
          value={money(totals.after_deduction)}
          strong
        />
        <Line label={t('admin.payment.tagging')} value={money(totals.tagging)} />
        <Line
          label={t('admin.payment.netPayable')}
          value={money(totals.net_payable)}
          strong
          tone="green"
          testID="admin-payment-totals-net"
        />
      </View>
    </View>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  onFocus,
  rupee = true,
  hint,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  rupee?: boolean;
  hint?: string;
  testID: string;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      <View style={styles.moneyInput}>
        {rupee && <AppText style={styles.rupee}>₹</AppText>}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={v => onChange(v.replace(/[^\d.]/g, ''))}
          onFocus={onFocus}
          keyboardType="numeric"
          testID={testID}
        />
      </View>
      {!!hint && <AppText style={styles.hint}>{hint}</AppText>}
    </View>
  );
}

/**
 * The legend at the foot of the office's sheet — except these are the figures the rows were
 * built from, and editable, because they are the terms of somebody's engagement.
 */
function RateCard({
  report,
  onSaved,
  reveal,
}: {
  report: MaitPaymentReport;
  onSaved: () => void;
  reveal: (field: View | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [save, saving] = useAdminUpdatePayoutSchemeMutation();
  const asText = (v: string | number | undefined) => String(Math.round(Number(v) || 0));
  const initial = useMemo(
    () => ({
      commission: asText(report.scheme.commission_per_ai),
      fixed: asText(report.scheme.monthly_fixed_amount),
      threshold: String(report.scheme.fixed_min_ai ?? 0),
      straw: asText(report.rates.semen),
    }),
    [report],
  );
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const ref = useRef<View>(null);

  // A rebuilt sheet brings the figures it was built from.
  useEffect(() => setForm(initial), [initial]);

  const dirty =
    form.commission !== initial.commission ||
    form.fixed !== initial.fixed ||
    form.threshold !== initial.threshold ||
    form.straw !== initial.straw;

  const unpriced = MATERIALS.filter(m => !Number(report.rates[m]));

  const submit = async () => {
    setProblem(null);
    const values = [form.commission, form.fixed, form.threshold, form.straw];
    if (values.some(v => v.trim() === '' || Number.isNaN(Number(v)) || Number(v) < 0)) {
      setProblem(t('admin.payment.rateInvalid'));
      return;
    }
    try {
      await save({
        commission_per_ai: form.commission,
        monthly_fixed_amount: form.fixed,
        fixed_min_ai: Math.round(Number(form.threshold)),
        straw_rate: form.straw,
      }).unwrap();
      onSaved();
    } catch (error) {
      const data = (error as { data?: Record<string, unknown> })?.data;
      const first = data ? Object.values(data)[0] : null;
      setProblem(
        (Array.isArray(first) ? String(first[0]) : typeof first === 'string' ? first : null) ??
          t('admin.payment.rateFailed'),
      );
    }
  };

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));
  const focus = () => reveal(ref.current);

  return (
    <View style={styles.rateCard} testID="admin-payment-rates" ref={ref} collapsable={false}>
      <View style={styles.cardTop}>
        <Disc tone="green" icon="pricetags" size={34} />
        <AppText style={[styles.cardName, styles.flex]}>{t('admin.payment.rateCard')}</AppText>
        <View testID="admin-payment-rate-state">
          <Pill
            label={
              unpriced.length
                ? t('admin.payment.notPricedN', { n: unpriced.length })
                : t('admin.payment.allPriced')
            }
            tone={unpriced.length ? 'yolk' : 'green'}
          />
        </View>
      </View>

      <MoneyField
        label={t('admin.payment.commissionPerAi')}
        value={form.commission}
        onChange={commission => set({ commission })}
        onFocus={focus}
        testID="admin-payment-commission"
      />
      <MoneyField
        label={t('admin.payment.monthlyFixed')}
        value={form.fixed}
        onChange={fixed => set({ fixed })}
        onFocus={focus}
        testID="admin-payment-fixed"
      />
      <MoneyField
        label={t('admin.payment.earnedAt')}
        value={form.threshold}
        onChange={threshold => set({ threshold: threshold.replace(/\D/g, '') })}
        onFocus={focus}
        rupee={false}
        hint={t('admin.payment.earnedAtHint')}
        testID="admin-payment-threshold"
      />
      <MoneyField
        label={t('admin.payment.strawRate')}
        value={form.straw}
        onChange={straw => set({ straw })}
        onFocus={focus}
        testID="admin-payment-straw"
      />

      {!!problem && <Banner tone="error" message={problem} testID="admin-payment-rate-problem" />}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !dirty || saving.isLoading }}
        disabled={!dirty || saving.isLoading}
        onPress={submit}
        style={({ pressed }) => [
          styles.save,
          (!dirty || saving.isLoading) && styles.saveOff,
          pressed && styles.pressed,
        ]}
        testID="admin-payment-save"
      >
        <Ionicons name="save" size={16} color={TONE.green.onSolid} />
        <AppText style={styles.saveLabel}>
          {t(saving.isLoading ? 'admin.payment.saving' : 'admin.payment.saveRates')}
        </AppText>
      </Pressable>
      <AppText style={[styles.hint, dirty && { color: TONE.yolk.text }]}>
        {t(dirty ? 'admin.payment.unsaved' : 'admin.payment.rebuildsHint')}
      </AppText>

      {/* Read-only: a glove has one price across the platform, set where the catalogue is. */}
      <View style={styles.inset}>
        <Section icon="cube" title={t('admin.payment.materials')} />
        {MATERIALS.filter(m => m !== 'semen').map(m => {
          const rate = Number(report.rates[m]) || 0;
          return (
            <Line
              key={m}
              label={t(`admin.payment.m_${m}`)}
              value={rate ? money(rate) : t('admin.payment.notPriced')}
              tone={rate ? undefined : 'yolk'}
              testID={`admin-payment-rate-${m}`}
            />
          );
        })}
        <AppText style={styles.hint}>{t('admin.payment.materialsHint')}</AppText>
      </View>
    </View>
  );
}

export default function AdminMaitPaymentScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const store = useStore<RootState>();
  const months = useMemo(() => monthChoices(), []);
  const [month, setMonth] = useState(months[0] ?? monthKey(new Date()));
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();

  const report = useAdminMaitPaymentQuery({ month });
  const data = report.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const needle = term.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(row => {
        if (filter === 'overdrawn' && !row.overdrawn) {
          return false;
        }
        if (filter === 'noBank' && row.has_bank_details) {
          return false;
        }
        return (
          !needle ||
          row.mait_name.toLowerCase().includes(needle) ||
          (row.vendor_code ?? '').toLowerCase().includes(needle) ||
          (row.mcc_name ?? '').toLowerCase().includes(needle)
        );
      }),
    [rows, filter, needle],
  );
  const noBank = rows.filter(r => !r.has_bank_details).length;

  /** The workbook carries whole account numbers, so it is asked for, never just fetched. */
  const confirmExport = () => {
    Alert.alert(t('admin.payment.exportTitle'), t('admin.payment.exportBody'), [
      { text: t('admin.payment.cancel'), style: 'cancel' },
      { text: t('admin.payment.download'), onPress: exportWorkbook },
    ]);
  };

  const exportWorkbook = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setFlash(null);
    setExporting(true);
    try {
      await downloadAndShare(
        `/reports/mait-payment/export/?month=${encodeURIComponent(month)}`,
        `mait-payment-${month}.xlsx`,
        XLSX,
        access,
      );
    } catch {
      setProblem(t('admin.payment.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const totals = data?.totals;
  const scheme = data?.scheme;

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroller}
        innerViewRef={content}
        contentContainerStyle={[
          styles.body,
          !!keyboard && { paddingBottom: keyboard + spacing[4] },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={report.isFetching && !report.isLoading}
            onRefresh={() => report.refetch()}
          />
        }
        testID="admin-payment"
      >
        <View>
          <AppText style={styles.title}>{t('admin.payment.title')}</AppText>
          <AppText style={styles.hint}>{t('admin.payment.subtitle')}</AppText>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
            testID="admin-payment-month"
          >
            <Ionicons name="calendar" size={16} color={colors.info} />
            <AppText style={styles.monthLabel} numberOfLines={1} testID="admin-payment-month-value">
              {monthLabel(t, month)}
            </AppText>
            <Ionicons name="chevron-down" size={16} color={colors.info} />
          </Pressable>
          {/* Ink, as every export is: a file leaving the platform. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: exporting }}
            disabled={exporting}
            onPress={confirmExport}
            style={({ pressed }) => [styles.export, pressed && styles.pressed]}
            testID="admin-payment-export"
          >
            <Ionicons name="download-outline" size={16} color={colors.surface} />
            <AppText style={styles.exportLabel}>
              {t(exporting ? 'admin.payment.preparing' : 'admin.payment.downloadWorkbook')}
            </AppText>
          </Pressable>
        </View>

        {!!problem && <Banner tone="error" message={problem} testID="admin-payment-problem" />}
        {!!flash && <Banner tone="info" message={flash} testID="admin-payment-flash" />}

        {report.isLoading || (report.isFetching && !data) ? (
          <SkeletonOverview />
        ) : report.isError || !data || !totals || !scheme ? (
          <EmptyState
            message={
              (report.error as { data?: { month?: string[] | string } })?.data?.month
                ? String((report.error as { data: { month: string[] | string } }).data.month)
                : t('admin.payment.error')
            }
          />
        ) : (
          <>
            {/* A running total must never read in the voice of a settled one. */}
            <View
              style={[
                styles.state,
                data.in_progress
                  ? { backgroundColor: TONE.yolk.wash, borderColor: TONE.yolk.border }
                  : { backgroundColor: TONE.green.wash, borderColor: TONE.green.border },
              ]}
              testID="admin-payment-state"
            >
              <Ionicons
                name={data.in_progress ? 'time' : 'checkmark-circle'}
                size={18}
                color={data.in_progress ? TONE.yolk.text : TONE.green.text}
              />
              <AppText
                style={[
                  styles.stateLabel,
                  { color: data.in_progress ? TONE.yolk.text : TONE.green.text },
                ]}
              >
                {t(data.in_progress ? 'admin.payment.inProgress' : 'admin.payment.finished', {
                  month: monthLabel(t, data.month),
                })}
              </AppText>
            </View>

            {/* What was done, what it earns, what is recovered, and what is actually paid. */}
            <View style={styles.tiles}>
              <Tile
                tone="blue"
                icon="medkit"
                label={t('admin.payment.tileAi')}
                value={count(totals.ai_performed)}
                foot={t('admin.payment.tileAiFoot', {
                  n: count(totals.maits),
                  rate: money(scheme.commission_per_ai),
                })}
                testID="admin-payment-tile-ai"
              />
              <Tile
                tone="slate"
                icon="wallet"
                label={t('admin.payment.tileEarned')}
                value={money(totals.gross)}
                foot={t('admin.payment.tileEarnedFoot', {
                  commission: money(totals.commission),
                  fixed: money(totals.fixed_amount),
                })}
                testID="admin-payment-tile-earned"
              />
            </View>
            <View style={styles.tiles}>
              <Tile
                tone="yolk"
                icon="arrow-undo"
                label={t('admin.payment.tileRecovered')}
                value={money(totals.deduction)}
                foot={t('admin.payment.tileRecoveredFoot', {
                  n: count(totals.quantities?.semen),
                })}
                testID="admin-payment-tile-recovered"
              />
              <Tile
                tone={totals.overdrawn ? 'red' : 'green'}
                icon="cash"
                label={t('admin.payment.tileNet')}
                value={money(totals.net_payable)}
                foot={
                  totals.overdrawn
                    ? t('admin.payment.oweMore', { count: totals.overdrawn })
                    : t(data.in_progress ? 'admin.payment.soFarIn' : 'admin.payment.toBePaid', {
                        month: monthLabel(t, data.month),
                      })
                }
                footTone={totals.overdrawn ? 'red' : undefined}
                testID="admin-payment-tile-net"
              />
            </View>

            <View style={styles.sheetHead}>
              <Disc tone="green" icon="document-text" size={32} />
              <View style={styles.flex}>
                <AppText style={styles.cardName}>{t('admin.payment.sheet')}</AppText>
                <AppText style={styles.hint} testID="admin-payment-count">
                  {[
                    t('admin.payment.maitsN', { count: totals.maits }),
                    monthLabel(t, data.month),
                    ...(totals.overdrawn
                      ? [t('admin.payment.toCheck', { n: totals.overdrawn })]
                      : []),
                  ].join(' · ')}
                </AppText>
              </View>
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.info} />
              <TextInput
                style={styles.searchInput}
                value={term}
                onChangeText={setTerm}
                placeholder={t('admin.payment.searchPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                autoCorrect={false}
                autoCapitalize="none"
                testID="admin-payment-search"
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
              contentContainerStyle={styles.chips}
            >
              <FilterChip
                label={t('admin.payment.filterAll', { n: rows.length })}
                icon="people"
                tone="slate"
                active={filter === 'all'}
                onPress={() => setFilter('all')}
                testID="admin-payment-filter-all"
              />
              <FilterChip
                label={t('admin.payment.filterOverdrawn', { n: totals.overdrawn })}
                icon="alert-circle"
                tone="red"
                active={filter === 'overdrawn'}
                onPress={() => setFilter('overdrawn')}
                testID="admin-payment-filter-overdrawn"
              />
              <FilterChip
                label={t('admin.payment.filterNoBank', { n: noBank })}
                icon="card-outline"
                tone="yolk"
                active={filter === 'noBank'}
                onPress={() => setFilter('noBank')}
                testID="admin-payment-filter-noBank"
              />
            </ScrollView>

            {shown.length === 0 ? (
              <EmptyState
                message={t(rows.length ? 'admin.payment.noMatch' : 'admin.payment.none')}
              />
            ) : (
              shown.map(row => (
                <MaitCard
                  key={row.vendor_code || String(row.mait_id)}
                  row={row}
                  open={openRow === row.mait_id}
                  onToggle={() => setOpenRow(o => (o === row.mait_id ? null : row.mait_id))}
                />
              ))
            )}

            {rows.length > 0 && <Totals report={data} />}

            <RateCard
              report={data}
              reveal={api.reveal}
              onSaved={() => setFlash(t('admin.payment.ratesSaved'))}
            />

            <Notice
              tone="blue"
              icon="shield-checkmark"
              title={t('admin.payment.noticeTitle')}
              body={t('admin.payment.noticeBody')}
              testID="admin-payment-notice"
            />
          </>
        )}
      </ScrollView>

      <Sheet
        visible={picking}
        title={t('admin.payment.pickMonth')}
        onClose={() => setPicking(false)}
        testID="admin-payment-month-sheet"
      >
        {months.map((m, i) => {
          const on = m === month;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setMonth(m);
                setOpenRow(null);
                setFlash(null);
                setPicking(false);
              }}
              style={[styles.option, on && styles.optionOn]}
              testID={`admin-payment-month-${m}`}
            >
              <AppText style={[styles.optionLabel, on && { color: colors.info }]}>
                {monthLabel(t, m)}
                {i === 0 ? ` · ${t('admin.payment.running')}` : ''}
              </AppText>
              {on && <Ionicons name="checkmark" size={18} color={colors.info} />}
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  hint: { ...typography.caption, color: colors.textMuted },
  title: { ...typography.h3, color: colors.ink },

  actions: { flexDirection: 'row', gap: spacing[2] },
  monthButton: {
    flex: 1,
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
  monthLabel: { ...typography.label, color: colors.ink, flex: 1 },
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

  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  stateLabel: { ...typography.label, flex: 1 },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tileFoot: { ...typography.caption, color: colors.ink },

  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
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
  chips: { gap: spacing[2], paddingRight: spacing[4] },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardHead: { gap: spacing[2] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  cardName: { ...typography.bodyStrong, color: colors.ink },
  serial: {
    minWidth: 26,
    height: 22,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: ink[200],
  },
  serialLabel: { ...typography.caption, color: colors.textMuted },
  netBox: { alignItems: 'flex-end' },
  netValue: { ...typography.h3 },
  inset: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 2 },
  sectionLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: 5,
  },
  lineStrong: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineLabel: { ...typography.caption, color: colors.textMuted },
  lineLabelStrong: { color: colors.ink, fontFamily: typography.label.fontFamily },
  lineValue: { ...typography.label, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  lineValueStrong: { fontFamily: typography.h3.fontFamily },
  added: { ...typography.caption, color: TONE.blue.text, paddingVertical: 4 },
  warn: { ...typography.caption, color: TONE.yolk.text, paddingVertical: 6 },

  totals: {
    padding: spacing[3],
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: TONE.slate.wash,
    borderColor: TONE.slate.border,
  },
  totalsNet: { ...typography.h3, color: TONE.green.text },

  rateCard: {
    padding: spacing[3],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: TONE.green.wash,
    borderColor: TONE.green.border,
  },
  field: { gap: 4 },
  fieldLabel: { ...typography.label, color: colors.ink },
  moneyInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: TONE.green.border,
    backgroundColor: colors.surface,
  },
  rupee: { ...typography.label, color: colors.textMuted },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: TONE.green.solid,
  },
  saveOff: { opacity: 0.5 },
  saveLabel: { ...typography.label, color: TONE.green.onSolid },

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
