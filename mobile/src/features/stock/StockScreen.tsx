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
 *
 * **No button to raise an indent.** That is a tab of its own now, beside this one on the bar, so
 * the screen is only what is in the flask.
 *
 * **Each kind in its own colour** (docs/DESIGN_SYSTEM.md, *Coloured screen pattern*), the same
 * three the store and the zonal manager see: straws blue with a syringe, consumables green with
 * a flask, equipment yolk with a tool. The three tabs are coloured buttons with their glyph and
 * count; every row is tinted in its kind, its glyph on a solid chip and its count on a solid
 * badge — and anything running low turns yolk with a Low pill, whatever its kind.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListBreedsQuery } from '@api/endpoints';
import type { StrawLot, SuppliesLot } from '@api/types';
import { BrandMark } from '@/components/brand';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import type { GlyphName } from '@/components/glyph';
import PullToRefresh from '@/components/pullToRefresh';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

type Tab = 'straws' | 'consumables' | 'equipment';

const TABS: Tab[] = ['straws', 'consumables', 'equipment'];

type Tone = 'info' | 'good' | 'warm';

/** Each kind in its colour and glyph — the same three everywhere stock is drawn. */
const KIND: Record<Tab, { tone: Tone; icon: GlyphName }> = {
  straws: { tone: 'info', icon: STRAW_GLYPH },
  consumables: { tone: 'good', icon: 'flask' },
  equipment: { tone: 'warm', icon: 'construct' },
};

/** The solid colour of each tone, for a glyph or a word on a wash. */
const SOLID: Record<Tone, string> = {
  info: colors.info,
  good: colors.primaryDark,
  warm: yolk[800],
};

/** What sits on a solid chip: white, except on yolk, which fails contrast under white. */
function onSolid(tone: Tone): string {
  return tone === 'warm' ? colors.ink : colors.surface;
}

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
  kind,
  name,
  meta,
  value,
  unit,
  low = false,
  badge,
  testID,
}: {
  kind: Tab;
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
  const { tone, icon } = KIND[kind];
  // Running low wears yolk whatever its kind — the one line worth stopping on.
  const look: Tone = low ? 'warm' : tone;
  return (
    <View style={[styles.row, styles[`row_${look}`]]} testID={testID}>
      <View style={[styles.rowChip, styles[`solid_${look}`]]}>
        <Glyph name={low ? 'warning' : icon} size={16} color={onSolid(look)} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {!!badge && (
            <View style={[styles.pill, styles[`pill${badge.tone}` as const]]}>
              <Ionicons
                name={badge.tone === 'warn' ? 'warning' : 'checkmark-circle'}
                size={11}
                color={badge.tone === 'warn' ? colors.ink : colors.surface}
              />
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

      {!!value && (
        <View style={[styles.rowFigure, styles[`solid_${look}`]]}>
          <Text style={[styles.rowValue, { color: onSolid(look) }]}>{value}</Text>
          {!!unit && <Text style={[styles.rowUnit, { color: onSolid(look) }]}>{unit}</Text>}
        </View>
      )}
    </View>
  );
}

/** A section rule — the species a group of straws belongs to, and its total. */
function GroupHead({ label, meta }: { label: string; meta: string }): React.JSX.Element {
  return (
    <View style={styles.groupHead}>
      <View style={styles.groupChip}>
        <Ionicons name="paw" size={13} color={colors.surface} />
      </View>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.groupCount}>
        <Text style={styles.groupMeta}>{meta}</Text>
      </View>
    </View>
  );
}

/** The amber warning that belongs to one tab rather than to a row. */
function Warning({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <View style={styles.warning} testID="stock-warning">
      <View style={styles.warningChip}>
        <Ionicons name="warning" size={16} color={colors.ink} />
      </View>
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
      <Ionicons name="information-circle" size={18} color={colors.info} />
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
  onSync,
}: {
  /**
   * Push whatever is still queued on the handset.
   *
   * A pull here means the same thing it means everywhere else — bring me up to date, in both
   * directions. Optional so a screen rendered without a shell around it still works.
   */
  onSync?: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('straws');
  const online = useOnline();

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
            const { tone, icon } = KIND[key];
            const count =
              key === 'straws'
                ? (stock.data?.total_straws ?? 0)
                : key === 'consumables'
                  ? consumables.length
                  : assets.length;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(key)}
                style={[styles.tab, styles[`tab_${tone}`], active && styles[`solid_${tone}`]]}
                testID={`stock-tab-${key}`}
              >
                <Glyph name={icon} size={18} color={active ? onSolid(tone) : SOLID[tone]} />
                <Text
                  style={[styles.tabLabel, { color: active ? onSolid(tone) : SOLID[tone] }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {t(`stock.tab.${key}`)}
                </Text>
                {!loading && !failed && (
                  <View style={[styles.tabCount, active && styles.tabCountActive]}>
                    <Text style={[styles.tabCountLabel, { color: SOLID[tone] }]}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Only this moves. */}
      <PullToRefresh
        onRefresh={async () => {
          onSync?.();
          await stock.refetch();
        }}
        label={t('pull.holding')}
        testID="stock-pull"
      >
        {scrollProps => (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            // Reports where the list has got to, so a downward drag at the top is read as a
            // pull and anywhere else as a scroll.
            {...scrollProps}
          >
            {loading && <SkeletonList rows={4} />}

            {failed && (
              <Problem
                kind={online ? 'server' : 'offline'}
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
                        kind="straws"
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
                          row.qty <= LOW_PER_BREED
                            ? { label: t('stock.low'), tone: 'warn' }
                            : undefined
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
                    kind="consumables"
                    key={item.code}
                    name={item.name}
                    meta={t('stock.perUnit', {
                      code: item.code,
                      unit: item.unit || t('stock.piece'),
                    })}
                    value={String(item.qty)}
                    unit={
                      item.unit ? t('stock.unitPlural', { unit: item.unit }) : t('stock.pieces')
                    }
                    low={isLowConsumable(item)}
                    badge={
                      isLowConsumable(item) ? { label: t('stock.low'), tone: 'warn' } : undefined
                    }
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
                  <EmptyState
                    title={t('stock.noEquipmentTitle')}
                    body={t('stock.noEquipmentBody')}
                  />
                )}

                {assets.map(item => {
                  const since = longDate(item.issued_at);
                  return (
                    <StockRow
                      kind="equipment"
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
        )}
      </PullToRefresh>
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

  // -- tabs: the three kinds, a coloured button each ----------------------------------------
  tabs: { flexDirection: 'row', gap: spacing[2] },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  tab_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  tab_good: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  tab_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[500] },
  tabLabel: { ...typography.label },
  tabCount: {
    minWidth: 24,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  tabCountActive: { backgroundColor: colors.surface },
  tabCountLabel: { ...typography.caption, fontSize: 11, fontFamily: typography.label.fontFamily },

  // -- solid fills, by tone --------------------------------------------------------------
  solid_info: { backgroundColor: colors.info, borderColor: colors.info },
  solid_good: { backgroundColor: colors.primary, borderColor: colors.primary },
  // Ink on yolk, never white.
  solid_warm: { backgroundColor: yolk[500], borderColor: yolk[500] },

  // -- group heads -----------------------------------------------------------------------
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
    marginTop: spacing[2],
  },
  groupChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  groupLabel: { ...typography.h3, color: colors.ink, flex: 1 },
  groupCount: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.infoWash,
  },
  groupMeta: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.info },

  // -- rows: tinted in their kind --------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  rowChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowName: { ...typography.h3, color: colors.ink, flexShrink: 1 },
  rowMeta: { ...typography.caption, color: colors.ink, marginTop: 2 },
  // The count on a solid badge in the row's colour — read down the column without a name.
  rowFigure: {
    alignItems: 'center',
    minWidth: 58,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
  },
  rowValue: { ...typography.h2 },
  rowUnit: { ...typography.caption, fontSize: 10, lineHeight: 12 },

  // -- pills -----------------------------------------------------------------------------
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  pillwarn: { backgroundColor: yolk[400] },
  pillgood: { backgroundColor: colors.primary },
  pillinfo: { backgroundColor: colors.info },
  pillLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  pillLabelwarn: { color: colors.ink },
  pillLabelgood: { color: colors.surface },
  pillLabelinfo: { color: colors.surface },

  // -- warning ---------------------------------------------------------------------------
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryWash,
    borderWidth: 1,
    borderColor: yolk[400],
  },
  warningChip: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[500],
  },
  warningBody: { flex: 1 },
  warningTitle: { ...typography.bodyStrong, color: yolk[900] },
  warningText: { ...typography.caption, color: colors.ink, marginTop: 2 },

  // -- footnote --------------------------------------------------------------------------
  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  footnoteText: { ...typography.caption, color: colors.ink, flex: 1 },
  footnoteAction: { ...typography.caption, color: colors.primaryDark },
});
