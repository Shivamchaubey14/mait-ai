/**
 * Stock — what a Mait is carrying, by breed.
 *
 * The number that gates everything: a Mait at zero cannot record an AI event at all, so this
 * screen says that outright rather than showing a zero and leaving them to work it out in a
 * yard with a farmer waiting.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery } from '@api/endpoints';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList, SyncBanner } from '@/components/states';
import { colors, radius, shadows, spacing, typography } from '@theme/tokens';

export default function StockScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const stock = useGetInventorySummaryQuery();

  const byBreed = Object.entries(stock.data?.by_breed ?? {});
  const total = stock.data?.total_straws ?? 0;

  return (
    <View style={styles.root}>
      <PageHero title={t('stock.title')} subtitle={t('stock.subtitle')} />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={stock.isFetching}
            onRefresh={stock.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {stock.isLoading ? (
          <SkeletonList rows={4} />
        ) : stock.isError ? (
          <ErrorState
            title={t('stock.errorTitle')}
            onRetry={() => stock.refetch()}
            busy={stock.isFetching}
          />
        ) : (
          <View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{t('stock.totalLabel')}</Text>
              <Text style={[styles.totalValue, total === 0 && styles.totalValueBad]}>{total}</Text>
              <Text style={styles.totalFoot}>
                {total === 0
                  ? t('stock.atZero')
                  : stock.data?.is_low_stock
                    ? t('stock.runningLow')
                    : t('stock.enoughForNow')}
              </Text>
            </View>

            {/* Not a warning. At zero the app cannot record anything, and saying so here is
                cheaper than a Mait discovering it at step 4 with an animal waiting. */}
            {total === 0 && (
              <SyncBanner
                tone="offline"
                title={t('stock.cannotWorkTitle')}
                body={t('stock.cannotWorkBody')}
                testID="stock-at-zero"
              />
            )}

            {byBreed.length === 0 ? (
              <EmptyState
                title={t('stock.emptyTitle')}
                body={t('stock.emptyBody')}
                testID="stock-empty"
              />
            ) : (
              byBreed.map(([breed, qty]) => (
                <View key={breed} style={styles.row} testID={`stock-${breed}`}>
                  <View style={styles.swatch} />
                  <Text style={styles.rowTitle}>{breed}</Text>
                  <Text style={styles.rowQty}>{qty}</Text>
                </View>
              ))
            )}

            {(stock.data?.consumables ?? []).length > 0 && (
              <View>
                <Text style={styles.section}>{t('stock.consumables')}</Text>
                {(stock.data?.consumables ?? []).map(item => (
                  <View key={item.name} style={styles.row}>
                    <View style={[styles.swatch, styles.swatchAlt]} />
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.rowQty}>{item.qty}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  total: {
    padding: spacing[5],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    alignItems: 'center',
    ...shadows.card,
  },
  totalLabel: { ...typography.caption, color: colors.textMuted },
  totalValue: { ...typography.display, fontSize: 44, lineHeight: 52, color: colors.ink },
  totalValueBad: { color: colors.error },
  totalFoot: { ...typography.body, color: colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadows.card,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryWash,
  },
  swatchAlt: { backgroundColor: colors.secondaryWash },
  rowTitle: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  rowQty: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.ink },

  section: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
});
