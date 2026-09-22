/**
 * Stock in the zone, by place first.
 *
 * A manager works out which way to drive before they work out who to ring, so the screen
 * opens on **locations**: one card per chilling centre, with what is held under it, how many
 * of its Maits are empty, and which depot could fix that. A centre with somebody at zero and
 * a full depot down the road is a different morning from one with nobody at zero at all, and
 * that difference should be readable without opening anything.
 *
 * Behind the same switch are **Products** — every item in the zone by category (straws,
 * consumables, equipment) with where it is and what is on its way — and the two flat lists the
 * answer is built from: *Maits*, emptiest first, and *Depots*. At zero is counted apart from merely low, everywhere: at zero a Mait
 * cannot record an event at all, which is a stopped Mait rather than a warning.
 *
 * **Each Mait is counted at exactly one centre**, so the location cards sum to the figure in
 * the tile above them. The centres they also cover are named on their row — the server
 * decides this, not the screen, and `apps/zonal/stock.py` says why.
 *
 * **Every card wears its state**, the way the Zone and Indents screens do: a wash with a
 * matching border, red where somebody is at zero, yolk where somebody is low, green where
 * everybody can work — and blue for a depot, which is a fact about supply rather than a
 * problem. Each carries its glyph on a solid chip, its figure in a white badge, and its
 * breeds as chips with the count on a disc, so a card reads before a word of it is.
 */

import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import type { GlyphName } from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import { useGetZoneStockQuery } from '@api/endpoints';
import type {
  ZoneStockLocation,
  ZoneStockMait,
  ZoneStockProduct,
  ZoneStockStore,
} from '@api/types';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { colors, green, radius, spacing, typography, yolk } from '@theme/tokens';

import { initials, Pill, Segmented, Tile, Tiles, ZonalHero, zonalStyles } from './parts';
import type { TileTone } from './parts';
import { useLive } from './live';

type View_ = 'locations' | 'products' | 'maits' | 'stores';

type Category = 'straw' | 'consumable' | 'asset';

/** Each category in its own colour and glyph, so the three read apart at a glance. */
const CATEGORY: Record<Category, { tone: TileTone; icon: GlyphName }> = {
  straw: { tone: 'info', icon: STRAW_GLYPH },
  consumable: { tone: 'good', icon: 'flask' },
  asset: { tone: 'waiting', icon: 'construct' },
};

/** The breeds held somewhere, as chips. Biggest first — the one that runs out matters most. */
function Breeds({ by }: { by: Record<string, number> }): React.JSX.Element | null {
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    return null;
  }
  return (
    <View style={styles.breeds}>
      {rows.map(([breed, qty]) => (
        <View key={breed} style={styles.breed}>
          <Glyph name={STRAW_GLYPH} size={12} color={colors.info} />
          <Text style={styles.breedName} numberOfLines={1}>
            {breed}
          </Text>
          <View style={styles.breedQty}>
            <Text style={styles.breedQtyLabel}>{qty}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** A glyph on a solid chip of the card's colour, as every zonal card carries one. */
function Chip({
  icon,
  tone,
  size = 34,
}: {
  icon: GlyphName;
  tone: TileTone;
  size?: number;
}): React.JSX.Element {
  return (
    <View
      style={[
        styles.chip,
        styles[`chip_${tone}`],
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Glyph name={icon} size={Math.round(size * 0.5)} color={colors.surface} />
    </View>
  );
}

/** The card's figure on a white badge, with what it counts under it. */
function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: TileTone;
}): React.JSX.Element {
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, styles[`countValue_${tone}`]]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

/** A section's heading with its glyph, as the Zone screen heads its feed. */
function Section({
  icon,
  tone,
  label,
}: {
  icon: GlyphName;
  tone: TileTone;
  label: string;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Chip icon={icon} tone={tone} size={26} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

/** The solid colour of each tone, for a glyph or a word on a wash. */
const CHIP: Record<TileTone, string> = {
  good: colors.primaryDark,
  waiting: yolk[800],
  bad: colors.error,
  info: colors.info,
  plain: colors.textMuted,
};

/** Red at zero, yolk when low, green when everybody can work. */
function stockTone(atZero: number, low: number): TileTone {
  return atZero > 0 ? 'bad' : low > 0 ? 'waiting' : 'good';
}

/**
 * What is on its way to the Maits, as the three steps it goes through: asked and waiting on
 * this manager, agreed and waiting at the depot, packed and waiting to be collected.
 */
function OnItsWay({ row }: { row: ZoneStockProduct }): React.JSX.Element {
  const { t } = useTranslation();
  const steps = [
    { key: 'asked', value: row.requested, icon: 'hourglass' as const, tone: 'waiting' as const },
    { key: 'agreed', value: row.approved, icon: 'checkmark' as const, tone: 'info' as const },
    { key: 'packed', value: row.set_aside, icon: 'cube' as const, tone: 'good' as const },
  ];
  if (!steps.some(step => step.value > 0)) {
    return (
      <View style={styles.way}>
        <Glyph name="checkmark-done" size={14} color={colors.textMuted} />
        <Text style={styles.wayQuiet}>{t('zonal.nothingOnItsWay')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.way} testID={`zonal-product-${row.key}-way`}>
      <Text style={styles.wayLabel}>{t('zonal.onItsWay')}</Text>
      {steps
        .filter(step => step.value > 0)
        .map(step => (
          <View key={step.key} style={[styles.step, styles[`step_${step.tone}`]]}>
            <Glyph name={step.icon} size={11} color={colors.surface} />
            <Text style={styles.stepLabel}>
              {t(`zonal.way_${step.key}`, { count: step.value })}
            </Text>
          </View>
        ))}
    </View>
  );
}

export default function ZoneStockScreen({ zoneName }: { zoneName: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState<Category>('straw');
  const online = useOnline();
  const stock = useGetZoneStockQuery(undefined, useLive());
  const [view, setView] = useState<View_>('locations');

  const summary = stock.data?.summary;

  /** One chilling centre, in the colour of the worst-off Mait under it. */
  const locationCard = (place: ZoneStockLocation) => {
    const tone = stockTone(place.at_zero, place.low);
    return (
      <View
        key={place.plant_code || place.name}
        style={[styles.card, styles[`card_${tone}`]]}
        testID={`zonal-place-${place.plant_code || 'none'}`}
      >
        <View style={styles.head}>
          <Chip icon="business" tone={tone} />
          <View style={styles.headBody}>
            <Text style={styles.title} numberOfLines={1}>
              {place.name}
            </Text>
            {!!place.plant_code && (
              <Text style={styles.meta}>
                <Text style={styles.metaLabel}>{`${t('zonal.plantCodeLabel')}: `}</Text>
                {place.plant_code}
              </Text>
            )}
          </View>
          <Count value={place.straws} label={t('zonal.strawsUnit')} tone={tone} />
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Glyph name="people" size={13} color={colors.ink} />
            <Text style={styles.statLabel}>{t('zonal.maitsHere', { count: place.maits })}</Text>
          </View>
          {place.at_zero > 0 && (
            <Pill label={t('zonal.atZeroN', { count: place.at_zero })} tone="bad" />
          )}
          {place.low > 0 && <Pill label={t('zonal.lowN', { count: place.low })} tone="waiting" />}
          {place.at_zero === 0 && place.low === 0 && (
            <Pill label={t('zonal.allStocked')} tone="good" />
          )}
        </View>

        <Breeds by={place.by_breed} />

        {/* What could fix it, on the same card as the problem. A centre whose Maits are empty
            and whose depot is also empty is a phone call to somebody else entirely. */}
        {place.stores.length ? (
          place.stores.map(store => (
            <View key={store.id} style={styles.depot}>
              <Chip icon="storefront" tone="info" size={28} />
              <Text style={styles.depotName} numberOfLines={1}>
                {store.name}
              </Text>
              <Pill
                label={t('zonal.depotHas', { count: store.straws_available })}
                tone={store.straws_available > 0 ? 'good' : 'bad'}
              />
            </View>
          ))
        ) : (
          <View style={[styles.depot, styles.noDepot]}>
            <Glyph name="information-circle" size={18} color={colors.info} />
            <Text style={styles.noDepotLabel}>{t('zonal.noDepotHere')}</Text>
          </View>
        )}
      </View>
    );
  };

  /** One Mait, in the colour of what they hold. */
  const maitCard = (row: ZoneStockMait) => {
    const tone: TileTone =
      row.state === 'at_zero' ? 'bad' : row.state === 'low' ? 'waiting' : 'good';
    return (
      <View
        key={row.mait_id}
        style={[styles.card, styles[`card_${tone}`]]}
        testID={`zonal-mait-${row.mait_id}`}
      >
        <View style={styles.head}>
          <View style={[styles.avatar, styles[`chip_${tone}`]]}>
            <Text style={styles.avatarLabel}>{initials(row.name)}</Text>
          </View>
          <View style={styles.headBody}>
            <View style={styles.nameLine}>
              <Text style={[styles.title, styles.flexShrink]} numberOfLines={1}>
                {row.name}
              </Text>
              {row.state === 'at_zero' ? (
                <Pill label={t('zonal.atZero')} tone="bad" />
              ) : row.state === 'low' ? (
                <Pill label={t('zonal.low')} tone="waiting" />
              ) : null}
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              <Text style={styles.metaLabel}>{`${t('zonal.vendorCodeLabel')}: `}</Text>
              {row.code || t('zonal.noCode')}
            </Text>
          </View>
          <Count value={row.total} label={t('zonal.strawsUnit')} tone={tone} />
        </View>

        <View style={styles.inset}>
          <View style={styles.place}>
            <Glyph name="location" size={13} color={colors.info} />
            <Text style={styles.placeLabel} numberOfLines={2}>
              {[
                row.plant_name || t('zonal.noPlace'),
                row.also_covers.length
                  ? t('zonal.alsoCovers', { places: row.also_covers.join(', ') })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Breeds by={row.by_breed} />
        </View>
      </View>
    );
  };

  /** One item, in its category's colour: where it is, and what is on its way. */
  const productCard = (row: ZoneStockProduct) => {
    const { tone, icon } = CATEGORY[row.category];
    const coming = row.requested + row.approved;
    const name = (i18n.language.startsWith('hi') && row.name_hi) || row.name;
    return (
      <View
        key={row.key}
        style={[styles.card, styles[`card_${tone}`]]}
        testID={`zonal-product-${row.key}`}
      >
        <View style={styles.head}>
          <Chip icon={icon} tone={tone} />
          <View style={styles.headBody}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            {!!row.unit && (
              <Text style={styles.meta}>
                <Text style={styles.metaLabel}>{`${t('zonal.unitLabel')}: `}</Text>
                {row.unit}
              </Text>
            )}
          </View>
          {/* An empty depot with Maits still asking is the line to act on. */}
          {row.free === 0 && coming > 0 && <Pill label={t('zonal.pillEmpty')} tone="bad" />}
        </View>

        <View style={styles.figures}>
          <View style={styles.figure}>
            <Glyph name="people" size={14} color={yolk[700]} />
            <Text style={[styles.figureValue, row.with_maits === 0 && styles.figureBad]}>
              {row.with_maits}
            </Text>
            <Text style={styles.figureLabel}>{t('zonal.withMaits')}</Text>
            <Text style={styles.figureNote}>
              {t('zonal.heldByMaits', { count: row.maits_holding })}
            </Text>
          </View>
          <View style={styles.figure}>
            <Glyph name="storefront" size={14} color={colors.info} />
            <Text style={[styles.figureValue, row.at_depots === 0 && styles.figureBad]}>
              {row.at_depots}
            </Text>
            <Text style={styles.figureLabel}>{t('zonal.inDepots')}</Text>
            <Text style={styles.figureNote}>{t('zonal.freeToGive', { count: row.free })}</Text>
          </View>
        </View>

        <OnItsWay row={row} />
      </View>
    );
  };

  /** One depot, in blue: supply, not a problem. */
  const storeCard = (row: ZoneStockStore) => (
    <View key={row.id} style={[styles.card, styles.card_info]} testID={`zonal-store-${row.id}`}>
      <View style={styles.head}>
        <Chip icon="storefront" tone="info" />
        <View style={styles.headBody}>
          <Text style={styles.title} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t('zonal.storeMeta', { setAside: row.straws_set_aside, open: row.open_indents })}
          </Text>
        </View>
      </View>

      {/* The depot's straws as one bar and three plain lines. "On hand / set aside / free"
          read as three unrelated numbers; they are one shelf, part of it already packed for
          Maits who have not collected yet, and the rest still free to give out. */}
      <View style={styles.shelf} testID={`zonal-store-${row.id}-shelf`}>
        <Text style={styles.shelfTitle}>
          {t('zonal.strawsInDepot', { count: row.straws_on_hand })}
        </Text>
        <View style={styles.bar}>
          {row.straws_on_hand > 0 ? (
            <>
              <View style={[styles.barFree, { flex: row.straws_available }]} />
              <View style={[styles.barPacked, { flex: row.straws_set_aside }]} />
            </>
          ) : (
            <View style={styles.barEmpty} />
          )}
        </View>
        <View style={styles.legend}>
          <View style={[styles.dot, styles.dotFree]} />
          <Text style={styles.legendLabel}>
            <Text style={styles.legendValue}>{row.straws_available}</Text>
            {` ${t('zonal.canStillGive')}`}
          </Text>
        </View>
        <View style={styles.legend}>
          <View style={[styles.dot, styles.dotPacked]} />
          <Text style={styles.legendLabel}>
            <Text style={styles.legendValue}>{row.straws_set_aside}</Text>
            {` ${t('zonal.packedForMaits')}`}
          </Text>
        </View>
      </View>

      <Breeds by={row.by_breed} />

      {!!row.plant_names.length && (
        <View style={styles.serves}>
          {row.plant_names.map(name => (
            <View key={name} style={styles.serve}>
              <Glyph name="location" size={11} color={colors.surface} />
              <Text style={styles.serveLabel} numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const body = () => {
    if (stock.isLoading) {
      return <SkeletonList rows={5} />;
    }
    if (stock.isError || !stock.data) {
      return (
        <Problem
          kind={online ? 'server' : 'offline'}
          onRetry={stock.refetch}
          busy={stock.isFetching}
          testID="zonal-stock-error"
        />
      );
    }

    if (view === 'stores') {
      const stores = stock.data.stores;
      if (!stores.length) {
        return (
          <EmptyState
            title={t('zonal.noStoresTitle')}
            body={t('zonal.noStoresBody')}
            testID="zonal-no-stores"
          />
        );
      }
      return (
        <>
          <Section icon="storefront" tone="info" label={t('zonal.onTheShelf')} />
          {stores.map(storeCard)}
        </>
      );
    }

    if (view === 'products') {
      const products = stock.data.products;
      if (!products) {
        return (
          <EmptyState
            title={t('zonal.productsUnavailableTitle')}
            body={t('zonal.productsUnavailableBody')}
            testID="zonal-no-products"
          />
        );
      }
      const items = products[category] ?? [];
      const totals = items.reduce(
        (sum, row) => ({
          withMaits: sum.withMaits + row.with_maits,
          atDepots: sum.atDepots + row.at_depots,
          coming: sum.coming + row.requested + row.approved + row.set_aside,
        }),
        { withMaits: 0, atDepots: 0, coming: 0 },
      );
      return (
        <>
          {/* The three kinds of thing a Mait carries, as three buttons in their own colours. */}
          <View style={styles.categories}>
            {(Object.keys(CATEGORY) as Category[]).map(key => {
              const on = key === category;
              const { tone, icon } = CATEGORY[key];
              return (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setCategory(key)}
                  style={({ pressed }) => [
                    styles.category,
                    styles[`card_${tone}`],
                    on && styles[`chip_${tone}`],
                    pressed && styles.pressed,
                  ]}
                  testID={`zonal-category-${key}`}
                >
                  <Glyph name={icon} size={18} color={on ? colors.surface : CHIP[tone]} />
                  <Text
                    style={[styles.categoryLabel, { color: on ? colors.surface : CHIP[tone] }]}
                    numberOfLines={1}
                  >
                    {t(`zonal.category_${key}`)}
                  </Text>
                  <Text style={[styles.categoryCount, on && styles.categoryCountOn]}>
                    {(products[key] ?? []).length}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.totals} testID="zonal-product-totals">
            <View style={styles.total}>
              <Text style={styles.totalValue}>{totals.withMaits}</Text>
              <Text style={styles.totalLabel}>{t('zonal.withMaits')}</Text>
            </View>
            <View style={styles.total}>
              <Text style={styles.totalValue}>{totals.atDepots}</Text>
              <Text style={styles.totalLabel}>{t('zonal.inDepots')}</Text>
            </View>
            <View style={styles.total}>
              <Text style={[styles.totalValue, totals.coming > 0 && styles.totalComing]}>
                {totals.coming}
              </Text>
              <Text style={styles.totalLabel}>{t('zonal.onItsWay')}</Text>
            </View>
          </View>

          {items.length ? (
            items.map(productCard)
          ) : (
            <Text style={styles.quiet}>{t('zonal.noProductsHere')}</Text>
          )}
        </>
      );
    }

    if (view === 'maits') {
      if (!stock.data.maits.length) {
        return (
          <EmptyState
            title={t('zonal.noMaitsTitle')}
            body={t('zonal.noMaitsBody')}
            testID="zonal-no-maits"
          />
        );
      }
      return (
        <>
          <Section icon="people" tone="waiting" label={t('zonal.strawsHeld')} />
          {stock.data.maits.map(maitCard)}
        </>
      );
    }

    if (!stock.data.locations.length) {
      return (
        <EmptyState
          title={t('zonal.noPlacesTitle')}
          body={t('zonal.noPlacesBody')}
          testID="zonal-no-places"
        />
      );
    }
    return (
      <>
        <Section icon="business" tone="good" label={t('zonal.byLocation')} />
        {stock.data.locations.map(locationCard)}
      </>
    );
  };

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        eyebrow={t('zonal.stockEyebrow')}
        pill={zoneName}
        title={
          summary
            ? t('zonal.strawsInZone', { count: summary.total_straws })
            : t('zonal.stockEyebrow')
        }
        subtitle={t('zonal.stockSubtitle')}
        testID="zonal-stock-hero"
      />

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={stock.isFetching && !stock.isLoading}
            onRefresh={stock.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* At zero is red and its own figure: those Maits cannot record an event at all,
            which is a stopped Mait rather than a warning. Low is yolk beside it. */}
        <Tiles>
          <Tile
            icon="alert-circle"
            label={t('zonal.atZeroTile')}
            value={summary?.at_zero ?? '—'}
            tone={summary && summary.at_zero > 0 ? 'bad' : 'good'}
            testID="zonal-at-zero"
          />
          <Tile
            icon="trending-down"
            label={t('zonal.lowTile', { threshold: summary?.low_stock_threshold ?? 0 })}
            value={summary?.low ?? '—'}
            tone="waiting"
            testID="zonal-low"
          />
          <Tile
            icon="storefront"
            label={t('zonal.onShelvesTile')}
            value={summary?.store_straws ?? '—'}
            tone="info"
            testID="zonal-on-shelves"
          />
        </Tiles>

        <Segmented<View_>
          value={view}
          onChange={setView}
          testID="zonal-stock-view"
          options={[
            { key: 'locations', label: t('zonal.viewPlaces', { count: summary?.locations ?? 0 }) },
            { key: 'products', label: t('zonal.viewProducts') },
            { key: 'maits', label: t('zonal.viewMaits', { count: summary?.maits ?? 0 }) },
            { key: 'stores', label: t('zonal.viewStores', { count: summary?.stores ?? 0 }) },
          ]}
        />

        {body()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },

  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  sectionLabel: { ...typography.h3, color: colors.ink },

  // -- the card, in its state ---------------------------------------------------------------
  card: {
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing[2],
  },
  card_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_plain: { backgroundColor: colors.surface, borderColor: colors.border },

  chip: { alignItems: 'center', justifyContent: 'center' },
  chip_good: { backgroundColor: colors.primary },
  chip_waiting: { backgroundColor: yolk[600] },
  chip_bad: { backgroundColor: colors.error },
  chip_info: { backgroundColor: colors.info },
  chip_plain: { backgroundColor: colors.textMuted },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  headBody: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { ...typography.h3, color: colors.ink },
  meta: { ...typography.caption, color: colors.ink },
  metaLabel: { fontFamily: typography.label.fontFamily, color: colors.textMuted },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { ...typography.label, color: colors.surface },

  // The card's figure on a white badge: the one number the card is about.
  count: {
    alignItems: 'center',
    minWidth: 54,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  countValue: { ...typography.h2 },
  countValue_good: { color: colors.primaryDark },
  countValue_waiting: { color: yolk[800] },
  countValue_bad: { color: colors.error },
  countValue_info: { color: colors.info },
  countValue_plain: { color: colors.ink },
  countLabel: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.textMuted },

  stats: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2] },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  statLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },

  // -- breeds -------------------------------------------------------------------------------
  breeds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  breed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: spacing[2],
    paddingRight: 3,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  breedName: { ...typography.caption, color: colors.ink, maxWidth: 110 },
  breedQty: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.info,
  },
  breedQtyLabel: {
    ...typography.caption,
    fontSize: 11,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // -- the depot under a centre ---------------------------------------------------------------
  depot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  depotName: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  noDepot: { borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoWash },
  noDepotLabel: { ...typography.caption, color: colors.ink, flex: 1 },

  // -- a Mait ---------------------------------------------------------------------------------
  inset: {
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  placeLabel: { ...typography.caption, color: colors.info, flex: 1 },

  // -- a depot ----------------------------------------------------------------------------------
  figures: { flexDirection: 'row', gap: spacing[2] },
  figure: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  figureValue: { ...typography.h2, color: colors.ink },
  figureGood: { color: colors.primaryDark },
  figureBad: { color: colors.error },
  figureLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  figureNote: { ...typography.caption, fontSize: 10, lineHeight: 13, color: colors.textMuted },

  // -- a depot's shelf ----------------------------------------------------------------------
  shelf: { gap: 4, padding: spacing[3], borderRadius: radius.md, backgroundColor: colors.surface },
  shelfTitle: { ...typography.bodyStrong, color: colors.ink },
  bar: {
    flexDirection: 'row',
    height: 10,
    marginVertical: spacing[1],
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  barFree: { backgroundColor: colors.primary },
  barPacked: { backgroundColor: yolk[500] },
  barEmpty: { flex: 1, backgroundColor: colors.errorWash },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotFree: { backgroundColor: colors.primary },
  dotPacked: { backgroundColor: yolk[500] },
  legendLabel: { ...typography.caption, color: colors.ink, flex: 1 },
  legendValue: { fontFamily: typography.label.fontFamily },

  // -- products -------------------------------------------------------------------------------
  pressed: { opacity: 0.85 },
  categories: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  category: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  categoryLabel: { ...typography.label, fontSize: 12 },
  categoryCount: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  categoryCountOn: { color: colors.surface },
  totals: {
    flexDirection: 'row',
    marginBottom: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
  },
  total: { flex: 1, alignItems: 'center' },
  totalValue: { ...typography.h2, color: colors.surface },
  totalComing: { color: yolk[400] },
  totalLabel: { ...typography.caption, fontSize: 11, color: colors.surface, opacity: 0.75 },
  quiet: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing[4] },
  way: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  wayLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },
  wayQuiet: { ...typography.caption, color: colors.textMuted },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  step_waiting: { backgroundColor: yolk[600] },
  step_info: { backgroundColor: colors.info },
  step_good: { backgroundColor: colors.primary },
  stepLabel: { ...typography.caption, fontSize: 11, color: colors.surface },

  serves: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  serve: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: 170,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  serveLabel: { ...typography.caption, fontSize: 11, color: colors.surface, flexShrink: 1 },
});
