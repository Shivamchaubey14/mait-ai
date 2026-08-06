/**
 * Stock — what a Mait is carrying, by breed.
 *
 * The number that gates everything: a Mait at zero cannot record an AI event at all, so this
 * screen says that outright rather than showing a zero and leaving them to work it out in a
 * yard with a farmer waiting.
 *
 * A breed at zero stays on the list. Dropping it would make a Mait think the breed was never
 * issued to them, when in fact they have run out of it — and those need different actions.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  useGetInventorySummaryQuery,
  useListAiEventsQuery,
  useListBreedsQuery,
} from '@api/endpoints';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList, SyncBanner } from '@/components/states';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

/** Fewer than this of one breed is worth flagging on the row itself. */
const LOW_PER_BREED = 3;

export default function StockScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const stock = useGetInventorySummaryQuery();
  const breeds = useListBreedsQuery();
  const events = useListAiEventsQuery();

  const hindi = i18n.language.startsWith('hi');
  const total = stock.data?.total_straws ?? 0;
  const byBreed = Object.entries(stock.data?.by_breed ?? {});

  /** What is held, plus any configured breed they have run out of. */
  const held = new Map<string, number>(byBreed);
  (breeds.data ?? []).forEach(breed => {
    if (!held.has(breed.code)) {
      held.set(breed.code, 0);
    }
  });
  const rows = [...held.entries()].sort((a, b) => b[1] - a[1]);
  const lowBreeds = rows.filter(([, qty]) => qty > 0 && qty <= LOW_PER_BREED).length;

  // Counted from the events already fetched for Home and History rather than guessed at.
  const usedThisMonth = (events.data?.results ?? []).filter(event => {
    const when = new Date(event.completed_at ?? event.created_at);
    const now = new Date();
    return (
      event.status === 'completed' &&
      when.getMonth() === now.getMonth() &&
      when.getFullYear() === now.getFullYear()
    );
  }).length;

  const config = (code: string) => (breeds.data ?? []).find(breed => breed.code === code);

  const label = (code: string) => {
    const found = config(code);
    return found ? (hindi && found.name_hi) || found.name : code;
  };

  const animal = (code: string) => {
    const found = config(code);
    return found ? t(`aiFlow.animalType.${found.animal_type}`) : t('stock.unknownAnimal');
  };

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
            {/* What is left and what has gone, read together: that pair is what says whether
                the round can continue. */}
            <View style={styles.summary}>
              <View style={styles.summaryHalf}>
                <Text style={styles.summaryLabel}>{t('stock.inHand')}</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    total === 0 && styles.summaryValueBad,
                    total > 0 && stock.data?.is_low_stock && styles.summaryValueWarn,
                  ]}
                >
                  {total}
                </Text>
                <Text
                  style={[
                    styles.summaryFoot,
                    (total === 0 || stock.data?.is_low_stock) && styles.summaryFootBad,
                  ]}
                  numberOfLines={1}
                >
                  {total === 0
                    ? t('stock.atZero')
                    : stock.data?.is_low_stock
                      ? t('stock.belowThreshold')
                      : t('stock.enoughForNow')}
                </Text>
              </View>

              <View style={styles.summaryHalf}>
                <Text style={styles.summaryLabel}>{t('stock.usedThisMonth')}</Text>
                <Text style={[styles.summaryValue, styles.summaryValueInfo]}>{usedThisMonth}</Text>
                <Text style={styles.summaryFoot} numberOfLines={1}>
                  {t('stock.acrossBreeds', { count: byBreed.length })}
                </Text>
              </View>
            </View>

            <Text style={styles.section}>{t('stock.byBreed')}</Text>

            {rows.length === 0 ? (
              <EmptyState
                title={t('stock.emptyTitle')}
                body={t('stock.emptyBody')}
                testID="stock-empty"
              />
            ) : (
              rows.map(([code, qty]) => {
                const low = qty > 0 && qty <= LOW_PER_BREED;
                const out = qty === 0;
                return (
                  <View
                    key={code}
                    style={[styles.row, low && styles.rowLow, out && styles.rowOut]}
                    testID={`stock-${code}`}
                  >
                    <View style={[styles.swatch, out && styles.swatchOut]} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, out && styles.rowTitleOut]} numberOfLines={1}>
                        {label(code)}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {animal(code)} · {out ? t('stock.noneInHand') : t('stock.inYourFlask')}
                      </Text>
                    </View>
                    <Text style={[styles.rowQty, out && styles.rowQtyOut]}>{qty}</Text>
                    {low && (
                      <View style={styles.lowPill}>
                        <Text style={styles.lowPillLabel}>{t('stock.low')}</Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            {(stock.data?.consumables ?? []).length > 0 && (
              <View>
                <Text style={styles.section}>{t('stock.consumables')}</Text>
                {(stock.data?.consumables ?? []).map(item => (
                  <View key={item.name} style={styles.row}>
                    <View style={[styles.swatch, styles.swatchAlt]} />
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    <Text style={[styles.rowQty, styles.rowQtyInfo]}>{item.qty}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Named rather than left to be inferred from the rows above. */}
            {lowBreeds > 0 && (
              <SyncBanner
                tone="offline"
                title={t('stock.breedsLow', { count: lowBreeds })}
                body={t('stock.breedsLowBody')}
                testID="stock-breeds-low"
              />
            )}
            {total === 0 && (
              <SyncBanner
                tone="offline"
                title={t('stock.cannotWorkTitle')}
                body={t('stock.cannotWorkBody')}
                testID="stock-at-zero"
              />
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

  summary: {
    flexDirection: 'row',
    gap: spacing[4],
    padding: spacing[4],
    marginBottom: spacing[5],
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryHalf: { flex: 1 },
  summaryLabel: { ...typography.caption, color: colors.textMuted },
  summaryValue: { ...typography.display, color: colors.primaryDark, marginVertical: 2 },
  summaryValueInfo: { color: colors.info },
  summaryValueWarn: { color: colors.secondaryPressed },
  summaryValueBad: { color: colors.error },
  summaryFoot: { ...typography.caption, color: colors.textMuted },
  summaryFootBad: { color: colors.error },

  section: { ...typography.h3, color: colors.ink, marginBottom: spacing[3] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  // A breed running out is tinted, so the list can be triaged without reading every number.
  rowLow: { borderColor: colors.error, backgroundColor: colors.errorWash },
  rowOut: { backgroundColor: colors.background },

  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryWash,
  },
  swatchAlt: { backgroundColor: colors.infoWash },
  swatchOut: { backgroundColor: colors.disabledFill },

  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowTitleOut: { color: colors.textMuted },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowQty: { ...typography.h2, color: colors.ink },
  rowQtyInfo: { color: colors.info },
  rowQtyOut: { color: colors.textDisabled },

  lowPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.errorWash,
  },
  lowPillLabel: { ...typography.caption, color: colors.error },
});
