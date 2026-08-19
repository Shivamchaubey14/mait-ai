/**
 * Inventory — everything the dairy has put in a Mait's hands (SRS §6.4, M15).
 *
 * Three kinds of thing, and they are three kinds because a Mait acts on them differently. A
 * straw is spent on one insemination and is the number that decides whether the day can start
 * at all. A consumable runs down and gets reordered. A piece of equipment is issued once and
 * held until the dairy asks for it back — it is never used up, so a count of it means nothing
 * and the only question about it is whether it still works.
 *
 * Putting all three on one scroll made the screen a list of unrelated numbers. They are tabs
 * now, so each one gets a headline that answers its own question: how many straws, how many
 * supplies, how many items held.
 *
 * Every row says what became of the stock, not just what is left. `issued 10 · used 8` beside
 * a balance of 2 is a day's work accounted for; a bare 2 is a number to worry about. The
 * ledger has carried that all along and nothing had ever asked it for it.
 *
 * **Only what is in the flask.** Indents used to be listed here too — approved and issued ones,
 * as rows among the stock and as a line under the headline. They are neither: an indent is by
 * definition stock that is not in a Mait's hands, and rows that look like stock while not
 * being stock are the fastest way to start a round on straws that are still at the depot.
 * They live on Profile now, on a screen that can say what is outstanding on each of them.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListBreedsQuery } from '@api/endpoints';
import type { StrawLot, SuppliesLot } from '@api/types';
import { BrandMark } from '@/components/brand';
import { EmptyState, ErrorState, SkeletonList } from '@/components/states';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

type Tab = 'straws' | 'consumables' | 'equipment';

const TABS: Tab[] = ['straws', 'consumables', 'equipment'];

/** Fewer than this of one breed is worth flagging on the row itself. */
const LOW_PER_BREED = 3;

/**
 * Below this a consumable is called low, by catalogue code.
 *
 * Per product because the units are not comparable: two litres of nitrogen is an emergency and
 * two pairs of gloves is a morning. Anything unlisted falls back to a small count, which is
 * the honest default for something issued by the piece.
 */
const LOW_CONSUMABLE: Record<string, number> = { LN2: 3, SHEATH: 10, GLOVES: 5 };
const LOW_CONSUMABLE_FALLBACK = 5;

function isLowConsumable(item: SuppliesLot): boolean {
  return item.qty <= (LOW_CONSUMABLE[item.code] ?? LOW_CONSUMABLE_FALLBACK);
}

/** "14 Mar 2026" — with the year, because equipment is held for seasons rather than days. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function longDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return null;
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// --------------------------------------------------------------------------------------
// Pieces
// --------------------------------------------------------------------------------------
/**
 * One line of stock.
 *
 * The figure sits on the right, hard against the edge, so a column of them can be read down
 * without reading a single name — which is how a Mait checks a flask against what the screen
 * says. Low rows take the amber wash the rest of the product uses for "act on this".
 */
function StockRow({
  name,
  meta,
  value,
  unit,
  low = false,
  badge,
  testID,
}: {
  name: string;
  meta: string;
  /** The number, or a status word for something that is not counted. */
  value: string;
  unit?: string;
  low?: boolean;
  /** A pill beside the name — "Low", "In use". */
  badge?: { label: string; tone: 'warn' | 'good' | 'info' };
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.row, low && styles.rowLow]} testID={testID}>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {!!badge && (
            <View style={[styles.pill, styles[`pill${badge.tone}` as const]]}>
              <Text style={[styles.pillLabel, styles[`pillLabel${badge.tone}` as const]]}>
                {badge.label}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>

      <View style={styles.rowFigure}>
        <Text style={[styles.rowValue, low && styles.rowValueLow]}>{value}</Text>
        {!!unit && <Text style={styles.rowUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

/** A section rule — the species a group of straws belongs to, and its total. */
function GroupHead({ label, meta }: { label: string; meta: string }): React.JSX.Element {
  return (
    <View style={styles.groupHead}>
      <Text style={styles.groupLabel}>{label}</Text>
      <Text style={styles.groupMeta}>{meta}</Text>
    </View>
  );
}

/** The amber warning that belongs to one tab rather than to a row. */
function Warning({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <View style={styles.warning} testID="stock-warning">
      <Ionicons name="warning-outline" size={18} color={colors.secondaryPressed} />
      <View style={styles.warningBody}>
        <Text style={styles.warningTitle}>{title}</Text>
        <Text style={styles.warningText}>{body}</Text>
      </View>
    </View>
  );
}

/** A quiet line under a list, explaining how the numbers move. */
function Footnote({
  text,
  action,
  onPress,
}: {
  text: string;
  action?: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.footnote}>
      <Text style={styles.footnoteText}>{text}</Text>
      {!!action && (
        <Pressable accessibilityRole="button" onPress={onPress} testID="stock-footnote-action">
          <Text style={styles.footnoteAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function StockScreen({
  onRequestStock,
}: {
  onRequestStock: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('straws');

  const stock = useGetInventorySummaryQuery();
  const breeds = useListBreedsQuery();

  const hindi = i18n.language.startsWith('hi');

  /** A breed's own name, from the admin's list. Falls back to the code, which is never wrong. */
  const breedName = (code: string): string => {
    const config = (breeds.data ?? []).find(item => item.code === code);
    return (hindi && config?.name_hi) || config?.name || code;
  };

  // Memoised because the grouping below depends on it, and `?? []` is a fresh array on every
  // render — which would re-group the whole flask each time the screen so much as blinked.
  const straws = useMemo(() => stock.data?.straws ?? [], [stock.data]);
  const consumables = stock.data?.consumables ?? [];
  const assets = stock.data?.assets ?? [];

  /** Straws under their species, so a Mait reads the flask the way it is packed. */
  const grouped = useMemo(() => {
    const groups: { type: string; rows: StrawLot[] }[] = [];
    for (const type of ['COW', 'BUFF', ''] as const) {
      const rows = straws.filter(row => row.animal_type === type);
      if (rows.length) {
        groups.push({ type, rows });
      }
    }
    return groups;
  }, [straws]);

  const lowBreeds = straws.filter(row => row.qty <= LOW_PER_BREED).length;
  const lowSupplies = consumables.filter(isLowConsumable);
  const nitrogen = consumables.find(item => item.code === 'LN2');

  const headline: Record<Tab, { title: string; subtitle: string; accent?: string }> = {
    straws: {
      title: t('stock.strawsHeld', { count: stock.data?.total_straws ?? 0 }),
      subtitle: grouped
        .map(group =>
          t('stock.speciesCount', {
            species: group.type ? t(`aiFlow.animalType.${group.type}`) : t('stock.unknownAnimal'),
            count: group.rows.reduce((sum, row) => sum + row.qty, 0),
          }),
        )
        .join(' · '),
    },
    consumables: {
      title: t('stock.consumablesHeld', { count: consumables.length }),
      subtitle: t('stock.consumablesSubtitle'),
      accent: t('stock.notPricedToYou'),
    },
    equipment: {
      title: t('stock.equipmentHeld', { count: assets.length }),
      subtitle: t('stock.equipmentSubtitle'),
    },
  };

  const head = headline[tab];
  const loading = stock.isLoading;
  const failed = stock.isError;

  return (
    <View style={styles.root}>
      {/* Fixed head. The headline answers the question the tab is asking and the tabs are how
          the question is changed, so neither may scroll away from the list they describe —
          a Mait halfway down the flask should never have to scroll back up to find out
          which of the three they are looking at. */}
      {/* Full-bleed, and up under the status bar. The hero is the top of the screen rather
            than a card sitting on it — inset on all four sides it read as one more card in a
            list of cards, with a strip of page showing above it. Only the bottom corners are
            rounded, which is what makes the body below look like it slides underneath. The
            mark rides in it so a phone handed to a farmer still says whose app it is. */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        {/* The mark and nothing else, the way every other tab screen wears it. The count of
            what is on its way is already in the subtitle under this row and again on the rows
            themselves, so a badge up here was the same number said a third time. */}
        <View style={styles.heroTop}>
          <BrandMark size="small" />
        </View>

        <Text style={styles.heroTitle}>{head.title}</Text>
        {!!head.subtitle && (
          <Text style={styles.heroSubtitle}>
            {head.subtitle}
            {!!head.accent && (
              <>
                {head.subtitle ? ' · ' : ''}
                <Text style={styles.heroAccent}>{head.accent}</Text>
              </>
            )}
          </Text>
        )}
      </View>

      {/* One control, three answers. Always carries a value, so it reads as a thing already
          chosen rather than a question. */}
      <View style={styles.tabsWrap}>
        <View style={styles.tabs}>
          {TABS.map(key => {
            const active = key === tab;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(key)}
                style={[styles.tab, active && styles.tabActive]}
                testID={`stock-tab-${key}`}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                  {t(`stock.tab.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Only this moves. */}
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={stock.isFetching && !stock.isLoading}
            onRefresh={() => stock.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {loading && <SkeletonList rows={4} />}

        {failed && (
          <ErrorState
            title={t('stock.errorTitle')}
            onRetry={() => stock.refetch()}
            busy={stock.isFetching}
            testID="stock-error"
          />
        )}

        {!loading && !failed && tab === 'straws' && (
          <>
            {straws.length === 0 && (
              <EmptyState title={t('stock.emptyTitle')} body={t('stock.emptyBody')} />
            )}

            {grouped.map(group => (
              <View key={group.type || 'unknown'}>
                <GroupHead
                  label={
                    group.type ? t(`aiFlow.animalType.${group.type}`) : t('stock.unknownAnimal')
                  }
                  meta={t('stock.doses', {
                    count: group.rows.reduce((sum, row) => sum + row.qty, 0),
                  })}
                />
                {group.rows.map(row => (
                  <StockRow
                    key={row.breed}
                    name={breedName(row.breed)}
                    meta={t('stock.issuedUsed', {
                      code: row.breed,
                      issued: row.issued,
                      used: row.used,
                    })}
                    value={String(row.qty)}
                    unit={t('stock.dosesUnit')}
                    low={row.qty <= LOW_PER_BREED}
                    badge={
                      row.qty <= LOW_PER_BREED ? { label: t('stock.low'), tone: 'warn' } : undefined
                    }
                    testID={`stock-straw-${row.breed}`}
                  />
                ))}
              </View>
            ))}

            {lowBreeds > 0 && <Footnote text={t('stock.breedsLow', { count: lowBreeds })} />}
          </>
        )}

        {!loading && !failed && tab === 'consumables' && (
          <>
            {consumables.length === 0 && (
              <EmptyState title={t('stock.noSuppliesTitle')} body={t('stock.noSuppliesBody')} />
            )}

            {consumables.map(item => (
              <StockRow
                key={item.code}
                name={item.name}
                meta={t('stock.perUnit', {
                  code: item.code,
                  unit: item.unit || t('stock.piece'),
                })}
                value={String(item.qty)}
                unit={item.unit ? t('stock.unitPlural', { unit: item.unit }) : t('stock.pieces')}
                low={isLowConsumable(item)}
                badge={isLowConsumable(item) ? { label: t('stock.low'), tone: 'warn' } : undefined}
                testID={`stock-consumable-${item.code}`}
              />
            ))}

            {/* Nitrogen gets a warning of its own. It is the only consumable whose running out
                does not stop one insemination — it spoils the whole flask. */}
            {!!nitrogen && isLowConsumable(nitrogen) && (
              <Warning title={t('stock.nitrogenTitle')} body={t('stock.nitrogenBody')} />
            )}

            {consumables.length > 0 && <Footnote text={t('stock.countsFall')} />}
          </>
        )}

        {!loading && !failed && tab === 'equipment' && (
          <>
            {assets.length === 0 && (
              <EmptyState title={t('stock.noEquipmentTitle')} body={t('stock.noEquipmentBody')} />
            )}

            {assets.map(item => {
              const since = longDate(item.issued_at);
              return (
                <StockRow
                  key={item.code}
                  name={item.name}
                  meta={
                    since
                      ? t('stock.issuedOn', { code: item.code, date: since })
                      : t('stock.issuedUnknown', { code: item.code })
                  }
                  // Never a count. One AI gun is not "1 piece of stock" — it is a thing the
                  // Mait either has or has to report, and a number invites reading it as
                  // something that can run out.
                  value=""
                  badge={{ label: t('stock.inUse'), tone: 'good' }}
                  testID={`stock-asset-${item.code}`}
                />
              );
            })}

            {assets.length > 0 && <Footnote text={t('stock.equipmentFootnote')} />}
          </>
        )}

        {lowSupplies.length > 0 && tab === 'straws' && (
          <Footnote text={t('stock.suppliesLowElsewhere', { count: lowSupplies.length })} />
        )}
      </ScrollView>

      {/* Fixed foot, above the tab bar. The one action out of this screen should not have to
          be scrolled back to — a Mait who has just read a low count wants it under their
          thumb, not at the end of a list of eleven breeds.

          Equipment has none. It is issued once and held until the dairy asks for it back, so
          there is nothing to order and nothing to correct; a button there would have to
          invent a job for itself. */}
      {!loading && !failed && tab !== 'equipment' && (
        <View style={styles.foot}>
          <Pressable
            accessibilityRole="button"
            onPress={onRequestStock}
            style={({ pressed }) => [
              styles.cta,
              styles.ctaPrimary,
              pressed && styles.ctaPrimaryPressed,
            ]}
            testID="stock-cta"
          >
            <Ionicons name="add" size={18} color={colors.surface} />
            <Text style={[styles.ctaLabel, styles.ctaLabelPrimary]}>{t('stock.raiseIndent')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  // The scrolling band between the fixed head and the fixed foot.
  body: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[4] },
  // Holds the tabs in the fixed head, on the page's own grey so the list slides behind them.
  tabsWrap: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    backgroundColor: colors.background,
  },
  // Opaque, and it has to be: the list scrolls behind this, and a transparent foot would show
  // rows sliding through the button on top of them.
  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    backgroundColor: colors.background,
  },

  // -- hero ------------------------------------------------------------------------------
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: { ...typography.body, color: colors.surface, opacity: 0.72, marginTop: spacing[2] },
  // Yolk on Ink, which is the one place the accent is legible as text (DESIGN_SYSTEM).
  heroAccent: { color: colors.secondary, opacity: 1 },

  // -- tabs ------------------------------------------------------------------------------
  tabs: {
    flexDirection: 'row',
    gap: spacing[1],
    padding: spacing[1],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.text },
  tabLabelActive: { color: colors.surface },

  // -- group heads -----------------------------------------------------------------------
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
    marginTop: spacing[2],
  },
  groupLabel: { ...typography.label, color: colors.textMuted, letterSpacing: 1 },
  groupMeta: { ...typography.caption, color: colors.textMuted },

  // -- rows ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.lg,
    ...shadows.card,
  },
  rowLow: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  rowBody: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rowName: { ...typography.h3, color: colors.ink, flexShrink: 1 },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowFigure: { alignItems: 'flex-end' },
  rowValue: { ...typography.h1, color: colors.ink },
  rowValueLow: { color: colors.secondaryPressed },
  rowUnit: { ...typography.caption, color: colors.textMuted },

  // -- pills -----------------------------------------------------------------------------
  pill: { paddingHorizontal: spacing[3], paddingVertical: 2, borderRadius: radius.pill },
  pillwarn: { backgroundColor: colors.secondaryWash },
  pillgood: { backgroundColor: colors.primaryWash },
  pillinfo: { backgroundColor: colors.infoWash },
  pillLabel: { ...typography.caption },
  pillLabelwarn: { color: yolk[800] },
  pillLabelgood: { color: colors.primaryDark },
  pillLabelinfo: { color: colors.info },

  // -- warning ---------------------------------------------------------------------------
  warning: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  warningBody: { flex: 1 },
  warningTitle: { ...typography.bodyStrong, color: yolk[800] },
  warningText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // -- footnote --------------------------------------------------------------------------
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footnoteText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  footnoteAction: { ...typography.caption, color: colors.primaryDark },

  // -- call to action --------------------------------------------------------------------
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.lg,
  },
  ctaPrimary: { backgroundColor: colors.primary },
  ctaPrimaryPressed: { backgroundColor: colors.primaryPressed },
  ctaQuiet: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ctaQuietPressed: { backgroundColor: colors.background },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16 },
  ctaLabelPrimary: { color: colors.surface },
  ctaLabelQuiet: { color: colors.text },
});
