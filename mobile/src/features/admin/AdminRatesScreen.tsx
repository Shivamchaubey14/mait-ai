/**
 * Rates, for an admin — what the dairy pays and recovers (the portal's Rates screen).
 *
 * Two things the payout is built from: the scheme (what an insemination earns and the retainer
 * for a busy month) and the per-material recovery rates. Shown together here, read-only — a
 * change to either reprices every Mait's month, so it is a deliberate desk action that stays on
 * the portal behind its audit entry.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { useAdminListProductsQuery, useAdminPayoutSchemeQuery } from '@api/endpoints';
import { EmptyState, Loading } from '@/components';
import { colors, ink, radius, spacing, typography } from '@theme/tokens';

import { adminStyles } from './common';

function rupees(value?: string): string {
  return `₹ ${Number(value || 0).toLocaleString('en-IN')}`;
}

export default function AdminRatesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const scheme = useAdminPayoutSchemeQuery();
  const products = useAdminListProductsQuery();
  const priced = (products.data?.results ?? []).filter(p => p.category === 'consumable');

  const loading = scheme.isLoading || products.isLoading;
  const error = scheme.isError && products.isError;

  return (
    <View style={adminStyles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <Loading />
        ) : error ? (
          <EmptyState message={t('admin.rates.error')} />
        ) : (
          <>
            {scheme.data && (
              <View style={styles.card} testID="admin-rates-scheme">
                <View style={styles.cardHead}>
                  <View style={styles.cardChip}>
                    <Ionicons name="cash" size={16} color={colors.surface} />
                  </View>
                  <Text style={styles.cardTitle}>{t('admin.rates.scheme')}</Text>
                </View>
                <Line label={t('admin.rates.commission')} value={`${rupees(scheme.data.commission_per_ai)} ${t('admin.rates.perAi')}`} />
                <Line
                  label={t('admin.rates.retainer')}
                  value={
                    scheme.data.fixed_min_ai
                      ? `${rupees(scheme.data.monthly_fixed_amount)} · ${t('admin.rates.minAi', { count: scheme.data.fixed_min_ai })}`
                      : t('admin.rates.noRetainer')
                  }
                />
                {scheme.data.straw_rate ? <Line label={t('admin.rates.straw')} value={`${rupees(scheme.data.straw_rate)} ${t('admin.rates.perPiece')}`} /> : null}
              </View>
            )}

            <Text style={styles.section}>{t('admin.rates.materials')}</Text>
            {priced.length === 0 ? (
              <EmptyState message={t('admin.rates.noMaterials')} />
            ) : (
              priced.map(product => {
                const has = Number(product.rate) > 0;
                return (
                  <View key={product.id} style={adminStyles.row} testID={`admin-rate-${product.code}`}>
                    <View style={adminStyles.rowBody}>
                      <Text style={adminStyles.rowName} numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text style={adminStyles.rowMeta} numberOfLines={1}>
                        {t('admin.rates.perUnit', { unit: product.unit })}
                      </Text>
                    </View>
                    <Text style={[styles.rate, { color: has ? colors.primaryDark : ink[500] }]}>
                      {has ? `${rupees(product.rate)}` : t('admin.rates.unpriced')}
                    </Text>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing[4], gap: spacing[3] },
  card: {
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing[2],
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[1] },
  cardChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  cardTitle: { ...typography.h3, color: colors.ink },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[3] },
  lineLabel: { ...typography.body, color: colors.textMuted, flexShrink: 1 },
  lineValue: { ...typography.bodyStrong, color: colors.ink, textAlign: 'right' },
  section: { ...typography.label, color: colors.textMuted, marginTop: spacing[2] },
  rate: { ...typography.h3 },
});
