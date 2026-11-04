/**
 * Inventory, for an admin — the portal's oversight screen (`inventory.html`) and the store shelf
 * editor it links to (`stores.html?stock=`), on a handset.
 *
 * Two pills choose whose stock is on screen:
 *
 * - **Maits** — every Mait in reach, emptiest first, because the screen is opened to decide where
 *   straws go next. At zero is red and apart from low (yellow): a Mait at zero cannot record an
 *   event at all. Opening one shows the whole holding — straws by breed, consumables, equipment —
 *   and the office adjustment: add stock that never came through an indent, or take off a count
 *   entered too high. Remove works on the *new quantity*, prefilled with what is held, so nobody
 *   works out a difference in their head.
 * - **Stores** — every depot shelf in reach, with what is packed for Maits and the indents waiting
 *   at the counter. Opening one is the shelf editor: add a delivery, or correct the count to what
 *   was physically counted (never below what is packed). "Correct" on a line opens the form on it.
 *
 * Both editors choose the item the same way — kind, then item, then a number — and say in one
 * coloured sentence what saving will do before the button is pressed.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonOverview, SkeletonRecord, SkeletonRows } from '@/components/skeleton';
import { Sheet } from '@/components/BottomSheet';
import { initials } from '@/components/frame';
import Glyph, { STRAW_GLYPH, type GlyphName } from '@/components/glyph';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  useAdminAdjustMaitStockMutation,
  useAdminInventoryOversightQuery,
  useAdminListZonesQuery,
  useAdminMaitStockQuery,
  useAdminStoreStockQuery,
  useAdminUpdateStoreStockMutation,
} from '@api/endpoints';
import type {
  InventoryOversightRow,
  MaitStockDetail,
  OversightStore,
  StockCatalogue,
  StoreStockLine,
} from '@api/types';
import { colors, ink, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

type Standing = 'zero' | 'low' | 'ok';

function standingOf(total: number, threshold: number): Standing {
  if (total === 0) {
    return 'zero';
  }
  return total <= threshold ? 'low' : 'ok';
}

const STANDING_TONE: Record<Standing, ToneName> = { zero: 'red', low: 'yolk', ok: 'green' };

/** The three kinds of stock, each in the tone and glyph the store shelf uses. */
type Kind = 'straw' | 'consumable' | 'asset';
const KINDS: Kind[] = ['straw', 'consumable', 'asset'];
const KIND_LOOK: Record<Kind, { tone: ToneName; icon: GlyphName }> = {
  straw: { tone: 'blue', icon: STRAW_GLYPH },
  consumable: { tone: 'green', icon: 'flask-outline' },
  asset: { tone: 'yolk', icon: 'construct-outline' },
};

/** One choosable item: `straw:<breed>` or `consumable:<catalogue id>`. */
interface Item {
  key: string;
  code: string;
  name: string;
  group?: string;
  unit?: string;
}

function itemLabel(item: Item): string {
  return `${item.name}${item.group ? ` · ${item.group}` : ''}${item.unit ? ` (${item.unit})` : ''}`;
}

/** What a kind can be stocked with, from the catalogue. */
function catalogueItems(t: TFunction, catalogue: StockCatalogue | undefined, kind: Kind): Item[] {
  if (!catalogue) {
    return [];
  }
  if (kind === 'straw') {
    return (catalogue.breeds ?? []).map(breed => ({
      key: `straw:${breed.code}`,
      code: breed.code,
      name: breed.name,
      group: t(breed.animal_type === 'BUFF' ? 'admin.inventory.buffalo' : 'admin.inventory.cow'),
    }));
  }
  return (catalogue.products ?? [])
    .filter(product => product.category === kind)
    .map(product => ({
      key: `consumable:${product.id}`,
      code: product.code ?? '',
      name: product.name,
      unit: product.unit,
    }));
}

function bodyOf(key: string): {
  product_type: 'straw' | 'consumable';
  breed?: string;
  product_ref_id?: number;
} {
  const [type, ref] = key.split(':');
  return type === 'straw'
    ? { product_type: 'straw', breed: ref }
    : { product_type: 'consumable', product_ref_id: Number(ref) };
}

/** The server's words for a refused change, or a fallback. */
function problemOf(error: unknown, fallback: string): string {
  const data = (error as { data?: Record<string, unknown> })?.data;
  const said =
    (typeof data?.detail === 'string' && data.detail) ||
    Object.values(data ?? {})
      .flat()
      .filter((v): v is string => typeof v === 'string')
      .join(' · ');
  return said || fallback;
}

// --------------------------------------------------------------------------------------
// Pieces both editors share
// --------------------------------------------------------------------------------------

function Tile({
  tone,
  icon,
  label,
  value,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: GlyphName;
  label: string;
  value: string;
  foot: string;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Glyph name={icon} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      <AppText style={styles.tileValue} testID={testID ? `${testID}-value` : undefined}>
        {value}
      </AppText>
      <AppText style={styles.tileFoot}>{foot}</AppText>
    </View>
  );
}

function BackTo({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      testID="admin-inventory-back"
    >
      <Ionicons name="arrow-back" size={16} color={colors.surface} />
      <AppText style={styles.backLabel}>{label}</AppText>
    </Pressable>
  );
}

function Hero({ title, meta, tone }: { title: string; meta: React.ReactNode; tone: ToneName }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <Disc tone={tone} text={initials(title)} size={44} />
        <View style={styles.flex}>
          <AppText style={styles.heroTitle}>{title}</AppText>
          {meta}
        </View>
      </View>
    </View>
  );
}

function Step({ n, title, aside }: { n: number; title: string; aside?: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepDot}>
        <AppText style={styles.stepDotLabel}>{n}</AppText>
      </View>
      <AppText style={styles.stepTitle}>{title}</AppText>
      {aside}
    </View>
  );
}

/** Straws, consumables, equipment — each with how many it offers, and off when it offers none. */
function KindPicker({
  kind,
  counts,
  onPick,
  testID,
}: {
  kind: Kind;
  counts: Record<Kind, number>;
  onPick: (kind: Kind) => void;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.kinds}>
      {KINDS.map(k => {
        const look = TONE[KIND_LOOK[k].tone];
        const on = k === kind;
        const off = counts[k] === 0;
        return (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: off }}
            disabled={off}
            onPress={() => onPick(k)}
            style={[
              styles.kind,
              {
                backgroundColor: on ? look.solid : look.wash,
                borderColor: on ? look.solid : look.border,
              },
              off && styles.off,
            ]}
            testID={`${testID}-${k}`}
          >
            <Glyph name={KIND_LOOK[k].icon} size={16} color={on ? look.onSolid : look.text} />
            <AppText style={[styles.kindName, { color: on ? look.onSolid : look.text }]}>
              {t(`admin.inventory.kind_${k}`)}
            </AppText>
            <View style={[styles.kindCount, { backgroundColor: on ? colors.surface : look.solid }]}>
              <AppText style={[styles.kindCountLabel, { color: on ? look.text : look.onSolid }]}>
                {counts[k]}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The item list for the chosen kind — a list to tap rather than a code to type. */
function ItemPicker({
  items,
  picked,
  heldOf,
  onPick,
  empty,
  testID,
}: {
  items: Item[];
  picked: string;
  heldOf: (item: Item) => number;
  onPick: (key: string) => void;
  empty: string;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (!items.length) {
    return <AppText style={styles.hint}>{empty}</AppText>;
  }
  return (
    <View style={styles.items}>
      {items.map((item, index) => {
        const on = item.key === picked;
        const held = heldOf(item);
        return (
          <Pressable
            key={item.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onPick(on ? '' : item.key)}
            style={[styles.item, index > 0 && styles.itemRule, on && styles.itemOn]}
            testID={`${testID}-${item.key}`}
          >
            <Ionicons
              name={on ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={on ? colors.info : colors.textMuted}
            />
            <AppText style={[styles.itemName, on && styles.itemNameOn]}>{itemLabel(item)}</AppText>
            <AppText style={[styles.itemHeld, held === 0 && styles.muted]}>
              {t('admin.inventory.heldShort', { n: num(held) })}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function QtyStepper({
  value,
  onChange,
  onFocus,
  testID,
}: {
  value: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const step = (by: number) => onChange(String(Math.max(0, (Number(value) || 0) + by)));
  return (
    <View style={styles.qty}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('admin.inventory.oneFewer')}
        onPress={() => step(-1)}
        style={({ pressed }) => [styles.qtyStep, pressed && styles.pressed]}
        testID={`${testID}-minus`}
      >
        <Ionicons name="remove" size={20} color={colors.ink} />
      </Pressable>
      <TextInput
        style={styles.qtyField}
        value={value}
        onChangeText={text => onChange(text.replace(/[^\d]/g, ''))}
        onFocus={onFocus}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="0"
        placeholderTextColor={colors.textDisabled}
        testID={testID}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('admin.inventory.oneMore')}
        onPress={() => step(1)}
        style={({ pressed }) => [styles.qtyStep, pressed && styles.pressed]}
        testID={`${testID}-plus`}
      >
        <Ionicons name="add" size={20} color={colors.ink} />
      </Pressable>
    </View>
  );
}

type PreviewTone = ToneName | 'quiet';

/** What saving will do, in one sentence, in the colour of what it is. */
function Preview({
  tone,
  text,
  testID,
}: {
  tone: PreviewTone;
  text: string;
  testID: string;
}): React.JSX.Element {
  const look = tone === 'quiet' ? null : TONE[tone];
  return (
    <View
      style={[
        styles.preview,
        look
          ? { backgroundColor: look.wash, borderColor: look.border }
          : { backgroundColor: ink[50], borderColor: ink[200] },
      ]}
      testID={testID}
    >
      {tone === 'green' && <Ionicons name="add-circle" size={16} color={TONE.green.text} />}
      {tone === 'red' && <Ionicons name="alert-circle" size={16} color={TONE.red.text} />}
      {tone === 'yolk' && <Ionicons name="create" size={16} color={TONE.yolk.text} />}
      <AppText style={[styles.previewText, look && { color: look.text }]} testID={`${testID}-text`}>
        {text}
      </AppText>
    </View>
  );
}

function NoteField({
  value,
  onChange,
  onFocus,
  testID,
}: {
  value: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.noteWrap}>
      <AppText style={styles.noteLabel}>
        {t('admin.inventory.note')}{' '}
        <AppText style={styles.hint}>{t('admin.inventory.optional')}</AppText>
      </AppText>
      <TextInput
        style={styles.noteField}
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        maxLength={255}
        placeholder={t('admin.inventory.notePlaceholder')}
        placeholderTextColor={colors.textDisabled}
        testID={testID}
      />
    </View>
  );
}

function Flash({ flash }: { flash: { text: string; tone: ToneName } | null }) {
  if (!flash) {
    return null;
  }
  return (
    <Notice
      tone={flash.tone}
      icon={flash.tone === 'green' ? 'checkmark' : 'alert'}
      title={flash.text}
      body=""
      testID="admin-inventory-flash"
    />
  );
}

// --------------------------------------------------------------------------------------
// One Mait's holding, and the office adjustment
// --------------------------------------------------------------------------------------

function HoldingCard({
  kind,
  title,
  rows,
  foot,
  threshold,
}: {
  kind: 'semen' | 'consumable' | 'asset';
  title: string;
  rows: { name: string; unit?: string; qty: number }[];
  foot: string;
  threshold: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone: ToneName = kind === 'semen' ? 'blue' : kind === 'consumable' ? 'green' : 'yolk';
  const look = TONE[tone];
  const icon: GlyphName =
    kind === 'semen' ? STRAW_GLYPH : kind === 'consumable' ? 'flask-outline' : 'construct-outline';
  const total = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
  return (
    <View
      style={[styles.panel, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-inventory-holding-${kind}`}
    >
      <View style={styles.panelHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Glyph name={icon} size={14} color={look.onSolid} />
        </View>
        <View style={styles.flex}>
          <AppText style={[styles.panelTitle, { color: look.text }]}>{title}</AppText>
          <AppText style={styles.sub}>{`${num(total)} ${foot}`}</AppText>
        </View>
        <Pill label={num(rows.length)} tone={tone} />
      </View>
      <View style={styles.inset}>
        {rows.length ? (
          rows.map((row, index) => {
            const qty = Number(row.qty) || 0;
            // Only straws carry a threshold: running out of them stops a Mait working.
            const qtyTone =
              kind !== 'semen' ? null : qty === 0 ? TONE.red : qty <= threshold ? TONE.yolk : null;
            return (
              <View key={`${row.name}-${index}`} style={[styles.line, index > 0 && styles.rule]}>
                <AppText style={styles.lineName}>
                  {row.name}
                  {!!row.unit && <AppText style={styles.sub}>{`  ${row.unit}`}</AppText>}
                </AppText>
                <AppText style={[styles.lineQty, qtyTone && { color: qtyTone.text }]}>
                  {num(qty)}
                </AppText>
              </View>
            );
          })
        ) : (
          <AppText style={[styles.hint, styles.lineEmpty]}>{t('admin.inventory.noneHeld')}</AppText>
        )}
      </View>
    </View>
  );
}

function MaitAdjust({
  data,
  onDone,
  reveal,
}: {
  data: MaitStockDetail;
  onDone: (text: string) => void;
  reveal: (field: View | null) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [dir, setDir] = useState<'add' | 'remove'>('add');
  const [kind, setKind] = useState<Kind>('straw');
  const [picked, setPicked] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [adjust, adjustState] = useAdminAdjustMaitStockMutation();
  const qtyRef = useRef<View>(null);
  const noteRef = useRef<View>(null);
  const removing = dir === 'remove';

  const heldItems = useMemo(() => {
    const held: Record<string, number> = {};
    [...(data.consumables ?? []), ...(data.assets ?? [])].forEach(line => {
      if (line.code) {
        held[line.code] = line.qty;
      }
    });
    return held;
  }, [data]);

  const heldOf = (item: Item | null): number => {
    if (!item) {
      return 0;
    }
    return item.key.startsWith('straw:')
      ? data.by_breed?.[item.code] || 0
      : heldItems[item.code] || 0;
  };

  /**
   * Adding draws from the whole catalogue — the point is to credit stock not held yet. Removing
   * draws only from what is held: taking off what is not there is not a thing to let anyone try.
   */
  const itemsOf = (k: Kind, d: 'add' | 'remove' = dir): Item[] => {
    const all = catalogueItems(t, data.catalogue, k);
    if (d === 'add') {
      return all;
    }
    if (k === 'straw') {
      // A held breed the catalogue no longer lists still has straws in the flask.
      const known = new Map(all.map(item => [item.code, item]));
      return Object.keys(data.by_breed ?? {})
        .filter(code => (data.by_breed[code] || 0) > 0)
        .map(code => known.get(code) ?? { key: `straw:${code}`, code, name: code });
    }
    return all.filter(item => (heldItems[item.code] || 0) > 0);
  };

  const counts = {
    straw: itemsOf('straw').length,
    consumable: itemsOf('consumable').length,
    asset: itemsOf('asset').length,
  };
  const items = itemsOf(kind);
  const item = items.find(i => i.key === picked) ?? null;
  const now = heldOf(item);

  const switchDir = (next: 'add' | 'remove') => {
    if (next === dir) {
      return;
    }
    setDir(next);
    // Keep the kind where it still offers something, else fall to the first that does.
    if (!itemsOf(kind, next).length) {
      const first = KINDS.find(k => itemsOf(k, next).length);
      if (first) {
        setKind(first);
      }
    }
    setPicked('');
    setQty('');
    setProblem(null);
  };

  const pick = (key: string) => {
    setPicked(key);
    setProblem(null);
    // Remove edits the quantity down from what is held — the "original value" — so it starts
    // there. Add is an amount and starts empty.
    if (removing) {
      const chosen = items.find(i => i.key === key) ?? null;
      setQty(chosen ? String(heldOf(chosen)) : '');
    }
  };

  const field = qty.trim() === '' ? null : Number(qty);
  let tone: PreviewTone = 'quiet';
  let text = removing
    ? item
      ? t('admin.inventory.removeQuiet')
      : t('admin.inventory.removePick')
    : t('admin.inventory.addQuiet');
  let ok = false;
  if (item && field !== null && !Number.isNaN(field)) {
    if (removing) {
      if (field > now) {
        tone = 'red';
        text = t('admin.inventory.holdOnly', { n: num(now) });
      } else if (field === now) {
        text = t('admin.inventory.removeSame');
      } else {
        tone = 'red';
        ok = true;
        text = t('admin.inventory.previewRemove', {
          name: itemLabel(item),
          from: num(now),
          to: num(field),
          diff: num(now - field),
        });
      }
    } else if (field < 1) {
      tone = 'red';
      text = t('admin.inventory.atLeastOne');
    } else {
      tone = 'green';
      ok = true;
      text = t('admin.inventory.previewAdd', {
        name: itemLabel(item),
        from: num(now),
        to: num(now + field),
        diff: num(field),
      });
    }
  }

  const hint = item
    ? now
      ? t('admin.inventory.heldNow', { n: num(now) })
      : t(removing ? 'admin.inventory.noneToRemove' : 'admin.inventory.noneYet')
    : t(removing ? 'admin.inventory.pickRemoved' : 'admin.inventory.pickAdded');

  const clear = () => {
    setPicked('');
    setQty('');
    setNote('');
    setProblem(null);
  };

  const save = async () => {
    if (!ok || !item || field === null) {
      return;
    }
    const move = removing ? now - field : field;
    setProblem(null);
    try {
      const fresh = await adjust({
        id: data.mait_id,
        ...bodyOf(item.key),
        qty: move,
        direction: dir,
        note: note.trim(),
      }).unwrap();
      clear();
      onDone(
        t(removing ? 'admin.inventory.removedFrom' : 'admin.inventory.addedTo', {
          n: num(move),
          name: itemLabel(item),
          mait: fresh.mait_name || data.mait_name,
        }),
      );
    } catch (error) {
      setProblem(
        problemOf(error, t(removing ? 'admin.inventory.notRemoved' : 'admin.inventory.notAdded')),
      );
    }
  };

  const busy = adjustState.isLoading;

  return (
    <View
      style={[
        styles.panel,
        removing
          ? { backgroundColor: TONE.red.wash, borderColor: TONE.red.border }
          : { backgroundColor: TONE.green.wash, borderColor: TONE.green.border },
      ]}
      testID="admin-inventory-adjust"
    >
      <View style={styles.panelHead}>
        <View
          style={[styles.chip, { backgroundColor: removing ? TONE.red.solid : TONE.green.solid }]}
        >
          <Ionicons name={removing ? 'remove' : 'add'} size={16} color={colors.surface} />
        </View>
        <AppText style={[styles.panelTitle, { color: removing ? TONE.red.text : TONE.green.text }]}>
          {t(removing ? 'admin.inventory.removeTitle' : 'admin.inventory.addTitle')}
        </AppText>
      </View>
      <AppText style={styles.editorNote}>
        {t(removing ? 'admin.inventory.removeNote' : 'admin.inventory.addNote')}
      </AppText>

      {/* Add or take off, as one deliberate choice: a count got wrong one way is got wrong
          the other, so the one form does both. */}
      <View style={styles.segmented} accessibilityRole="radiogroup">
        {(['add', 'remove'] as const).map(d => {
          const on = d === dir;
          const look = d === 'add' ? TONE.green : TONE.red;
          return (
            <Pressable
              key={d}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => switchDir(d)}
              style={[styles.segment, on && { backgroundColor: look.solid }]}
              testID={`admin-inventory-dir-${d}`}
            >
              <Ionicons
                name={d === 'add' ? 'add-circle-outline' : 'remove-circle-outline'}
                size={16}
                color={on ? look.onSolid : look.text}
              />
              <AppText style={[styles.segmentLabel, { color: on ? look.onSolid : look.text }]}>
                {t(d === 'add' ? 'admin.inventory.addStock' : 'admin.inventory.removeStock')}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <Step n={1} title={t('admin.inventory.whichKind')} />
      <KindPicker
        kind={kind}
        counts={counts}
        onPick={k => {
          setKind(k);
          setPicked('');
          setQty(removing ? '' : qty);
        }}
        testID="admin-inventory-mait-kind"
      />

      <Step n={2} title={t('admin.inventory.whichItem')} />
      <ItemPicker
        items={items}
        picked={picked}
        heldOf={heldOf}
        onPick={pick}
        empty={t(
          removing ? 'admin.inventory.nothingHeldOfKind' : 'admin.inventory.nothingInCatalogue',
        )}
        testID="admin-inventory-mait-item"
      />
      <AppText style={styles.hint} testID="admin-inventory-mait-hint">
        {hint}
      </AppText>

      <View ref={qtyRef} collapsable={false}>
        <Step
          n={3}
          title={t(removing ? 'admin.inventory.newQuantity' : 'admin.inventory.howManyAdd')}
        />
        <QtyStepper
          value={qty}
          onChange={setQty}
          onFocus={() => reveal(qtyRef.current)}
          testID="admin-inventory-mait-qty"
        />
      </View>
      <View ref={noteRef} collapsable={false}>
        <NoteField
          value={note}
          onChange={setNote}
          onFocus={() => reveal(noteRef.current)}
          testID="admin-inventory-mait-note"
        />
      </View>

      <Preview tone={tone} text={text} testID="admin-inventory-mait-preview" />

      {!!problem && (
        <View style={styles.problem}>
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <AppText style={styles.problemText}>{problem}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        {/* One save for both directions: green to add, a red outline to remove. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !ok || busy }}
          disabled={!ok || busy}
          onPress={save}
          style={({ pressed }) => [
            styles.flex,
            removing ? styles.danger : styles.primary,
            (!ok || busy) && (removing ? styles.dangerOff : styles.primaryOff),
            pressed && styles.pressed,
          ]}
          testID="admin-inventory-mait-save"
        >
          {busy ? (
            <ActivityIndicator color={removing ? colors.error : colors.surface} />
          ) : (
            <Ionicons
              name={removing ? 'remove' : 'add'}
              size={18}
              color={removing ? colors.error : colors.surface}
            />
          )}
          <AppText style={removing ? styles.dangerLabel : styles.primaryLabel}>
            {busy
              ? t(removing ? 'admin.inventory.removing' : 'admin.inventory.adding')
              : t(removing ? 'admin.inventory.removeFromStock' : 'admin.inventory.addToStock')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={clear}
          disabled={busy}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          testID="admin-inventory-mait-clear"
        >
          <AppText style={styles.secondaryLabel}>{t('admin.inventory.clear')}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

export function MaitStock({
  id,
  threshold,
  onBack,
}: {
  id: number;
  threshold: number;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useAdminMaitStockQuery(id, { refetchOnMountOrArgChange: true });
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);
  const data = detail.data;

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      refreshControl={
        <RefreshControl
          refreshing={detail.isFetching && !detail.isLoading}
          onRefresh={() => detail.refetch()}
        />
      }
      testID="admin-inventory-mait"
    >
      <BackTo label={t('admin.inventory.allMaits')} onPress={onBack} />
      {detail.isLoading ? (
        <SkeletonRecord />
      ) : !data ? (
        <EmptyState message={t('admin.inventory.maitFailed')} />
      ) : (
        (() => {
          const standing = standingOf(data.total_straws, threshold);
          const breeds = Object.keys(data.by_breed ?? {}).sort();
          return (
            <>
              <Hero
                title={data.mait_name}
                tone={STANDING_TONE[standing]}
                meta={
                  <>
                    <AppText style={styles.heroMeta}>{data.sahayak_vendor_code}</AppText>
                    {/* Straws first and in words: the number that decides whether this Mait
                        can work at all; the pills only qualify it. */}
                    <View style={styles.heroPills} testID="admin-inventory-mait-count">
                      <AppText style={styles.heroCount}>
                        {t('admin.inventory.straws_count', {
                          count: data.total_straws,
                          n: num(data.total_straws),
                        })}
                      </AppText>
                      <Pill
                        label={t(`admin.inventory.status_${standing}`)}
                        tone={STANDING_TONE[standing]}
                      />
                      <Pill
                        label={t('admin.inventory.breeds_count', {
                          count: breeds.length,
                          n: breeds.length,
                        })}
                        tone={breeds.length ? 'blue' : 'slate'}
                      />
                    </View>
                  </>
                }
              />
              <Flash flash={flash} />
              <HoldingCard
                kind="semen"
                title={t('admin.inventory.semenStraws')}
                rows={breeds.map(breed => ({ name: breed, qty: data.by_breed[breed] ?? 0 }))}
                foot={t('admin.inventory.strawsWord')}
                threshold={threshold}
              />
              <HoldingCard
                kind="consumable"
                title={t('admin.inventory.consumables')}
                rows={data.consumables ?? []}
                foot={t('admin.inventory.unitsWord')}
                threshold={threshold}
              />
              <HoldingCard
                kind="asset"
                title={t('admin.inventory.equipment')}
                rows={data.assets ?? []}
                foot={t('admin.inventory.itemsWord')}
                threshold={threshold}
              />
              {/* Keyed on the Mait so a reopened holding starts on Add, never on Remove. */}
              <MaitAdjust
                key={data.mait_id}
                data={data}
                reveal={api.reveal}
                onDone={text => setFlash({ text, tone: 'green' })}
              />
            </>
          );
        })()
      )}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// One store's shelf, and the shelf editor
// --------------------------------------------------------------------------------------

function kindOfLine(line: StoreStockLine): Kind {
  return line.category ?? (line.product_type === 'straw' ? 'straw' : 'consumable');
}

function keyOfLine(line: StoreStockLine): string {
  return line.product_type === 'straw'
    ? `straw:${line.breed}`
    : `consumable:${String(line.product_ref_id)}`;
}

/**
 * One item on the shelf: how many, and — when some are packed for a Mait — the split as a bar.
 * "Correct" opens the form on it, already chosen and counted.
 */
function ShelfLine({
  line,
  onCorrect,
}: {
  line: StoreStockLine;
  onCorrect: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const onHand = Number(line.on_hand) || 0;
  const packed = Number(line.set_aside) || 0;
  const free = Number(line.available) || 0;
  return (
    <View
      style={[styles.shelfLine, !onHand && styles.off]}
      testID={`admin-inventory-line-${keyOfLine(line)}`}
    >
      <View style={styles.flex}>
        <AppText style={styles.lineName}>{line.item_name}</AppText>
        <AppText style={styles.sub}>
          <AppText style={styles.freeText}>{t('admin.inventory.free', { n: num(free) })}</AppText>
          {packed ? (
            <>
              {' · '}
              <AppText style={styles.packedText}>
                {t('admin.inventory.packed', { n: num(packed) })}
              </AppText>
            </>
          ) : null}
          {line.unit ? ` · ${line.unit}` : ''}
        </AppText>
        {onHand > 0 && (
          <View style={styles.bar}>
            <View style={[styles.barFree, { flex: free }]} />
            <View style={[styles.barPacked, { flex: Math.max(0, onHand - free) }]} />
          </View>
        )}
      </View>
      <AppText style={styles.shelfQty}>{num(onHand)}</AppText>
      <Pressable
        accessibilityRole="button"
        onPress={onCorrect}
        style={({ pressed }) => [styles.correct, pressed && styles.pressed]}
        testID={`admin-inventory-correct-${keyOfLine(line)}`}
      >
        <AppText style={styles.correctLabel}>{t('admin.inventory.correct')}</AppText>
      </Pressable>
    </View>
  );
}

/** A store's shelf and its editor — also opened from the Stores screen's Stock button. */
export function StoreStock({
  store,
  onBack,
}: {
  store: Pick<OversightStore, 'id' | 'name' | 'code' | 'zone_name'>;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const shelf = useAdminStoreStockQuery(store.id, { refetchOnMountOrArgChange: true });
  const [update, updateState] = useAdminUpdateStoreStockMutation();
  const { scroller, content, overlap: keyboard, api } = useRevealOnFocus();
  const [mode, setMode] = useState<'receive' | 'count'>('receive');
  const [kind, setKind] = useState<Kind>('straw');
  const [picked, setPicked] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: ToneName } | null>(null);
  const formRef = useRef<View>(null);
  const qtyRef = useRef<View>(null);
  const noteRef = useRef<View>(null);

  const lines = shelf.data?.lines ?? [];
  const catalogue = shelf.data?.catalogue;
  const lineFor = (key: string) => lines.find(line => keyOfLine(line) === key) ?? null;
  const counts = {
    straw: catalogueItems(t, catalogue, 'straw').length,
    consumable: catalogueItems(t, catalogue, 'consumable').length,
    asset: catalogueItems(t, catalogue, 'asset').length,
  };
  const items = catalogueItems(t, catalogue, kind);
  const item = items.find(i => i.key === picked) ?? null;
  const line = item ? lineFor(item.key) : null;
  const now = line ? Number(line.on_hand) || 0 : 0;
  const packed = line ? Number(line.set_aside) || 0 : 0;

  const pick = (key: string) => {
    setPicked(key);
    setProblem(null);
    // A count starts from what the shelf says now, to be edited to what was counted.
    if (mode === 'count') {
      const found = key ? lineFor(key) : null;
      setQty(key ? String(found ? found.on_hand : 0) : '');
    }
  };

  const correct = (target: StoreStockLine) => {
    setMode('count');
    setKind(kindOfLine(target));
    setPicked(keyOfLine(target));
    setQty(String(target.on_hand));
    setProblem(null);
    api.reveal(formRef.current);
  };

  const field = qty.trim() === '' ? null : Number(qty);
  let tone: PreviewTone = 'quiet';
  let text = t('admin.inventory.addQuiet');
  let ok = false;
  if (item && field !== null && !Number.isNaN(field)) {
    if (mode === 'receive') {
      if (field < 1) {
        tone = 'red';
        text = t('admin.inventory.deliveryAtLeastOne');
      } else {
        tone = 'green';
        ok = true;
        text = t('admin.inventory.previewReceive', {
          name: itemLabel(item),
          from: num(now),
          to: num(now + field),
          diff: num(field),
        });
      }
    } else if (field < packed) {
      tone = 'red';
      text = t('admin.inventory.belowPacked', { n: num(packed) });
    } else if (field === now) {
      text = t('admin.inventory.shelfSame', { n: num(now) });
    } else {
      tone = 'yolk';
      ok = true;
      const change = field - now;
      text = t('admin.inventory.previewCount', {
        name: itemLabel(item),
        from: num(now),
        to: num(field),
        diff: `${change > 0 ? '+' : '−'}${num(Math.abs(change))}`,
      });
    }
  }

  const hint = item
    ? line
      ? packed
        ? t('admin.inventory.onShelfPacked', { n: num(now), packed: num(packed) })
        : t('admin.inventory.onShelf', { n: num(now) })
      : t('admin.inventory.noneOnShelf')
    : t('admin.inventory.pickArrived');

  const clear = () => {
    setPicked('');
    setQty('');
    setNote('');
    setProblem(null);
  };

  const save = async () => {
    if (!ok || !item || field === null) {
      return;
    }
    setProblem(null);
    try {
      const fresh = await update({
        id: store.id,
        mode,
        ...bodyOf(item.key),
        qty: field,
        note: note.trim(),
      }).unwrap();
      const after = (fresh.lines ?? []).find(l => keyOfLine(l) === item.key);
      setFlash({
        text: t('admin.inventory.shelfSaved', {
          name: itemLabel(item),
          store: store.name,
          n: num(after ? after.on_hand : 0),
        }),
        tone: 'green',
      });
      clear();
    } catch (error) {
      setProblem(problemOf(error, t('admin.inventory.notSaved')));
    }
  };

  const busy = updateState.isLoading;

  return (
    <ScrollView
      ref={scroller}
      innerViewRef={content}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.body, !!keyboard && { paddingBottom: keyboard + spacing[4] }]}
      refreshControl={
        <RefreshControl
          refreshing={shelf.isFetching && !shelf.isLoading}
          onRefresh={() => shelf.refetch()}
        />
      }
      testID="admin-inventory-store"
    >
      <BackTo label={t('admin.inventory.allStores')} onPress={onBack} />
      <Hero
        title={store.name}
        tone="green"
        meta={
          <AppText style={styles.heroMeta}>
            {[store.code, store.zone_name, t('admin.inventory.stockWord')]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        }
      />
      <Flash flash={flash} />

      {shelf.isLoading ? (
        <SkeletonRows />
      ) : shelf.isError ? (
        <EmptyState message={t('admin.inventory.shelfFailed')} />
      ) : (
        <>
          {/* The shelf as it stands, grouped the way the catalogue is. */}
          <View style={styles.shelfHead}>
            <AppText style={styles.sectionTitle}>{t('admin.inventory.onTheShelf')}</AppText>
            <View style={styles.legend}>
              <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
              <AppText style={styles.sub}>{t('admin.inventory.freeToGive')}</AppText>
              <View style={[styles.legendDot, { backgroundColor: yolk[400] }]} />
              <AppText style={styles.sub}>{t('admin.inventory.packedForMait')}</AppText>
            </View>
          </View>
          {KINDS.map(k => {
            const look = TONE[KIND_LOOK[k].tone];
            const mine = lines.filter(l => kindOfLine(l) === k);
            const total = mine.reduce((sum, l) => sum + (Number(l.on_hand) || 0), 0);
            return (
              <View
                key={k}
                style={[styles.panel, { backgroundColor: look.wash, borderColor: look.border }]}
                testID={`admin-inventory-shelf-${k}`}
              >
                <View style={styles.panelHead}>
                  <View style={[styles.chip, { backgroundColor: look.solid }]}>
                    <Glyph name={KIND_LOOK[k].icon} size={14} color={look.onSolid} />
                  </View>
                  <AppText style={[styles.panelTitle, { color: look.text }]}>
                    {t(`admin.inventory.kind_${k}`)}
                  </AppText>
                  <AppText style={styles.sub}>
                    {mine.length
                      ? t('admin.inventory.itemsTotal', {
                          count: mine.length,
                          n: mine.length,
                          total: num(total),
                        })
                      : t('admin.inventory.noneOnShelfShort')}
                  </AppText>
                </View>
                {mine.length > 0 && (
                  <View style={styles.inset}>
                    {mine.map((l, index) => (
                      <View key={keyOfLine(l)} style={index > 0 && styles.rule}>
                        <ShelfLine line={l} onCorrect={() => correct(l)} />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          {/* The change. Every step is a choice made on screen rather than a code typed. */}
          <View
            ref={formRef}
            collapsable={false}
            style={[
              styles.panel,
              mode === 'receive'
                ? { backgroundColor: TONE.green.wash, borderColor: TONE.green.border }
                : { backgroundColor: TONE.yolk.wash, borderColor: TONE.yolk.border },
            ]}
            testID="admin-inventory-store-form"
          >
            <Step n={1} title={t('admin.inventory.whatDoing')} />
            <View style={styles.modes}>
              {(['receive', 'count'] as const).map(m => {
                const on = m === mode;
                const look = m === 'receive' ? TONE.green : TONE.yolk;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      setMode(m);
                      setProblem(null);
                    }}
                    style={[
                      styles.mode,
                      {
                        backgroundColor: on ? look.solid : colors.surface,
                        borderColor: on ? look.solid : look.border,
                      },
                    ]}
                    testID={`admin-inventory-mode-${m}`}
                  >
                    <Ionicons
                      name={m === 'receive' ? 'cube-outline' : 'clipboard-outline'}
                      size={18}
                      color={on ? look.onSolid : look.text}
                    />
                    <AppText style={[styles.modeName, { color: on ? look.onSolid : colors.ink }]}>
                      {t(
                        m === 'receive'
                          ? 'admin.inventory.addDelivery'
                          : 'admin.inventory.correctCount',
                      )}
                    </AppText>
                    <AppText
                      style={[styles.modeHint, { color: on ? look.onSolid : colors.textMuted }]}
                    >
                      {t(
                        m === 'receive'
                          ? 'admin.inventory.deliveryHint'
                          : 'admin.inventory.countHint',
                      )}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <Step n={2} title={t('admin.inventory.whichKind')} />
            <KindPicker
              kind={kind}
              counts={counts}
              onPick={k => {
                setKind(k);
                setPicked('');
              }}
              testID="admin-inventory-store-kind"
            />

            <Step n={3} title={t('admin.inventory.whichItem')} />
            <ItemPicker
              items={items}
              picked={picked}
              heldOf={i => Number(lineFor(i.key)?.on_hand ?? 0)}
              onPick={pick}
              empty={t('admin.inventory.nothingInCatalogue')}
              testID="admin-inventory-store-item"
            />
            <AppText style={styles.hint} testID="admin-inventory-store-hint">
              {hint}
            </AppText>

            <View ref={qtyRef} collapsable={false}>
              <Step
                n={4}
                title={t(
                  mode === 'receive'
                    ? 'admin.inventory.howManyArrived'
                    : 'admin.inventory.howManyNow',
                )}
              />
              <QtyStepper
                value={qty}
                onChange={setQty}
                onFocus={() => api.reveal(qtyRef.current)}
                testID="admin-inventory-store-qty"
              />
            </View>
            <View ref={noteRef} collapsable={false}>
              <NoteField
                value={note}
                onChange={setNote}
                onFocus={() => api.reveal(noteRef.current)}
                testID="admin-inventory-store-note"
              />
            </View>

            <Preview tone={tone} text={text} testID="admin-inventory-store-preview" />

            {!!problem && (
              <View style={styles.problem}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <AppText style={styles.problemText}>{problem}</AppText>
              </View>
            )}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !ok || busy }}
                disabled={!ok || busy}
                onPress={save}
                style={({ pressed }) => [
                  styles.flex,
                  mode === 'receive' ? styles.primary : styles.warn,
                  (!ok || busy) && styles.primaryOff,
                  pressed && styles.pressed,
                ]}
                testID="admin-inventory-store-save"
              >
                {busy ? (
                  <ActivityIndicator color={mode === 'receive' ? colors.surface : colors.ink} />
                ) : (
                  <Ionicons
                    name={mode === 'receive' ? 'add' : 'checkmark'}
                    size={18}
                    color={mode === 'receive' ? colors.surface : colors.ink}
                  />
                )}
                <AppText style={mode === 'receive' ? styles.primaryLabel : styles.warnLabel}>
                  {busy
                    ? t('admin.inventory.saving')
                    : t(
                        mode === 'receive'
                          ? 'admin.inventory.addToStock'
                          : 'admin.inventory.saveCount',
                      )}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={clear}
                disabled={busy}
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                testID="admin-inventory-store-clear"
              >
                <AppText style={styles.secondaryLabel}>{t('admin.inventory.clear')}</AppText>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The two lists
// --------------------------------------------------------------------------------------

function MaitCard({
  row,
  breeds,
  threshold,
  onOpen,
}: {
  row: InventoryOversightRow;
  breeds: string[];
  threshold: number;
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const standing = standingOf(row.total, threshold);
  const tone = STANDING_TONE[standing];
  const look = TONE[tone];
  const mpps = row.mpp_codes ?? [];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: look.wash, borderColor: look.border },
        pressed && styles.pressed,
      ]}
      testID={`admin-inventory-${row.sahayak_vendor_code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(row.name)} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{row.name}</AppText>
          <AppText style={styles.sub}>
            {[
              row.sahayak_vendor_code,
              mpps.length
                ? `${mpps.slice(0, 2).join(', ')}${mpps.length > 2 ? ` +${mpps.length - 2}` : ''}`
                : t('admin.inventory.noMpps'),
            ].join(' · ')}
          </AppText>
        </View>
        <View style={styles.total}>
          <AppText
            style={[styles.totalValue, { color: look.text }]}
            testID={`admin-inventory-total-${row.sahayak_vendor_code}`}
          >
            {num(row.total)}
          </AppText>
          <Pill label={t(`admin.inventory.status_${standing}`)} tone={tone} />
        </View>
      </View>

      {/* A zero is written, not blanked: a blank reads as missing data, not "none of this". */}
      {breeds.length > 0 && (
        <View style={styles.breeds}>
          {breeds.map(breed => {
            const qty = row.by_breed[breed] || 0;
            return (
              <View key={breed} style={[styles.breed, !qty && styles.breedNone]}>
                <Glyph name={STRAW_GLYPH} size={11} color={qty ? colors.info : colors.textMuted} />
                <AppText
                  style={[styles.breedLabel, !qty && styles.muted]}
                >{`${breed} ${qty}`}</AppText>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.cardFoot}>
        <View style={[styles.stockButton, { borderColor: look.border }]}>
          <Ionicons name="layers-outline" size={14} color={look.text} />
          <AppText style={[styles.stockLabel, { color: look.text }]}>
            {t('admin.inventory.stock')}
          </AppText>
          <Ionicons name="chevron-forward" size={14} color={look.text} />
        </View>
      </View>
    </Pressable>
  );
}

function StoreCard({ store, onOpen }: { store: OversightStore; onOpen: () => void }) {
  const { t } = useTranslation();
  const free = store.straws_on_hand - store.straws_set_aside;
  // A store showing 40 with 40 set aside has nothing left to give.
  const tone: ToneName = store.straws_on_hand === 0 ? 'red' : free <= 0 ? 'yolk' : 'green';
  const look = TONE[tone];
  const lines = store.lines ?? [];

  return (
    <View
      style={[styles.card, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={`admin-inventory-store-${store.code}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} icon="storefront" />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{store.name}</AppText>
          <AppText style={styles.sub}>
            {[store.code, store.zone_name].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </View>

      <View style={styles.serves}>
        {store.plant_names?.length ? (
          store.plant_names.map(name => (
            <View key={name} style={styles.serve}>
              <AppText style={styles.serveLabel}>{name}</AppText>
            </View>
          ))
        ) : (
          <AppText style={styles.sub}>{t('admin.inventory.noPlants')}</AppText>
        )}
      </View>

      <View style={styles.inset}>
        <AppText
          style={[styles.shelfSummary, !lines.length && styles.muted]}
          testID={`admin-inventory-store-shelf-${store.code}`}
        >
          {lines.length
            ? lines.map(line => `${num(line.on_hand)} ${line.item_name}`).join(' · ')
            : t('admin.inventory.nothingOnShelf')}
        </AppText>
        <View style={[styles.figures, styles.ruleTop]}>
          <View style={styles.figure}>
            <AppText style={styles.figureValue}>{num(store.straws_on_hand)}</AppText>
            <AppText style={styles.figureLabel}>{t('admin.inventory.strawsCol')}</AppText>
          </View>
          <View style={styles.figure}>
            <AppText style={[styles.figureValue, !store.straws_set_aside && styles.muted]}>
              {store.straws_set_aside ? num(store.straws_set_aside) : t('admin.inventory.noneWord')}
            </AppText>
            <AppText style={styles.figureLabel}>{t('admin.inventory.setAside')}</AppText>
          </View>
          <View style={styles.figure}>
            <AppText style={[styles.figureValue, !store.open_indents && styles.muted]}>
              {store.open_indents ? num(store.open_indents) : t('admin.inventory.noneWord')}
            </AppText>
            <AppText style={styles.figureLabel}>{t('admin.inventory.waiting')}</AppText>
          </View>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Pressable
          accessibilityRole="button"
          onPress={onOpen}
          style={({ pressed }) => [styles.goodOutline, pressed && styles.pressed]}
          testID={`admin-inventory-store-open-${store.code}`}
        >
          <Ionicons name="add" size={15} color={colors.primaryDark} />
          <AppText style={styles.goodOutlineLabel}>{t('admin.inventory.addReduce')}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

type Tab = 'maits' | 'stores';

export default function AdminInventoryScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('maits');
  const [zone, setZone] = useState<{ id: number; name: string } | null>(null);
  const [pickingZone, setPickingZone] = useState(false);
  const [term, setTerm] = useState('');
  const [lowFirst, setLowFirst] = useState(true);
  const [openMait, setOpenMait] = useState<number | null>(null);
  const [openStore, setOpenStore] = useState<OversightStore | null>(null);

  const data = useAdminInventoryOversightQuery(zone ? { zone: zone.id } : undefined);
  // Head office picks a zone; a zonal manager is already narrowed, and the zones list either
  // refuses them or has nothing to offer — the picker then stays out of the way.
  const zones = useAdminListZonesQuery();
  const activeZones = (zones.data?.results ?? []).filter(z => z.is_active);

  const open = openMait !== null || openStore !== null;
  useEffect(() => {
    if (!open) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenMait(null);
      setOpenStore(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const summary = data.data?.summary;
  const threshold = summary?.low_stock_threshold ?? 10;
  const rows = useMemo(() => data.data?.results ?? [], [data.data]);
  const stores = data.data?.stores ?? [];

  // Breed chips built from the data, never hardcoded: the breed list is configuration.
  const breeds = useMemo(() => {
    const all = new Set<string>();
    rows.forEach(row => Object.keys(row.by_breed ?? {}).forEach(b => all.add(b)));
    return [...all].sort();
  }, [rows]);

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    let list = rows;
    if (needle) {
      list = list.filter(
        row =>
          row.name.toLowerCase().includes(needle) ||
          row.sahayak_vendor_code.toLowerCase().includes(needle) ||
          (row.mpp_codes ?? []).join(' ').toLowerCase().includes(needle),
      );
    }
    // The server already sends them emptiest first.
    return lowFirst ? list : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, term, lowFirst]);

  if (openMait !== null) {
    return (
      <View style={styles.root}>
        <MaitStock id={openMait} threshold={threshold} onBack={() => setOpenMait(null)} />
      </View>
    );
  }
  if (openStore !== null) {
    return (
      <View style={styles.root}>
        <StoreStock store={openStore} onBack={() => setOpenStore(null)} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={data.isFetching && !data.isLoading}
            onRefresh={() => data.refetch()}
          />
        }
        testID="admin-inventory"
      >
        <AppText style={styles.count} testID="admin-inventory-meta">
          {summary
            ? t('admin.inventory.meta', {
                maits: num(summary.maits),
                stores: t('admin.inventory.shelves', {
                  count: summary.stores ?? 0,
                  n: num(summary.stores ?? 0),
                }),
              })
            : '—'}
        </AppText>

        {data.isLoading ? (
          <SkeletonOverview />
        ) : data.isError ? (
          <EmptyState message={t('admin.inventory.error')} />
        ) : (
          <>
            {summary && (
              <>
                <View style={styles.tiles}>
                  <Tile
                    tone="blue"
                    icon={STRAW_GLYPH}
                    label={t('admin.inventory.withMaits')}
                    value={num(summary.total_straws)}
                    foot={t('admin.inventory.inTheField')}
                    testID="admin-inventory-tile-total"
                  />
                  <Tile
                    tone="yolk"
                    icon="time"
                    label={t('admin.inventory.runningLow')}
                    value={num(summary.low)}
                    foot={t('admin.inventory.atOrUnder', { n: summary.low_stock_threshold })}
                    testID="admin-inventory-tile-low"
                  />
                </View>
                <View style={styles.tiles}>
                  {/* Not a warning: a Mait at zero records nothing at all. */}
                  <Tile
                    tone="red"
                    icon="close"
                    label={t('admin.inventory.atZero')}
                    value={num(summary.at_zero)}
                    foot={t('admin.inventory.cannotRecord')}
                    testID="admin-inventory-tile-zero"
                  />
                  <Tile
                    tone="slate"
                    icon="pricetags-outline"
                    label={t('admin.inventory.breedsHeld')}
                    value={num(breeds.length)}
                    foot={t('admin.inventory.acrossField')}
                    testID="admin-inventory-tile-breeds"
                  />
                </View>
                {/* The depots' half of the answer: a Mait at zero next to a store holding
                    forty is an indent waiting to be approved, not a shortage. */}
                <Tile
                  tone="green"
                  icon="storefront-outline"
                  label={t('admin.inventory.onShelves')}
                  value={num(summary.store_straws ?? 0)}
                  foot={
                    (summary.stores ?? 0) === 1
                      ? t('admin.inventory.oneDepot')
                      : t('admin.inventory.acrossDepots', { n: num(summary.stores ?? 0) })
                  }
                  testID="admin-inventory-tile-stores"
                />
              </>
            )}

            {activeZones.length > 0 && (
              <View style={styles.filters}>
                <FilterChip
                  label={zone ? zone.name : t('admin.inventory.wholeNetwork')}
                  icon="map-outline"
                  tone="blue"
                  active={!!zone}
                  onPress={() => setPickingZone(true)}
                  testID="admin-inventory-zone"
                />
              </View>
            )}

            {/* Whose stock: the two pills the rest of the screen hangs from. */}
            <View style={styles.tabs} accessibilityRole="tablist">
              {(['maits', 'stores'] as const).map(name => {
                const on = tab === name;
                const look = name === 'maits' ? TONE.yolk : TONE.green;
                return (
                  <Pressable
                    key={name}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setTab(name)}
                    style={[
                      styles.tab,
                      {
                        backgroundColor: on ? look.solid : look.wash,
                        borderColor: on ? look.solid : look.border,
                      },
                    ]}
                    testID={`admin-inventory-tab-${name}`}
                  >
                    <Ionicons
                      name={name === 'maits' ? 'people' : 'storefront'}
                      size={16}
                      color={on ? look.onSolid : look.text}
                    />
                    <AppText style={[styles.tabLabel, { color: on ? look.onSolid : look.text }]}>
                      {t(
                        name === 'maits' ? 'admin.inventory.tabMaits' : 'admin.inventory.tabStores',
                      )}
                    </AppText>
                    <View
                      style={[
                        styles.tabCount,
                        { backgroundColor: on ? colors.surface : look.solid },
                      ]}
                    >
                      <AppText
                        style={[styles.tabCountLabel, { color: on ? look.text : look.onSolid }]}
                      >
                        {num(name === 'maits' ? rows.length : stores.length)}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {tab === 'maits' ? (
              <>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={16} color={colors.info} />
                  <TextInput
                    style={styles.searchInput}
                    value={term}
                    onChangeText={setTerm}
                    placeholder={t('admin.inventory.searchPlaceholder')}
                    placeholderTextColor={colors.textDisabled}
                    autoCorrect={false}
                    testID="admin-inventory-search"
                  />
                  {term.length > 0 && (
                    <Pressable onPress={() => setTerm('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                </View>
                <View style={styles.filters}>
                  <FilterChip
                    label={t('admin.inventory.lowFirst')}
                    icon="trending-down"
                    tone="yolk"
                    active={lowFirst}
                    onPress={() => setLowFirst(on => !on)}
                    testID="admin-inventory-low-first"
                  />
                </View>
                {visible.length === 0 ? (
                  <EmptyState
                    message={t(rows.length ? 'admin.inventory.noMatch' : 'admin.inventory.none')}
                  />
                ) : (
                  visible.map(row => (
                    <MaitCard
                      key={row.mait_id}
                      row={row}
                      breeds={breeds}
                      threshold={threshold}
                      onOpen={() => setOpenMait(row.mait_id)}
                    />
                  ))
                )}
              </>
            ) : (
              <>
                <Notice
                  tone="green"
                  icon="storefront"
                  title={t('admin.inventory.storesTitle')}
                  body={t('admin.inventory.storesBody')}
                  testID="admin-inventory-stores-note"
                />
                {stores.length === 0 ? (
                  <EmptyState message={t('admin.inventory.noStores')} />
                ) : (
                  stores.map(store => (
                    <StoreCard key={store.id} store={store} onOpen={() => setOpenStore(store)} />
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={pickingZone}
        title={t('admin.inventory.pickZone')}
        onClose={() => setPickingZone(false)}
        testID="admin-inventory-zone-sheet"
      >
        <View style={styles.items}>
          {[{ id: 0, name: t('admin.inventory.wholeNetwork') }, ...activeZones].map((z, index) => {
            const on = (zone?.id ?? 0) === z.id;
            return (
              <Pressable
                key={z.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setZone(z.id ? { id: z.id, name: z.name } : null);
                  setPickingZone(false);
                }}
                style={[styles.item, index > 0 && styles.itemRule, on && styles.itemOn]}
                testID={`admin-inventory-zone-${z.id}`}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={on ? colors.info : colors.textMuted}
                />
                <AppText style={[styles.itemName, on && styles.itemNameOn]}>{z.name}</AppText>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.4 },
  muted: { color: colors.textMuted },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  ruleTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

  count: { ...typography.h3, color: colors.ink },
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },

  tabs: { flexDirection: 'row', gap: spacing[2] },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  tabLabel: { ...typography.bodyStrong },
  tabCount: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

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

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  cardName: { ...typography.h3, color: colors.ink },
  total: { alignItems: 'flex-end', gap: 4 },
  totalValue: { ...typography.h2 },
  breeds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  breed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  breedNone: { borderColor: colors.border },
  breedLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.ink },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  stockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  stockLabel: { ...typography.label },

  serves: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  serve: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  serveLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  shelfSummary: { ...typography.label, color: colors.ink, paddingVertical: spacing[2] },
  figures: { flexDirection: 'row', paddingVertical: spacing[2] },
  figure: { flex: 1, alignItems: 'center' },
  figureValue: { ...typography.bodyStrong, color: colors.ink },
  figureLabel: { ...typography.caption, color: colors.textMuted },
  goodOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  goodOutlineLabel: { ...typography.label, color: colors.primaryDark },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },
  hero: { padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.ink },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroTitle: { ...typography.h2, color: colors.surface },
  heroMeta: { ...typography.caption, color: yolk[300] },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  heroCount: { ...typography.label, color: colors.surface },

  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  lineName: { ...typography.label, color: colors.ink, flex: 1 },
  lineQty: { ...typography.bodyStrong, color: colors.ink },
  lineEmpty: { paddingVertical: spacing[2] },
  editorNote: { ...typography.caption, color: colors.ink },

  segmented: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    borderRadius: radius.pill,
  },
  segmentLabel: { ...typography.label },

  step: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[1] },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  stepDotLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  stepTitle: { ...typography.bodyStrong, color: colors.ink, flex: 1 },

  kinds: { flexDirection: 'row', gap: spacing[2] },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[2],
    paddingHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  kindName: { ...typography.caption, fontFamily: typography.label.fontFamily, textAlign: 'center' },
  kindCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  kindCountLabel: { ...typography.caption, fontFamily: typography.label.fontFamily },

  items: { borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 44,
    paddingHorizontal: spacing[3],
  },
  itemRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemOn: { backgroundColor: colors.infoWash },
  itemName: { ...typography.label, color: colors.ink, flex: 1 },
  itemNameOn: { color: colors.info },
  itemHeld: { ...typography.caption, color: colors.ink },

  qty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  qtyStep: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[400],
  },
  qtyField: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'center',
    ...typography.h2,
    color: colors.ink,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  noteWrap: { gap: 4 },
  noteLabel: { ...typography.label, color: colors.ink },
  noteField: {
    ...typography.body,
    color: colors.ink,
    minHeight: 44,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  previewText: { ...typography.label, color: colors.textMuted, flex: 1 },
  problem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  problemText: { ...typography.label, color: colors.error, flex: 1 },
  actions: { flexDirection: 'row', gap: spacing[2] },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryOff: { opacity: 0.45 },
  primaryLabel: { ...typography.label, color: colors.surface },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: yolk[400],
  },
  warnLabel: { ...typography.label, color: colors.ink },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  dangerOff: { opacity: 0.45 },
  dangerLabel: { ...typography.label, color: colors.error },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  secondaryLabel: { ...typography.label, color: colors.ink },

  shelfHead: { gap: 4 },
  sectionTitle: { ...typography.h3, color: colors.ink },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  shelfLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  freeText: { ...typography.caption, color: colors.primaryDark },
  packedText: { ...typography.caption, color: yolk[800] },
  bar: {
    flexDirection: 'row',
    height: 5,
    marginTop: 4,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: ink[50],
  },
  barFree: { backgroundColor: colors.primary },
  barPacked: { backgroundColor: yolk[400] },
  shelfQty: { ...typography.h3, color: colors.ink, minWidth: 36, textAlign: 'right' },
  correct: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: yolk[400],
    backgroundColor: colors.secondaryWash,
  },
  correctLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: yolk[800],
  },
  modes: { flexDirection: 'row', gap: spacing[2] },
  mode: { flex: 1, gap: 2, padding: spacing[3], borderRadius: radius.md, borderWidth: 1.5 },
  modeName: { ...typography.label },
  modeHint: { ...typography.caption },
});
