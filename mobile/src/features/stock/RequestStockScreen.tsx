/**
 * Raise an indent — M18 (SRS §6.6.1).
 *
 * One card per line: category, product, quantity. A Mait restocking is writing a list, and
 * each item is a small decision made in one place rather than three fields scattered down a
 * form.
 *
 * A line is only open while it is being decided. Once it names a product and a quantity it
 * folds down to a single row — number, name, amount — because at that point it is not a form
 * any more, it is an item on a list, and four expanded cards is a screen a Mait has to scroll
 * to see what they have asked for. The pencil opens one back up; "Done" folds it away again.
 *
 * The API takes one product per indent, so each line is posted as its own request, each with
 * its own idempotency key — a double tap on a bad connection cannot make the depot pack
 * twice.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useCreateIndentMutation,
  useGetInventorySummaryQuery,
  useListBreedsQuery,
  useListMppsQuery,
  useListProductsQuery,
} from '@api/endpoints';
import type { ProblemDetails } from '@api/types';
import BottomSheet, { Sheet, SheetSection, SheetTone } from '@/components/BottomSheet';
import Glyph, { GlyphName, STRAW_GLYPH } from '@/components/glyph';
import { FlowNotice, FlowScreen, FlowSpacer, useFieldReveal } from '@/features/aiFlow/components';
import { colors, green, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

type Category = 'straw' | 'consumable' | 'asset';

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_STRAWS = 25;

/** Fewer than this held of one breed or item reads as low in the picker, as on Inventory. */
const LOW_HELD = 3;

/** How much is held, as a colour: none red, low yolk, enough green. */
function heldTone(count: number): SheetTone {
  return count <= 0 ? 'danger' : count < LOW_HELD ? 'warm' : 'good';
}

/**
 * Straws are issued by the box, so nudging by one produces a number nobody can fill.
 *
 * The hint beside the stepper says "issued in fives" in words rather than reading the number
 * off this constant — if the box size ever changes, that copy has to change with it.
 */
const STRAW_STEP = 5;

type Tone = 'info' | 'good' | 'warm';

/**
 * Each kind in its colour and glyph — the same three Inventory draws them in, so a line on
 * the indent is the colour of the tab its stock will land on.
 */
const KIND: Record<Category, { tone: Tone; icon: GlyphName }> = {
  straw: { tone: 'info', icon: STRAW_GLYPH },
  consumable: { tone: 'good', icon: 'flask' },
  asset: { tone: 'warm', icon: 'construct' },
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

interface Line {
  id: string;
  category: Category;
  /** Breed code for straws, product code otherwise. */
  product: string | null;
  qty: string;
}

function blankLine(): Line {
  return { id: newClientUuid(), category: 'straw', product: null, qty: String(USUAL_STRAWS) };
}

function stepOf(line: Line): number {
  return line.category === 'straw' ? STRAW_STEP : 1;
}

function isComplete(line: Line): boolean {
  return !!line.product && Number(line.qty) > 0;
}

/**
 * "AKBARPUR" as a place rather than a shout.
 *
 * Plant names arrive from SAP in capitals, and a Mait reading "AKBARPUR store" is being
 * shouted at by their own dairy. Devanagari has no case, so this is a no-op in Hindi.
 */
function asPlaceName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The quantity box, between its two stepper buttons.
 *
 * A component of its own only so it can hold a ref: this form grows a row per product, so the
 * box being typed into is often halfway down a list and behind the keyboard. `useFieldReveal`
 * is what asks the body to bring it back up — the same machinery the flow's own fields use,
 * rather than a second answer to the same question.
 */
function QuantityBox({
  value,
  unit,
  label,
  onChangeText,
  testID,
}: {
  value: string;
  unit: string;
  label: string;
  onChangeText: (text: string) => void;
  testID: string;
}): React.JSX.Element {
  const { ref, onFocus } = useFieldReveal();

  return (
    <View ref={ref} style={styles.quantityBody}>
      <TextInput
        style={styles.quantityInput}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        keyboardType="number-pad"
        accessibilityLabel={label}
        testID={testID}
      />
      <Text style={styles.quantityUnit}>{unit}</Text>
    </View>
  );
}

export default function RequestStockScreen({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const hindi = i18n.language.startsWith('hi');

  const breeds = useListBreedsQuery();
  const products = useListProductsQuery();
  const stock = useGetInventorySummaryQuery();
  // Already loaded by the capture flow, so this is a cache read on all but the first visit.
  // It is here only for the plant name — the one thing the app knows about where an indent
  // goes, and the difference between "Ready to send" and "Akbarpur store".
  const mpps = useListMppsQuery();
  const [createIndent, { isLoading }] = useCreateIndentMutation();

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  /** The one line whose card is open. A finished line folds away unless it is this one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  const held = stock.data?.by_breed ?? {};
  const heldProducts = [...(stock.data?.consumables ?? []), ...(stock.data?.assets ?? [])];

  const update = (id: string, patch: Partial<Line>) =>
    setLines(current => current.map(line => (line.id === id ? { ...line, ...patch } : line)));

  const canSubmit = lines.length > 0 && lines.every(isComplete);

  /**
   * The dairy this indent is going to.
   *
   * Null when a Mait's MPPs report into more than one plant, or into none the master named:
   * a destination guessed from the first row would be wrong for the other villages, and a
   * wrong store is worse than no store — it is the sentence a Mait would act on.
   */
  const destination = useMemo(() => {
    const names = [
      ...new Set(
        (mpps.data?.results ?? [])
          .map(mpp => (mpp.plant_name ?? '').trim())
          .filter(name => name.length > 0),
      ),
    ];
    return names.length === 1 ? asPlaceName(names[0]!) : null;
  }, [mpps.data]);

  function productLabel(line: Line): string | null {
    if (!line.product) {
      return null;
    }
    if (line.category === 'straw') {
      const breed = (breeds.data ?? []).find(row => row.code === line.product);
      return breed ? (hindi && breed.name_hi) || breed.name : line.product;
    }
    const product = (products.data ?? []).find(row => row.code === line.product);
    return product ? product.name : line.product;
  }

  /**
   * The second line of a folded row: what kind of thing it is, and which one.
   *
   * A straw is qualified by species rather than by its breed code — "Straws · buffalo" says
   * the thing a Mait scans the row for, and the breed is already the name above it.
   */
  function lineMeta(line: Line): string {
    const kind = t(`requestStock.categoryShort_${line.category}`);
    if (line.category === 'straw') {
      const breed = (breeds.data ?? []).find(row => row.code === line.product);
      return breed ? `${kind} · ${t(`requestStock.species_${breed.animal_type}`)}` : kind;
    }
    return line.product ? `${kind} · ${line.product}` : kind;
  }

  function unitFor(line: Line): string {
    if (line.category === 'straw') {
      return t('requestStock.straws');
    }
    const product = (products.data ?? []).find(row => row.code === line.product);
    // Some catalogue rows carry no unit at all — sheaths are counted, not measured.
    if (!product?.unit) {
      return t('requestStock.units');
    }
    return t('stock.unitPlural', { unit: product.unit });
  }

  function productOptions(category: Category): SheetSection[] {
    if (category === 'straw') {
      // One section per animal, in the order the master lists them. A Mait asking for straws
      // knows whether it is for cows or buffaloes before they know which breed, and a mixed
      // list makes them read every row to find the half they want.
      const byAnimal = new Map<string, SheetSection['options']>();
      for (const breed of breeds.data ?? []) {
        const options = byAnimal.get(breed.animal_type) ?? [];
        options.push({
          value: breed.code,
          label: (hindi && breed.name_hi) || breed.name,
          badge: t('requestStock.inHandShort', { count: held[breed.code] ?? 0 }),
          badgeTone: heldTone(held[breed.code] ?? 0),
        });
        byAnimal.set(breed.animal_type, options);
      }
      return [...byAnimal].map(([animal, options]) => ({
        title: t(`aiFlow.animalType.${animal}`),
        options,
      }));
    }
    return [
      {
        title: category === 'consumable' ? t('stock.consumables') : t('stock.assets'),
        options: (products.data ?? [])
          .filter(product => product.category === category)
          .map(product => {
            const count = heldProducts.find(row => row.code === product.code)?.qty ?? 0;
            return {
              value: product.code,
              label: product.name,
              meta: product.unit,
              badge: t('requestStock.inHandShort', { count }),
              badgeTone: heldTone(count),
            };
          }),
      },
    ];
  }

  /**
   * "3 lines · 55 straws · 10 litres".
   *
   * Grouped by unit, because the quantities are not addable across kinds: fifty-five straws
   * and ten litres are two facts, and a single total of sixty-five would be neither of them.
   * A line with no product chosen yet still counts if its unit is knowable — every straw line
   * is, which is why the very first line already reads "1 line · 25 straws".
   */
  const footerCount = useMemo(() => {
    const byUnit = new Map<string, number>();
    for (const line of lines) {
      const qty = Number(line.qty) || 0;
      if (qty <= 0 || (line.category !== 'straw' && !line.product)) {
        continue;
      }
      const unit = unitFor(line);
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + qty);
    }
    return [
      t('requestStock.lineCount', { count: lines.length }),
      ...[...byUnit].map(([unit, count]) => t('requestStock.amount', { count, unit })),
    ].join(' · ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, products.data, t]);

  /**
   * What the first unfinished line is still missing, and which line that is.
   *
   * Naming the line matters once there are three of them: "finish each line" leaves a Mait
   * hunting for which one, and the unfinished line is not always the one on screen.
   */
  const blocker = useMemo(() => {
    const index = lines.findIndex(line => !isComplete(line));
    if (index < 0) {
      return null;
    }
    const line = lines[index]!;
    const key = !line.product ? (line.category === 'straw' ? 'needBreed' : 'needItem') : 'needQty';
    return t(`requestStock.${key}`, { n: index + 1 });
  }, [lines, t]);

  const submit = async () => {
    setFailed(null);
    let posted = 0;
    try {
      for (const line of lines) {
        // Straws are asked for by breed; everything else by catalogue id. Sending the id
        // rather than the code is what lets the depot and the admin screen say "Sheaths"
        // instead of "Consumable" — the server has no other way to name what was asked for.
        const product =
          line.category === 'straw'
            ? undefined
            : (products.data ?? []).find(row => row.code === line.product);

        await createIndent({
          client_uuid: line.id,
          product_type: line.category === 'straw' ? 'straw' : 'consumable',
          breed: line.category === 'straw' ? (line.product ?? '') : '',
          ...(product ? { product_ref_id: product.id } : {}),
          qty_requested: Number(line.qty),
        }).unwrap();
        posted += 1;
      }
      setSent(posted);
    } catch (err) {
      const problem = (err as { data?: ProblemDetails })?.data;
      // Says how many landed. Reading a partial failure as "nothing sent" is how a depot
      // ends up packing the order twice.
      setFailed(
        posted > 0
          ? t('requestStock.partial', { sent: posted, total: lines.length })
          : (problem?.detail ?? t('errors.generic')),
      );
    }
  };

  if (sent > 0) {
    return (
      <FlowScreen
        step={null}
        stepLabel={t('requestStock.sentLabel')}
        title={t('requestStock.sentTitle')}
        subtitle={t('requestStock.sentSubtitle', { count: sent })}
        onBack={onDone}
        tabBarBelow
        place
      >
        <View style={styles.sentCard} testID="indent-sent-card">
          <View style={styles.sentHead}>
            <View style={[styles.chip, styles.solid_good]}>
              <Ionicons name="checkmark" size={18} color={colors.surface} />
            </View>
            <Text style={styles.sentTitle}>{t('requestStock.sentList')}</Text>
            <View style={[styles.badge, styles.solid_good]}>
              <Text style={[styles.badgeLabel, { color: colors.surface }]}>{sent}</Text>
            </View>
          </View>
          {lines.slice(0, sent).map(line => {
            const { tone, icon } = KIND[line.category];
            return (
              <View key={`sent-${line.id}`} style={[styles.sentRow, styles[`row_${tone}`]]}>
                <View style={[styles.chipSmall, styles[`solid_${tone}`]]}>
                  <Glyph name={icon} size={14} color={onSolid(tone)} />
                </View>
                <Text style={styles.sentName} numberOfLines={1}>
                  {productLabel(line)}
                </Text>
                <Text style={[styles.sentQty, { color: SOLID[tone] }]}>
                  {line.qty} {unitFor(line)}
                </Text>
              </View>
            );
          })}
        </View>

        <FlowNotice
          tone="info"
          title={t('requestStock.whatNextTitle')}
          body={t('requestStock.whatNextBody')}
          testID="indent-sent"
        />
        <FlowSpacer />
      </FlowScreen>
    );
  }

  const openLine = lines.find(line => line.id === picking) ?? null;

  return (
    <FlowScreen
      step={null}
      title={t('requestStock.title')}
      subtitle={t('requestStock.subtitle')}
      // No back button and no eyebrow: the mark is the whole top row, the way it is on every
      // other tab screen. Nothing is stranded by leaving it off — Android's own back is
      // handled in the navigator, and the tab bar under this screen is a way out on any
      // handset. An unsent indent is a decision not yet made, so there is nothing to lose.
      tabBarBelow
      // Reached from a tab rather than dealt as one of six steps, so the header wears the
      // mark rather than a step count.
      place
      footerNote={
        <View style={styles.footerNote}>
          <View style={styles.footerCountPill}>
            <Ionicons name="list" size={14} color={colors.info} />
            <Text style={styles.footerCount} numberOfLines={2} testID="indent-count">
              {footerCount}
            </Text>
          </View>
          {/* The only place the screen says why the button below it is grey — or, once it is
              not, where the list is about to go. Yolk while it waits, green once it can go. */}
          <View style={[styles.footerStatePill, blocker ? styles.pill_warm : styles.pill_good]}>
            <Ionicons
              name={blocker ? 'alert-circle' : destination ? 'storefront' : 'checkmark-circle'}
              size={14}
              color={blocker ? yolk[800] : colors.primaryDark}
            />
            <Text
              style={[styles.footerState, !!blocker && styles.footerStateWaiting]}
              numberOfLines={2}
              testID="indent-state"
            >
              {blocker ??
                (destination
                  ? t('requestStock.goesTo', { plant: destination })
                  : t('requestStock.readyToSend'))}
            </Text>
          </View>
        </View>
      }
      cta={{
        label: t('requestStock.submit'),
        onPress: () => setReviewing(true),
        disabled: !canSubmit,
        busy: isLoading,
        testID: 'indent-submit',
      }}
    >
      {lines.map((line, index) => {
        const complete = isComplete(line);
        const open = !complete || editing === line.id;
        const { tone, icon } = KIND[line.category];

        /* Folded. The line has been decided, so it reads as an item on a list rather than a
           form still waiting for an answer. */
        if (!open) {
          return (
            <Pressable
              key={line.id}
              accessibilityRole="button"
              accessibilityLabel={t('requestStock.editLine', { n: index + 1 })}
              onPress={() => setEditing(line.id)}
              style={({ pressed }) => [
                styles.row,
                styles[`row_${tone}`],
                pressed && styles.rowPressed,
              ]}
              testID={`indent-row-${index}`}
            >
              {/* The kind's glyph on its colour, with the line's number tucked on its corner. */}
              <View style={[styles.chip, styles[`solid_${tone}`]]}>
                <Glyph name={icon} size={18} color={onSolid(tone)} />
                <View style={styles.chipNumber}>
                  <Text style={styles.chipNumberLabel}>{index + 1}</Text>
                </View>
              </View>

              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {productLabel(line)}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {lineMeta(line)}
                </Text>
              </View>

              <View style={styles.rowAmount}>
                <Text style={[styles.rowQty, { color: SOLID[tone] }]}>{line.qty}</Text>
                <Text style={[styles.rowUnit, { color: SOLID[tone] }]} numberOfLines={1}>
                  {unitFor(line)}
                </Text>
              </View>

              <View style={styles.edit}>
                <Ionicons name="pencil" size={14} color={SOLID[tone]} />
              </View>
            </Pressable>
          );
        }

        return (
          <View
            key={line.id}
            style={[styles.card, styles[`row_${tone}`]]}
            testID={`indent-card-${index}`}
          >
            <View style={styles.cardHead}>
              <View style={[styles.chip, styles[`solid_${tone}`]]}>
                <Glyph name={icon} size={18} color={onSolid(tone)} />
              </View>
              <View style={styles.cardTitleBox}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {t('requestStock.lineN', { n: index + 1 })}
                </Text>
                <Text style={[styles.cardKind, { color: SOLID[tone] }]} numberOfLines={1}>
                  {t(`requestStock.category_${line.category}`)}
                </Text>
              </View>

              {/* Only offered once the line says something worth folding away. On a line with
                  no product chosen, "Done" would be a lie. */}
              {complete && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditing(null)}
                  style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
                  testID={`indent-done-${index}`}
                >
                  <Ionicons name="checkmark" size={14} color={colors.surface} />
                  <Text style={styles.doneLabel}>{t('requestStock.doneLine')}</Text>
                </Pressable>
              )}

              {lines.length > 1 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('requestStock.removeLine', { n: index + 1 })}
                  onPress={() => setLines(current => current.filter(l => l.id !== line.id))}
                  style={styles.remove}
                  testID={`indent-remove-${index}`}
                >
                  <Ionicons name="close" size={18} color={colors.error} />
                </Pressable>
              )}
            </View>

            {/* All three visible at once: it is a choice of three, and a dropdown would hide
                two of them behind a tap for nothing. */}
            <View style={styles.segments}>
              {(['straw', 'consumable', 'asset'] as Category[]).map(category => {
                const active = line.category === category;
                const kind = KIND[category];
                return (
                  <Pressable
                    key={category}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() =>
                      update(line.id, {
                        category,
                        // The product list changes with the category, so the old choice is void.
                        product: null,
                        qty: category === 'straw' ? String(USUAL_STRAWS) : '1',
                      })
                    }
                    style={[
                      styles.segment,
                      styles[`tab_${kind.tone}`],
                      active && styles[`solid_${kind.tone}`],
                    ]}
                    testID={`indent-cat-${category}-${index}`}
                  >
                    <Glyph
                      name={kind.icon}
                      size={16}
                      color={active ? onSolid(kind.tone) : SOLID[kind.tone]}
                    />
                    <Text
                      style={[
                        styles.segmentLabel,
                        { color: active ? onSolid(kind.tone) : SOLID[kind.tone] },
                      ]}
                      numberOfLines={1}
                    >
                      {t(`requestStock.categoryShort_${category}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>
              {line.category === 'straw' ? t('requestStock.breed') : t('requestStock.item')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                // Held open after the choice, so the quantity can be set in the same visit
                // rather than by reopening the line that was just answered.
                setEditing(line.id);
                setPicking(line.id);
              }}
              style={({ pressed }) => [
                styles.dropdown,
                { borderColor: line.product ? SOLID[tone] : colors.border },
                pressed && styles.dropdownPressed,
              ]}
              testID={`indent-prod-${index}`}
            >
              <Ionicons
                name={line.product ? 'checkmark-circle' : 'search'}
                size={18}
                color={line.product ? SOLID[tone] : colors.textMuted}
              />
              <Text
                style={[styles.dropdownValue, !line.product && styles.dropdownPlaceholder]}
                numberOfLines={1}
              >
                {productLabel(line) ??
                  (line.category === 'straw'
                    ? t('requestStock.chooseBreed')
                    : t('requestStock.chooseItem'))}
              </Text>
              <Ionicons name="chevron-down" size={16} color={SOLID[tone]} />
            </Pressable>

            <Text style={styles.fieldLabel}>{t('requestStock.quantity')}</Text>
            <View style={styles.quantityRow}>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('requestStock.less')}
                  onPress={() =>
                    update(line.id, {
                      qty: String(Math.max(stepOf(line), (Number(line.qty) || 0) - stepOf(line))),
                    })
                  }
                  style={({ pressed }) => [
                    styles.step,
                    styles.stepDown,
                    pressed && styles.stepPressed,
                  ]}
                  testID={`indent-minus-${index}`}
                >
                  <Ionicons name="remove" size={18} color={colors.error} />
                </Pressable>

                <QuantityBox
                  value={line.qty}
                  unit={unitFor(line)}
                  label={t('requestStock.quantity')}
                  onChangeText={text =>
                    update(line.id, { qty: text.replace(/\D/g, '').slice(0, 4) })
                  }
                  testID={`indent-qty-${index}`}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('requestStock.more')}
                  onPress={() =>
                    update(line.id, { qty: String((Number(line.qty) || 0) + stepOf(line)) })
                  }
                  style={({ pressed }) => [
                    styles.step,
                    styles.stepUp,
                    pressed && styles.stepPressed,
                  ]}
                  testID={`indent-plus-${index}`}
                >
                  <Ionicons name="add" size={18} color={colors.surface} />
                </Pressable>
              </View>

              <View style={styles.stepHintPill}>
                <Ionicons name="information-circle" size={14} color={yolk[800]} />
                <Text style={styles.stepHint}>
                  {line.category === 'straw'
                    ? t('requestStock.strawStepHint')
                    : t('requestStock.oneAtATime')}
                </Text>
              </View>
            </View>
          </View>
        );
      })}

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const next = blankLine();
          // Adding a line settles the one before it: a Mait reaching for "another" has
          // finished thinking about the last one.
          setLines(current => [...current, next]);
          setEditing(next.id);
        }}
        style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}
        testID="indent-add-line"
      >
        <View style={[styles.chipSmall, styles.solid_good]}>
          <Ionicons name="add" size={16} color={colors.surface} />
        </View>
        <Text style={styles.addLabel}>{t('requestStock.addAnother')}</Text>
      </Pressable>

      {/* Only once there is something to send. Said over an empty list it is a rule about
          nothing; said over three finished lines it is what those lines actually mean. */}
      {lines.some(isComplete) && (
        <View style={styles.noticeGap}>
          <FlowNotice
            tone="info"
            body={t('requestStock.approvalNotIssue')}
            testID="indent-approval-note"
          />
        </View>
      )}

      {!!failed && <FlowNotice tone="error" title={failed} testID="indent-error" />}

      <FlowSpacer />

      {/* Checked before it is sent. The depot packs from this and nobody there can ask what
          was meant, so the last thing a Mait does is read it back. */}
      <Sheet
        visible={reviewing}
        title={t('requestStock.reviewTitle')}
        subtitle={t('requestStock.reviewSubtitle', { count: lines.length })}
        onClose={() => setReviewing(false)}
        testID="indent-review"
        footer={
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isLoading }}
            onPress={() => {
              setReviewing(false);
              submit();
            }}
            disabled={isLoading}
            style={({ pressed }) => [styles.confirm, pressed && styles.confirmPressed]}
            testID="indent-confirm"
          >
            <Text style={styles.confirmLabel}>{t('requestStock.confirmSend')}</Text>
            <Ionicons name="send" size={18} color={colors.surface} />
          </Pressable>
        }
      >
        {lines.map((line, index) => {
          const { tone, icon } = KIND[line.category];
          return (
            <View key={`review-${line.id}`} style={[styles.reviewRow, styles[`row_${tone}`]]}>
              <View style={[styles.chip, styles[`solid_${tone}`]]}>
                <Glyph name={icon} size={16} color={onSolid(tone)} />
              </View>
              <View style={styles.reviewBody}>
                <Text style={styles.reviewName}>
                  {productLabel(line) ?? t('requestStock.notChosen')}
                </Text>
                <Text style={styles.reviewMeta}>
                  {t(`requestStock.category_${line.category}`)} ·{' '}
                  {t('requestStock.lineN', { n: index + 1 })}
                </Text>
              </View>
              <View style={[styles.badge, styles[`solid_${tone}`]]}>
                <Text style={[styles.badgeLabel, { color: onSolid(tone) }]}>{line.qty}</Text>
              </View>
            </View>
          );
        })}

        <FlowNotice
          tone="accent"
          title={t('requestStock.reviewNoteTitle')}
          body={t('requestStock.reviewNoteBody')}
        />
      </Sheet>

      <BottomSheet
        visible={!!openLine}
        title={
          openLine?.category === 'straw'
            ? t('requestStock.chooseBreed')
            : t('requestStock.chooseItem')
        }
        subtitle={openLine ? t(`requestStock.categoryHint_${openLine.category}`) : undefined}
        sections={openLine ? productOptions(openLine.category) : []}
        selected={openLine?.product ?? null}
        onSelect={value => openLine && update(openLine.id, { product: value })}
        onClose={() => setPicking(null)}
        tone={openLine ? KIND[openLine.category].tone : undefined}
        icon={openLine ? KIND[openLine.category].icon : undefined}
        // Cow or Buffalo first, then the breed: a Mait knows which animal before which breed.
        tabbed={openLine?.category === 'straw'}
        testID="indent-product-sheet"
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  /* Tinted by kind: the wash of the line's colour, bordered in it. */
  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  chip: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chipSmall: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chipNumber: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  chipNumberLabel: { ...typography.caption, fontSize: 10, lineHeight: 12, color: colors.surface },
  cardTitleBox: { flex: 1 },
  cardTitle: { ...typography.bodyStrong, color: colors.ink },
  cardKind: { ...typography.caption, fontFamily: typography.label.fontFamily, marginTop: 1 },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  donePressed: { backgroundColor: colors.primaryPressed },
  doneLabel: { ...typography.label, color: colors.surface },
  remove: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorWash,
    borderWidth: 1,
    borderColor: colors.error,
  },

  // -- tones --------------------------------------------------------------------------------
  row_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  row_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  row_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  tab_info: { backgroundColor: colors.surface, borderColor: colors.info },
  tab_good: { backgroundColor: colors.surface, borderColor: colors.primary },
  tab_warm: { backgroundColor: colors.surface, borderColor: yolk[500] },
  solid_info: { backgroundColor: colors.info, borderColor: colors.info },
  solid_good: { backgroundColor: colors.primary, borderColor: colors.primary },
  solid_warm: { backgroundColor: yolk[500], borderColor: yolk[500] },
  pill_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  pill_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },

  // -- a folded line ---------------------------------------------------------------------
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + 12,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  rowPressed: { opacity: 0.85 },
  rowBody: { flex: 1 },
  rowName: { ...typography.bodyStrong, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowAmount: { alignItems: 'flex-end' },
  rowQty: { ...typography.h3, fontFamily: typography.h2.fontFamily },
  rowUnit: { ...typography.caption },
  edit: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  /* Three buttons, each in its kind's colour: outlined until chosen, filled once it is. The
     colour is the answer read at arm's length — blue is straws on every screen. */
  segments: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET - 6,
    paddingHorizontal: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  segmentLabel: { ...typography.label, flexShrink: 1 },

  fieldLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textMuted,
    marginBottom: spacing[1],
  },

  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  dropdownPressed: { backgroundColor: colors.background },
  dropdownValue: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  dropdownPlaceholder: { color: colors.textMuted },

  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET + 6,
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  step: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Red to take away, solid green to add. A Mait short of straws is here to ask for more,
     and the button they want should be the one that looks like an answer. */
  stepDown: { backgroundColor: colors.errorWash },
  stepUp: { backgroundColor: colors.primary },
  stepPressed: { opacity: 0.7 },
  quantityBody: { flex: 1, alignItems: 'center' },
  quantityInput: {
    ...typography.h2,
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: 0,
    minWidth: 60,
  },
  quantityUnit: { ...typography.caption, color: colors.textMuted },
  /* Yolk, because it is a constraint rather than a caption: a Mait who reads it as decoration
     types 23 and gets a number the depot cannot fill. */
  stepHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    maxWidth: 112,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: yolk[300],
    backgroundColor: colors.secondaryWash,
  },
  stepHint: { ...typography.caption, color: yolk[800], flexShrink: 1 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  addPressed: { opacity: 0.8 },
  addLabel: { ...typography.label, color: colors.primaryDark },

  noticeGap: { marginTop: spacing[4] },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  footerCountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    flexShrink: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  footerCount: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
    flexShrink: 1,
  },
  footerStatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    flexShrink: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  footerState: { ...typography.label, color: colors.primaryDark, flexShrink: 1 },
  footerStateWaiting: { color: yolk[800] },

  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  reviewBody: { flex: 1 },
  reviewName: { ...typography.bodyStrong, color: colors.ink },
  reviewMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  badge: {
    minWidth: 36,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    alignItems: 'center',
    borderWidth: 1,
  },
  badgeLabel: { ...typography.bodyStrong, fontFamily: typography.h2.fontFamily },

  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    marginTop: spacing[3],
    paddingHorizontal: spacing[5],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmPressed: { backgroundColor: colors.primaryPressed },
  confirmLabel: { ...typography.bodyStrong, color: colors.surface },

  // -- sent -------------------------------------------------------------------------------
  sentCard: {
    padding: spacing[4],
    marginBottom: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
    gap: spacing[2],
  },
  sentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  sentTitle: { ...typography.bodyStrong, color: colors.primaryDark, flex: 1 },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  sentName: { ...typography.body, color: colors.ink, flex: 1 },
  sentQty: { ...typography.label },
});
