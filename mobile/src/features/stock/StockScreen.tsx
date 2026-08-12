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
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

import {
  useGetInventorySummaryQuery,
  useListAiEventsQuery,
  useListBreedsQuery,
  useListIndentsQuery,
} from '@api/endpoints';
import PageHero from '@/components/hero';
import { EmptyState, ErrorState, SkeletonList, SyncBanner } from '@/components/states';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

/** Fewer than this of one breed is worth flagging on the row itself. */
const LOW_PER_BREED = 3;

/**
 * An icon per product, so a row is recognisable before it is read.
 *
 * Keyed on the catalogue code rather than the name: names are editable from the admin and
 * translated, codes are not. Anything unmapped falls back to a box, which is honest — it is
 * something issued to the Mait whose shape we do not know.
 */
const PRODUCT_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  SHEATH: 'medkit-outline',
  GLOVES: 'hand-left-outline',
  LN2: 'snow-outline',
  AI_GUN: 'construct-outline',
  EAR_TAG_APPLICATOR: 'pricetag-outline',
  THAWING_TRAY: 'grid-outline',
  THERMO_MONITOR: 'thermometer-outline',
};

const FALLBACK_ICON: React.ComponentProps<typeof Ionicons>['name'] = 'cube-outline';

export default function StockScreen({
  onOpenIndents,
  onRequestStock,
}: {
  onOpenIndents: () => void;
  onRequestStock: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const stock = useGetInventorySummaryQuery();
  const breeds = useListBreedsQuery();
  const events = useListAiEventsQuery();
  const indents = useListIndentsQuery();

  // Requested and approved are the ones still owed to the Mait. Issued and rejected are
  // finished business, and counting them would make the card claim work that is not coming.
  const openIndents = (indents.data?.results ?? []).filter(
    indent => indent.status === 'requested' || indent.status === 'approved',
  ).length;

  const hindi = i18n.language.startsWith('hi');
  const total = stock.data?.total_straws ?? 0;
  const byBreed = Object.entries(stock.data?.by_breed ?? {});

  // Only breeds the Mait actually holds. Listing every configured breed at zero made them
  // scroll past a dozen rows that say nothing to reach the two that do.
  const rows = byBreed.filter(([, qty]) => qty > 0).sort((a, b) => b[1] - a[1]);
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

  // Consumables are counted in units held, equipment in items held: a Mait with 40 sheaths
  // and one AI gun is carrying both, and a single "products" number would hide which.
  const consumables = stock.data?.consumables ?? [];
  const assets = stock.data?.assets ?? [];
  const consumableUnits = consumables.reduce((sum, item) => sum + item.qty, 0);
  const assetUnits = assets.reduce((sum, item) => sum + item.qty, 0);
  const everything = total + consumableUnits + assetUnits;

  const config = (code: string) => (breeds.data ?? []).find(breed => breed.code === code);

  const label = (code: string) => {
    const found = config(code);
    return found ? (hindi && found.name_hi) || found.name : code;
  };

  const animal = (code: string) => {
    const found = config(code);
    return found ? t(`aiFlow.animalType.${found.animal_type}`) : t('stock.unknownAnimal');
  };

  const buffalo = (code: string) => config(code)?.animal_type === 'BUFF';

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
            {/* Everything held, split the way it gets used. A Mait opening this screen is
                asking two questions at once — can I work, and what am I carrying — so the
                straw count keeps the emphasis and the rest is read in the same glance. */}
            <View style={styles.summary} testID="stock-insight">
              <Text style={styles.summaryEyebrow}>{t('stock.inventoryTitle')}</Text>
              <Text style={styles.summaryHeadline}>
                {everything > 0
                  ? t('stock.thingsWithYou', { count: everything })
                  : t('stock.nothingWithYou')}
              </Text>

              <View style={styles.stats}>
                <View style={[styles.stat, styles.statLead]} testID="stat-semen">
                  <Text style={styles.statLabel} numberOfLines={1}>
                    {t('stock.semen')}
                  </Text>
                  <Text
                    style={[
                      styles.statValue,
                      total === 0 && styles.statValueBad,
                      total > 0 && stock.data?.is_low_stock && styles.statValueWarn,
                    ]}
                  >
                    {total}
                  </Text>
                  <Text style={styles.statFoot} numberOfLines={1}>
                    {rows.length > 0 ? t('stock.acrossBreeds', { count: rows.length }) : '—'}
                  </Text>
                </View>

                <View style={styles.stat} testID="stat-consumables">
                  <Text style={styles.statLabel} numberOfLines={1}>
                    {t('stock.consumables')}
                  </Text>
                  <Text style={[styles.statValue, styles.statValueInfo]}>{consumableUnits}</Text>
                  <Text style={styles.statFoot} numberOfLines={1}>
                    {consumables.length > 0
                      ? t('stock.kinds', { count: consumables.length })
                      : t('stock.noneHeld')}
                  </Text>
                </View>

                <View style={styles.stat} testID="stat-assets">
                  <Text style={styles.statLabel} numberOfLines={1}>
                    {t('stock.assets')}
                  </Text>
                  <Text style={[styles.statValue, styles.statValueAsset]}>{assetUnits}</Text>
                  <Text style={styles.statFoot} numberOfLines={1}>
                    {assets.length > 0
                      ? t('stock.kinds', { count: assets.length })
                      : t('stock.noneHeld')}
                  </Text>
                </View>
              </View>

              {/* The verdict, spelled out under the numbers rather than left to be worked
                  out from them — and carrying a glyph, so it is not colour alone. */}
              <View style={styles.verdict}>
                <Ionicons
                  name={
                    total === 0
                      ? 'alert-circle'
                      : stock.data?.is_low_stock
                        ? 'warning'
                        : 'checkmark-circle'
                  }
                  size={15}
                  color={
                    total === 0
                      ? colors.error
                      : stock.data?.is_low_stock
                        ? colors.secondaryPressed
                        : colors.primaryDark
                  }
                />
                <Text
                  style={[
                    styles.verdictLabel,
                    total === 0 && styles.verdictLabelBad,
                    total > 0 && stock.data?.is_low_stock && styles.verdictLabelWarn,
                  ]}
                  numberOfLines={1}
                >
                  {total === 0
                    ? t('stock.atZero')
                    : stock.data?.is_low_stock
                      ? t('stock.belowThreshold')
                      : t('stock.enoughForNow')}
                </Text>
                <Text style={styles.verdictMeta} numberOfLines={1}>
                  {t('stock.usedThisMonthFoot', { count: usedThisMonth })}
                </Text>
              </View>
            </View>

            {/* Where a request goes after it is sent. Above the breed rows rather than under
                the equipment at the bottom: a Mait wondering where their stock is should not
                have to scroll past everything they already hold to find out. */}
            <Pressable
              accessibilityRole="button"
              onPress={onOpenIndents}
              style={({ pressed }) => [styles.indentsLink, pressed && styles.indentsLinkPressed]}
              testID="stock-open-indents"
            >
              <View style={[styles.swatch, styles.swatchAlt]}>
                <Ionicons name="cube-outline" size={17} color={colors.info} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{t('stock.yourIndents')}</Text>
                <Text style={styles.rowMeta}>
                  {openIndents > 0
                    ? t('stock.indentsOpen', { count: openIndents })
                    : t('stock.yourIndentsHint')}
                </Text>
              </View>
              {openIndents > 0 && (
                <View style={styles.openPill}>
                  <Text style={styles.openPillLabel}>{openIndents}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
            </Pressable>

            <Text style={styles.section}>{t('stock.byBreed')}</Text>

            {rows.length === 0 ? (
              <EmptyState
                title={t('stock.emptyTitle')}
                body={t('stock.emptyBody')}
                testID="stock-empty"
              />
            ) : (
              rows.map(([code, qty]) => {
                const low = qty <= LOW_PER_BREED;
                return (
                  <View
                    key={code}
                    style={[styles.row, low && styles.rowLow]}
                    testID={`stock-${code}`}
                  >
                    <View style={[styles.swatch, buffalo(code) && styles.swatchBuffalo]}>
                      {/* A real cow silhouette. No icon set bundled with Expo has a buffalo,
                          so the same bovine glyph carries both and the colour tells them
                          apart — the animal type is spelled out on the line below anyway. */}
                      <MaterialCommunityIcons
                        name="cow"
                        size={18}
                        color={buffalo(code) ? colors.ink : colors.primaryDark}
                      />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {label(code)}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {animal(code)} · {t('stock.inYourFlask')}
                      </Text>
                    </View>
                    <Text style={styles.rowQty}>{qty}</Text>
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
                  <View key={item.code || item.name} style={styles.row}>
                    <View style={[styles.swatch, styles.swatchAlt]}>
                      <Ionicons
                        name={PRODUCT_ICON[item.code] ?? FALLBACK_ICON}
                        size={16}
                        color={colors.info}
                      />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.unit}
                      </Text>
                    </View>
                    <Text style={[styles.rowQty, styles.rowQtyInfo]}>{item.qty}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Equipment, kept apart from what runs out: a Mait replaces an AI gun when it
                breaks, not when the number gets low. */}
            {(stock.data?.assets ?? []).length > 0 && (
              <View>
                <Text style={styles.section}>{t('stock.assets')}</Text>
                {(stock.data?.assets ?? []).map(item => (
                  <View key={item.code || item.name} style={styles.row}>
                    <View style={[styles.swatch, styles.swatchAsset]}>
                      <Ionicons
                        name={PRODUCT_ICON[item.code] ?? FALLBACK_ICON}
                        size={16}
                        color={colors.secondaryPressed}
                      />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.unit}
                      </Text>
                    </View>
                    <Text style={styles.rowQty}>{item.qty}</Text>
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

        {/* This screen's one action, at the foot of its own content. It used to float in the
            tab bar, where it changed job depending on which tab was open. */}
        <Pressable
          accessibilityRole="button"
          onPress={onRequestStock}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          testID="stock-request"
        >
          <Ionicons name="add" size={20} color={colors.surface} />
          <Text style={styles.actionLabel}>{t('requestStock.action')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing[5] },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing[5],
  },
  actionPressed: { backgroundColor: colors.primaryPressed },
  actionLabel: { ...typography.bodyStrong, color: colors.surface },

  summary: {
    padding: spacing[4],
    marginBottom: spacing[5],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  summaryEyebrow: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  summaryHeadline: { ...typography.h2, color: colors.ink, marginTop: 2 },

  stats: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[4] },
  stat: {
    flex: 1,
    padding: spacing[3],
    backgroundColor: colors.background,
    borderRadius: radius.sm,
  },
  // The straw count is the one that decides whether the day can start, so it is tinted
  // rather than left to sit as one of three equal boxes.
  statLead: { backgroundColor: colors.primaryWash },
  statLabel: { ...typography.caption, color: colors.textMuted },
  statValue: { ...typography.h1, color: colors.primaryDark, marginVertical: 2 },
  statValueInfo: { color: colors.info },
  statValueAsset: { color: colors.ink },
  statValueWarn: { color: colors.secondaryPressed },
  statValueBad: { color: colors.error },
  statFoot: { ...typography.caption, color: colors.textMuted },

  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  verdictLabel: { ...typography.label, color: colors.primaryDark, flexShrink: 1 },
  verdictLabelWarn: { color: colors.secondaryPressed },
  verdictLabelBad: { color: colors.error },
  verdictMeta: { ...typography.caption, color: colors.textMuted, marginLeft: 'auto' },

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

  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryWash,
  },
  swatchBuffalo: { backgroundColor: colors.background },
  swatchAlt: {
    backgroundColor: colors.infoWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchAsset: {
    backgroundColor: colors.secondaryWash,
    alignItems: 'center',
    justifyContent: 'center',
  },

  indentsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[2],
    padding: spacing[3],
    marginBottom: spacing[5],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  indentsLinkPressed: { backgroundColor: colors.background },

  openPill: {
    minWidth: 24,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.infoWash,
  },
  openPillLabel: { ...typography.label, color: colors.info },

  rowBody: { flex: 1 },
  rowTitle: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowQty: { ...typography.h2, color: colors.ink },
  rowQtyInfo: { color: colors.info },

  lowPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.errorWash,
  },
  lowPillLabel: { ...typography.caption, color: colors.error },
});
