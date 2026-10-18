/**
 * Mait payment, for an admin — the month's payout, previewed (the portal's W18 screen).
 *
 * The preview, not the file: a screen is read over a shoulder, so bank details stay masked and
 * the figures are what matters here — what each Mait is owed after the dairy recovers the cost
 * of what it issued. The workbook with full account numbers is a payment instruction and stays
 * on the portal, behind its audit entry; the handset answers "what does this month look like".
 *
 * `in_progress` is said plainly: a running total must never be read in the same voice as a
 * settled one by somebody about to pay against it.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminMaitPaymentQuery } from '@api/endpoints';
import type { MaitPaymentRow } from '@api/types';
import { EmptyState, Loading } from '@/components';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { adminStyles } from './common';

function rupees(value: string): string {
  return `₹ ${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function Row({ row }: { row: MaitPaymentRow }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={[adminStyles.row, row.overdrawn && styles.overdrawn]} testID={`admin-payment-${row.vendor_code}`}>
      <View style={adminStyles.rowBody}>
        <Text style={adminStyles.rowName} numberOfLines={1}>
          {row.mait_name}
        </Text>
        <Text style={adminStyles.rowMeta} numberOfLines={1}>
          {[row.mcc_name, t('admin.payment.ai', { count: row.ai_performed }), `−${rupees(row.deduction)}`]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View style={styles.net}>
        <Text style={[styles.netValue, row.overdrawn && styles.netOver]}>{rupees(row.net_payable)}</Text>
        {row.overdrawn && <Text style={styles.overLabel}>{t('admin.payment.overdrawn')}</Text>}
      </View>
    </View>
  );
}

export default function AdminMaitPaymentScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const report = useAdminMaitPaymentQuery();
  const data = report.data;

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {report.isLoading ? (
          <Loading />
        ) : report.isError ? (
          <EmptyState message={t('admin.payment.error')} />
        ) : !data ? (
          <EmptyState message={t('admin.payment.none')} />
        ) : (
          <>
            <View style={[styles.head, data.in_progress ? styles.headProgress : styles.headSettled]}>
              <Ionicons
                name={data.in_progress ? 'time' : 'checkmark-circle'}
                size={16}
                color={data.in_progress ? yolk[800] : colors.primaryDark}
              />
              <Text style={[styles.headLabel, { color: data.in_progress ? yolk[800] : colors.primaryDark }]}>
                {data.month} · {t(data.in_progress ? 'admin.payment.inProgress' : 'admin.payment.settled')}
              </Text>
            </View>

            <View style={styles.totals}>
              <Stat label={t('admin.payment.maits')} value={String(data.totals.maits)} />
              <Stat label={t('admin.payment.aiTotal')} value={String(data.totals.ai_performed)} />
              <Stat label={t('admin.payment.netTotal')} value={rupees(data.totals.net_payable)} wide />
            </View>

            <Text style={styles.note}>{t('admin.payment.maskedNote')}</Text>

            {data.rows.length === 0 ? (
              <EmptyState message={t('admin.payment.none')} />
            ) : (
              data.rows.map(row => <Row key={row.vendor_code || String(row.mait_id)} row={row} />)
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.stat, wide && styles.statWide]}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  headProgress: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  headSettled: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  headLabel: { ...typography.bodyStrong },

  totals: { flexDirection: 'row', gap: spacing[2] },
  stat: {
    flex: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
  },
  statWide: { flex: 1.4 },
  statValue: { ...typography.h2, color: colors.ink },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  note: { ...typography.caption, color: colors.textMuted },

  overdrawn: { borderColor: colors.error, backgroundColor: colors.errorWash },
  net: { alignItems: 'flex-end' },
  netValue: { ...typography.h3, color: colors.primaryDark },
  netOver: { color: colors.error },
  overLabel: { ...typography.caption, fontSize: 10, color: colors.error },
});
