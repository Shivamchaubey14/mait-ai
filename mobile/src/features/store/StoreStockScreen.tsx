/**
 * Store stock — what is on the shelf, and a delivery onto it.
 *
 * Three numbers per item, because the shelf answers three different questions and the keeper
 * is asked all of them. *On hand* is what is physically there — what they count when somebody
 * from the office walks in. *Set aside* is issued to a Mait who has not typed their code yet:
 * still here, and not the keeper's to promise again. *Free to issue* is the difference, and it
 * is the only one the queue's *Ready* and *Short* are worked out from.
 *
 * Deliveries are recorded here, by the keeper, because they are the one who counts the boxes
 * off the van. It is the only way stock enters a store, and it goes through the same ledger
 * every handover comes out of, so the count on this screen is those rows added up.
 *
 * **By kind, in colour** — the way the zonal manager's stock and the portal's shelf are drawn:
 * straws in blue, consumables in green, equipment in yolk. Three tiles give each kind's total
 * and are the switch between them, straws chosen first; under them, the chosen kind's section with every item on its own tinted row — its glyph on a solid
 * chip, how much is free and how much is packed for a Mait as words and as a bar, and the count
 * on a solid badge. A kind the store holds none of still has its section, saying so, because
 * "we have no gloves" is exactly the line a keeper opens this screen to find.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Glyph, { STRAW_GLYPH } from '@/components/glyph';
import type { GlyphName } from '@/components/glyph';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useGetStoreCatalogueQuery,
  useGetStoreStockQuery,
  useReceiveStoreStockMutation,
} from '@api/endpoints';
import type { StoreStockLine } from '@api/types';
import { Sheet } from '@/components/BottomSheet';
import Problem, { useOnline } from '@/components/problem';
import { EmptyState, SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { Tile, Tiles } from '@/components/frame';
import type { TileTone } from '@/components/frame';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import { itemLabel, StoreAction, StoreHero, storeStyles, Stepper } from './parts';

/** The three kinds a store's shelf holds. Equipment is a catalogue product with its own kind. */
type Kind = 'straw' | 'consumable' | 'asset';

/** Each kind in its own colour and glyph, the same three the zonal app and the portal draw. */
const KINDS: Record<Kind, { tone: TileTone; icon: GlyphName; label: string }> = {
  straw: { tone: 'info', icon: STRAW_GLYPH, label: 'store.straws' },
  consumable: { tone: 'good', icon: 'flask', label: 'store.consumables' },
  asset: { tone: 'waiting', icon: 'construct', label: 'store.equipment' },
};

/** Which kind a line is. An older server sends no category; a straw is then a straw. */
function kindOf(line: StoreStockLine): Kind {
  if (line.category) {
    return line.category;
  }
  return line.product_type === 'straw' ? 'straw' : 'consumable';
}
type Animal = 'COW' | 'BUFF';

/** White on a solid fill, except yolk, which fails contrast under white and takes Ink. */
function onSolid(tone: TileTone): string {
  return tone === 'waiting' ? colors.ink : colors.surface;
}

/** A step's heading on the delivery sheet: its number, its glyph and the question. */
function StepHead({
  n,
  icon,
  tone,
  label,
  optional,
}: {
  n: number;
  icon: GlyphName;
  tone: TileTone;
  label: string;
  optional?: string;
}): React.JSX.Element {
  return (
    <View style={styles.stepHead}>
      <View style={[styles.stepNum, styles[`solid_${tone}`]]}>
        <Text style={[styles.stepNumLabel, { color: onSolid(tone) }]}>{n}</Text>
      </View>
      <Glyph name={icon} size={15} color={SOLID[tone]} />
      <Text style={[styles.stepLabel, { color: SOLID[tone] }]}>
        {label}
        {!!optional && <Text style={styles.optional}>{`  ${optional}`}</Text>}
      </Text>
    </View>
  );
}

/**
 * Record what came off the van.
 *
 * A breed or a product, how many, and a note for the challan number. The key is minted when
 * the sheet opens rather than when *Add* is pressed, so a delivery recorded over a store's one
 * bar of signal — tapped twice because the first seemed to do nothing — is counted once.
 */
function ReceiveSheet({
  visible,
  storeName,
  onClose,
  onReceived,
}: {
  visible: boolean;
  /** Named on the sheet, because this writes onto that shelf and no other. */
  storeName: string;
  onClose: () => void;
  onReceived: (message: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const catalogue = useGetStoreCatalogueQuery(undefined, { skip: !visible });
  const [receive, receiving] = useReceiveStoreStockMutation();

  const [kind, setKind] = useState<Kind>('straw');
  // Straws are shelved by breed, and a breed belongs to an animal. Seventeen breed chips in
  // one run is a wall to read; cow-or-buffalo first halves it, and it is the same two steps
  // the portal's breed list is arranged in.
  const [animal, setAnimal] = useState<Animal>('COW');
  const [picked, setPicked] = useState<string | null>(null);
  const [qty, setQty] = useState(10);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(newClientUuid);

  const hindi = i18n.language.startsWith('hi');
  const options = useMemo(() => {
    if (kind === 'straw') {
      return (catalogue.data?.breeds ?? [])
        .filter(breed => breed.animal_type === animal)
        .map(breed => ({
          value: breed.code,
          label: (hindi && breed.name_hi) || breed.name,
        }));
    }
    return (catalogue.data?.products ?? [])
      .filter(product => product.category === kind)
      .map(product => ({ value: String(product.id), label: product.name }));
  }, [catalogue.data, kind, animal, hindi]);

  const label = options.find(option => option.value === picked)?.label ?? '';
  const tone = KINDS[kind].tone;

  const reset = () => {
    setAnimal('COW');
    setPicked(null);
    setQty(10);
    setNote('');
    setProblem(null);
    setKey(newClientUuid());
  };

  const save = async () => {
    if (!picked) {
      return;
    }
    setProblem(null);
    try {
      await receive({
        client_uuid: key,
        // Equipment is a catalogue product like any consumable; only the list it is picked from
        // differs.
        product_type: kind === 'straw' ? 'straw' : 'consumable',
        ...(kind === 'straw' ? { breed: picked } : { product_ref_id: Number(picked) }),
        qty,
        note: note.trim() || undefined,
      }).unwrap();
      onReceived(t('store.received', { qty, item: label }));
      reset();
      onClose();
    } catch (err) {
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      setProblem(detail && detail !== 'Validation failed' ? detail : t('store.receiveFailed'));
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t('store.record')}
      subtitle={t('store.receiveOnto', { store: storeName })}
      onClose={onClose}
      testID="receive-sheet"
      footer={
        <View style={styles.sheetFooter}>
          {!!problem && <Text style={styles.sheetProblem}>{problem}</Text>}
          <StoreAction
            label={picked ? t('store.receiveCta', { qty }) : t('store.receiveCtaPick')}
            icon={picked ? 'add' : undefined}
            onPress={save}
            disabled={!picked || qty < 1}
            busy={receiving.isLoading}
            testID="receive-save"
          />
        </View>
      }
    >
      {/* Three cards, one question each, in the order a keeper answers them standing at the
          van: what it is, how many, and what the challan says. The labels used to float on
          the sheet's own surface with the chips loose beneath them, so nothing said where one
          question stopped and the next began. */}
      <View style={[styles.card, styles[`card_${tone}`]]}>
        <StepHead n={1} icon="cube" tone={tone} label={t('store.whatArrived')} />
        {/* Three buttons in their own colours, the word whole on each — a segmented strip
            cut "Consumables" to "Consuma…" and said nothing about which kind was which. */}
        <View style={styles.kinds}>
          {(Object.keys(KINDS) as Kind[]).map(option => {
            const on = option === kind;
            const look = KINDS[option];
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setKind(option);
                  setPicked(null);
                }}
                style={[
                  styles.kind,
                  styles[`kind_${look.tone}`],
                  on && styles[`solid_${look.tone}`],
                ]}
                testID={`receive-kind-${option}`}
              >
                <Glyph
                  name={look.icon}
                  size={20}
                  color={on ? onSolid(look.tone) : SOLID[look.tone]}
                />
                <Text
                  style={[styles.kindLabel, { color: on ? onSolid(look.tone) : SOLID[look.tone] }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {t(look.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {kind === 'straw' && (
          <View style={styles.animals}>
            {(['COW', 'BUFF'] as Animal[]).map(option => {
              const on = option === animal;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setAnimal(option);
                    setPicked(null);
                  }}
                  style={[styles.animal, on && styles.animalOn]}
                  testID={`receive-animal-${option}`}
                >
                  <Glyph name="paw" size={15} color={on ? colors.surface : colors.info} />
                  <Text style={[styles.animalLabel, on && styles.animalLabelOn]}>
                    {t(`aiFlow.animalType.${option}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={[styles.cardHint, { color: SOLID[tone] }]}>
          {kind === 'straw' ? t('store.breed') : t('store.product')}
        </Text>
        <View style={styles.chips}>
          {catalogue.isLoading ? (
            <SkeletonList rows={1} />
          ) : !options.length ? (
            // The office keeps this list. Blank space here reads as a screen that failed to
            // load, when what it means is that nobody has configured a breed for this animal.
            <Text style={styles.noneHere} testID="receive-no-options">
              {kind === 'straw' ? t('store.noBreeds') : t('store.noProducts')}
            </Text>
          ) : (
            options.map(option => {
              const on = option.value === picked;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setPicked(option.value)}
                  style={[styles.chip, { borderColor: SOLID[tone] }, on && styles[`solid_${tone}`]]}
                  testID={`receive-item-${option.value}`}
                >
                  <Glyph
                    name={on ? 'checkmark-circle' : KINDS[kind].icon}
                    size={14}
                    color={on ? onSolid(tone) : SOLID[tone]}
                  />
                  <Text style={[styles.chipLabel, { color: on ? onSolid(tone) : colors.ink }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      {/* Green, and the one figure on the sheet drawn large: it is what the keeper is
          committing, and it is the thing that is wrong if anything is. */}
      <View style={styles.qtyCard}>
        <StepHead n={2} icon="calculator" tone="good" label={t('store.qtyArrived')} />
        <View style={styles.qtyHead}>
          <View style={styles.qtyText}>
            <Text style={styles.qtyValue} testID="receive-qty-figure">
              {qty}
              {!!label && <Text style={styles.qtyItem}>{`  ${label}`}</Text>}
            </Text>
          </View>
          <Stepper value={qty} min={1} max={100000} onChange={setQty} testID="receive-qty" />
        </View>

        {/* Tens as well as ones, because deliveries come in canisters of fifty and a stepper
            that only counts in ones is fifty taps. */}
        <View style={styles.jumps}>
          {[10, 25, 50, 100].map(step => (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityState={{ selected: qty === step }}
              onPress={() => setQty(step)}
              style={[styles.jump, qty === step && styles.jumpOn]}
              testID={`receive-qty-${step}`}
            >
              <Text style={[styles.jumpLabel, qty === step && styles.chipLabelOn]}>{step}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.card, styles.card_plain]}>
        <StepHead
          n={3}
          icon="document-text"
          tone="plain"
          label={t('store.note')}
          optional={t('store.optional')}
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t('store.notePlaceholder')}
          placeholderTextColor={colors.textMuted}
          maxLength={255}
          style={styles.noteInput}
          testID="receive-note"
        />
      </View>
    </Sheet>
  );
}

/**
 * One item on the shelf, tinted in its kind's colour: the glyph, the name, what is free and
 * what is packed for a Mait — in words and as a bar — and the count on a solid badge.
 */
function StockRow({ line, kind }: { line: StoreStockLine; kind: Kind }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const key = line.breed || String(line.product_ref_id);
  const { tone, icon } = KINDS[kind];
  const empty = line.on_hand === 0;
  return (
    <View
      style={[styles.row, styles[`row_${tone}`], empty && styles.rowEmpty]}
      testID={`stock-line-${key}`}
    >
      <View style={[styles.rowChip, styles[`solid_${tone}`]]}>
        <Glyph name={icon} size={16} color={tone === 'waiting' ? colors.ink : colors.surface} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {itemLabel(line, i18n.language)}
          {!!line.unit && line.product_type !== 'straw' && (
            <Text style={styles.rowUnitInline}>{`  ${line.unit}`}</Text>
          )}
        </Text>
        <Text style={styles.rowMeta}>
          <Text style={styles.rowFree}>{t('store.freeToIssue', { count: line.available })}</Text>
          {line.set_aside > 0 && (
            <Text style={styles.rowPacked}>
              {`  ·  ${t('store.setAside', { count: line.set_aside })}`}
            </Text>
          )}
        </Text>
        {/* Free in green over a yolk track: the yolk left showing is what is packed. */}
        {!empty && (
          <View style={styles.bar}>
            <View
              style={[
                styles.barFree,
                { width: `${Math.round((line.available / line.on_hand) * 100)}%` },
              ]}
            />
          </View>
        )}
      </View>
      <View style={[styles.badge, empty ? styles.solid_bad : styles[`solid_${tone}`]]}>
        <Text
          style={[styles.badgeValue, tone === 'waiting' && !empty && styles.badgeInk]}
          testID={`stock-line-${key}-count`}
        >
          {line.on_hand}
        </Text>
        <Text style={[styles.badgeUnit, tone === 'waiting' && !empty && styles.badgeInk]}>
          {t('store.onHand')}
        </Text>
      </View>
    </View>
  );
}

/** A kind's section: its heading on a solid chip, its total, and every item under it. */
function KindSection({ kind, lines }: { kind: Kind; lines: StoreStockLine[] }): React.JSX.Element {
  const { t } = useTranslation();
  const { tone, icon, label } = KINDS[kind];
  const total = lines.reduce((sum, line) => sum + line.on_hand, 0);
  return (
    <View style={styles.section} testID={`stock-section-${kind}`}>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionChip, styles[`solid_${tone}`]]}>
          <Glyph name={icon} size={15} color={tone === 'waiting' ? colors.ink : colors.surface} />
        </View>
        <Text style={[styles.sectionTitle, { color: SOLID[tone] }]}>{t(label)}</Text>
        <View style={[styles.sectionCount, styles[`row_${tone}`]]}>
          <Text style={[styles.sectionCountLabel, { color: SOLID[tone] }]}>
            {lines.length
              ? t('store.kindCount', { count: lines.length, total })
              : t('store.kindNone')}
          </Text>
        </View>
      </View>
      {lines.length ? (
        lines.map(line => (
          <StockRow
            key={`${line.product_type}-${line.breed}-${line.product_ref_id}`}
            line={line}
            kind={kind}
          />
        ))
      ) : (
        <View style={[styles.none, styles[`row_${tone}`]]} testID={`stock-section-${kind}-none`}>
          <Glyph name="alert-circle" size={16} color={SOLID[tone]} />
          <Text style={[styles.noneText, { color: SOLID[tone] }]}>
            {t('store.kindNoneBody', { kind: t(label).toLowerCase() })}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function StoreStockScreen({ storeName }: { storeName: string }): React.JSX.Element {
  const { t } = useTranslation();
  const online = useOnline();
  const stock = useGetStoreStockQuery();
  const [receiving, setReceiving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The kind on show. Straws first: they are what the queue waits on. */
  const [shown, setShown] = useState<Kind>('straw');

  const lines = useMemo(() => stock.data ?? [], [stock.data]);
  const byKind = useMemo(() => {
    const grouped: Record<Kind, StoreStockLine[]> = { straw: [], consumable: [], asset: [] };
    lines.forEach(line => grouped[kindOf(line)].push(line));
    return grouped;
  }, [lines]);
  const total = (kind: Kind) => byKind[kind].reduce((sum, line) => sum + line.on_hand, 0);

  return (
    <View style={storeStyles.root}>
      <Toast message={notice} tone="info" onDismiss={() => setNotice(null)} testID="stock-notice" />
      <StoreHero
        eyebrow={t('store.stockEyebrow')}
        title={storeName}
        subtitle={
          lines.length
            ? t('store.stockSubtitle', { count: lines.length })
            : t('store.stockEmptySubtitle')
        }
        testID="stock-hero"
      />

      <ScrollView
        contentContainerStyle={storeStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={stock.isFetching && !stock.isLoading}
            onRefresh={stock.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {stock.isLoading ? (
          <SkeletonList rows={4} />
        ) : stock.isError ? (
          <Problem
            kind={online ? 'server' : 'offline'}
            onRetry={() => stock.refetch()}
            busy={stock.isFetching}
            testID="stock-error"
          />
        ) : lines.length ? (
          <>
            {/* Each kind's total, in its own colour with its glyph — and the switch between
                them: tap a tile and the shelf below is that kind. */}
            <Tiles>
              {(Object.keys(KINDS) as Kind[]).map(kind => (
                <Tile
                  key={kind}
                  icon={KINDS[kind].icon}
                  label={t(KINDS[kind].label)}
                  value={total(kind)}
                  note={t('store.kindItems', { count: byKind[kind].length })}
                  tone={KINDS[kind].tone}
                  selected={kind === shown}
                  onPress={() => setShown(kind)}
                  testID={`stock-tile-${kind}`}
                />
              ))}
            </Tiles>

            <View style={styles.key}>
              <View style={[styles.keyDot, styles.solid_good]} />
              <Text style={styles.keyLabel}>{t('store.keyFree')}</Text>
              <View style={[styles.keyDot, styles.solid_waiting]} />
              <Text style={styles.keyLabel}>{t('store.keyPacked')}</Text>
            </View>

            <KindSection kind={shown} lines={byKind[shown]} />
          </>
        ) : (
          <EmptyState title={t('store.stockEmptyTitle')} body={t('store.stockEmptyBody')} />
        )}
      </ScrollView>

      <View style={storeStyles.footer}>
        <StoreAction
          label={t('store.record')}
          icon="add"
          onPress={() => setReceiving(true)}
          testID="stock-record"
        />
      </View>

      <ReceiveSheet
        visible={receiving}
        storeName={storeName}
        onClose={() => setReceiving(false)}
        onReceived={setNotice}
      />
    </View>
  );
}

/** The solid colour of each tone — a heading or a word on a wash. */
const SOLID: Record<TileTone, string> = {
  good: colors.primaryDark,
  waiting: yolk[800],
  bad: colors.error,
  info: colors.info,
  plain: colors.textMuted,
};

const styles = StyleSheet.create({
  // -- the key -------------------------------------------------------------------------------
  key: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: spacing[3] },
  keyDot: { width: 10, height: 10, borderRadius: 5, marginLeft: spacing[2] },
  keyLabel: { ...typography.caption, color: colors.ink },

  // -- a kind's section ------------------------------------------------------------------------
  section: { marginBottom: spacing[3] },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  sectionChip: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { ...typography.h3, flex: 1 },
  sectionCount: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sectionCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  none: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  noneText: { ...typography.caption, flex: 1 },

  // -- solid fills, by tone ------------------------------------------------------------------
  solid_good: { backgroundColor: colors.primary },
  // Ink on yolk, never white — yolk fails contrast under white text.
  solid_waiting: { backgroundColor: yolk[500] },
  solid_bad: { backgroundColor: colors.error },
  solid_info: { backgroundColor: colors.info },
  solid_plain: { backgroundColor: colors.textMuted },

  // -- a line ------------------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  row_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  row_plain: { backgroundColor: colors.background, borderColor: colors.border },
  // None of it on the shelf: red, whatever its kind — the one line worth stopping on.
  rowEmpty: { backgroundColor: colors.errorWash, borderColor: colors.error },
  rowChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.h3, color: colors.ink },
  rowUnitInline: { ...typography.caption, color: colors.textMuted },
  rowMeta: { ...typography.caption },
  rowFree: { color: colors.primaryDark, fontFamily: typography.label.fontFamily },
  rowPacked: { color: yolk[800], fontFamily: typography.label.fontFamily },
  bar: {
    height: 6,
    marginTop: 2,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: yolk[400],
  },
  barFree: { height: '100%', backgroundColor: colors.primary },
  badge: {
    alignItems: 'center',
    minWidth: 60,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
  },
  badgeValue: { ...typography.h2, color: colors.surface },
  badgeUnit: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.surface },
  badgeInk: { color: colors.ink },

  // One card per question, in the colour of what is being recorded — the sheet itself is
  // white, and a white card on it is a border and nothing else.
  card: {
    gap: spacing[2],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_waiting: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  card_plain: { backgroundColor: ink[50], borderColor: ink[200] },

  stepHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },
  stepLabel: { ...typography.label, flex: 1 },

  kinds: { flexDirection: 'row', gap: spacing[2] },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  kind_info: { backgroundColor: colors.surface, borderColor: colors.info },
  kind_good: { backgroundColor: colors.surface, borderColor: colors.primary },
  kind_waiting: { backgroundColor: colors.surface, borderColor: yolk[500] },
  kind_bad: { backgroundColor: colors.surface, borderColor: colors.error },
  kind_plain: { backgroundColor: colors.surface, borderColor: colors.border },
  kindLabel: { ...typography.label },

  animals: { flexDirection: 'row', gap: spacing[2] },
  animal: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET - 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  animalOn: { backgroundColor: colors.info },
  animalLabel: { ...typography.label, color: colors.info },
  animalLabelOn: { color: colors.surface },
  cardLabel: { ...typography.label, color: colors.ink },
  cardHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing[1] },
  noneHere: { ...typography.body, color: colors.textMuted, paddingVertical: spacing[2] },
  optional: { ...typography.caption, color: colors.primaryDark },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  // White on the wash, and the chosen one filled — the wash is the card's, so a chip tinted
  // the same green would be the one thing on the sheet that disappears when chosen.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET - 8,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  chipLabel: { ...typography.label },
  chipLabelOn: { color: colors.surface },

  qtyCard: {
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  qtyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  qtyText: { flex: 1 },
  qtyLabel: { ...typography.label, color: colors.primaryDark },
  qtyValue: { ...typography.h1, color: colors.ink },
  qtyItem: { ...typography.bodyStrong, color: colors.primaryDark },
  jumps: { flexDirection: 'row', gap: spacing[2] },
  jump: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  jumpOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  jumpLabel: { ...typography.bodyStrong, color: colors.text },
  noteInput: {
    ...typography.body,
    color: colors.ink,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetFooter: { paddingHorizontal: spacing[5], paddingTop: spacing[3], gap: spacing[2] },
  sheetProblem: { ...typography.caption, color: colors.error },
});
