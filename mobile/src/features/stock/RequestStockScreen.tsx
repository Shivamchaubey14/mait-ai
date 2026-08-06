/**
 * Request stock — M18 (SRS §6.6.1).
 *
 * One card per line: category, product, quantity. A Mait restocking is writing a list, and
 * each item is a small decision made in one place rather than three fields scattered down a
 * form.
 *
 * The API takes one product per indent, so each line is posted as its own request, each with
 * its own idempotency key — a double tap on a bad connection cannot make the depot pack
 * twice.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useCreateIndentMutation,
  useGetInventorySummaryQuery,
  useListBreedsQuery,
  useListProductsQuery,
} from '@api/endpoints';
import type { ProblemDetails } from '@api/types';
import BottomSheet, { Sheet, SheetSection } from '@/components/BottomSheet';
import { FlowNotice, FlowScreen, FlowSpacer } from '@/features/aiFlow/components';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Category = 'straw' | 'consumable' | 'asset';

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_STRAWS = 25;

/** Straws are issued by the box, so nudging by one produces a number nobody can fill. */
const STRAW_STEP = 5;

const CATEGORY_ICON: Record<Category, IoniconName> = {
  straw: 'thermometer-outline',
  consumable: 'medkit-outline',
  asset: 'construct-outline',
};

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

export default function RequestStockScreen({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const hindi = i18n.language.startsWith('hi');

  const breeds = useListBreedsQuery();
  const products = useListProductsQuery();
  const stock = useGetInventorySummaryQuery();
  const [createIndent, { isLoading }] = useCreateIndentMutation();

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [picking, setPicking] = useState<{ id: string; field: 'product' } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  const held = stock.data?.by_breed ?? {};
  const heldProducts = [...(stock.data?.consumables ?? []), ...(stock.data?.assets ?? [])];

  const update = (id: string, patch: Partial<Line>) =>
    setLines(current => current.map(line => (line.id === id ? { ...line, ...patch } : line)));

  const valid = (line: Line) => !!line.product && Number(line.qty) > 0;
  const canSubmit = lines.length > 0 && lines.every(valid);

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

  function unitFor(line: Line): string {
    if (line.category === 'straw') {
      return t('requestStock.straws');
    }
    const product = (products.data ?? []).find(row => row.code === line.product);
    return product?.unit ?? t('requestStock.units');
  }

  function productOptions(category: Category): SheetSection[] {
    if (category === 'straw') {
      return [
        {
          title: t('requestStock.breed'),
          options: (breeds.data ?? []).map(breed => ({
            value: breed.code,
            label: (hindi && breed.name_hi) || breed.name,
            meta: t(`aiFlow.animalType.${breed.animal_type}`),
            badge: t('requestStock.inHandShort', { count: held[breed.code] ?? 0 }),
          })),
        },
      ];
    }
    return [
      {
        title: category === 'consumable' ? t('stock.consumables') : t('stock.assets'),
        options: (products.data ?? [])
          .filter(product => product.category === category)
          .map(product => ({
            value: product.code,
            label: product.name,
            meta: product.unit,
            badge: t('requestStock.inHandShort', {
              count: heldProducts.find(row => row.code === product.code)?.qty ?? 0,
            }),
          })),
      },
    ];
  }

  const submit = async () => {
    setFailed(null);
    let posted = 0;
    try {
      for (const line of lines) {
        await createIndent({
          client_uuid: line.id,
          product_type: line.category === 'straw' ? 'straw' : 'consumable',
          breed: line.category === 'straw' ? (line.product ?? '') : '',
          qty_requested: Number(line.qty),
          note: line.category === 'straw' ? '' : (line.product ?? ''),
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
      >
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

  const openLine = lines.find(line => line.id === picking?.id) ?? null;
  const totalStraws = lines
    .filter(line => line.category === 'straw')
    .reduce((sum, line) => sum + (Number(line.qty) || 0), 0);

  return (
    <FlowScreen
      step={null}
      stepLabel={t('requestStock.label')}
      title={t('requestStock.title')}
      subtitle={t('requestStock.subtitle')}
      onBack={onBack}
      stickyHero
      footerNote={
        <View style={styles.footerNote}>
          <Text style={styles.footerCount}>
            {t('requestStock.footerCount', { lines: lines.length, straws: totalStraws })}
          </Text>
          <Text style={[styles.footerState, !canSubmit && styles.footerStateWaiting]}>
            {canSubmit ? t('requestStock.readyToSend') : t('requestStock.finishTheLines')}
          </Text>
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
      {lines.map((line, index) => (
        <View key={line.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.number}>
              <Text style={styles.numberLabel}>{index + 1}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {t(`requestStock.categoryShort_${line.category}`)}
              {productLabel(line) ? ` · ${productLabel(line)}` : ''}
            </Text>
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
                  style={[styles.segment, active && styles.segmentActive]}
                  testID={`indent-cat-${category}-${index}`}
                >
                  <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
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
            onPress={() => setPicking({ id: line.id, field: 'product' })}
            style={({ pressed }) => [styles.dropdown, pressed && styles.dropdownPressed]}
            testID={`indent-prod-${index}`}
          >
            <Text
              style={[styles.dropdownValue, !line.product && styles.dropdownPlaceholder]}
              numberOfLines={1}
            >
              {productLabel(line) ?? t('requestStock.choose')}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
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
                style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                testID={`indent-minus-${index}`}
              >
                <Ionicons name="remove" size={18} color={colors.ink} />
              </Pressable>

              <View style={styles.quantityBody}>
                <TextInput
                  style={styles.quantityInput}
                  value={line.qty}
                  onChangeText={text =>
                    update(line.id, { qty: text.replace(/\D/g, '').slice(0, 4) })
                  }
                  keyboardType="number-pad"
                  accessibilityLabel={t('requestStock.quantity')}
                  testID={`indent-qty-${index}`}
                />
                <Text style={styles.quantityUnit}>{unitFor(line)}</Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('requestStock.more')}
                onPress={() =>
                  update(line.id, { qty: String((Number(line.qty) || 0) + stepOf(line)) })
                }
                style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                testID={`indent-plus-${index}`}
              >
                <Ionicons name="add" size={18} color={colors.primaryDark} />
              </Pressable>
            </View>

            <Text style={styles.stepHint}>
              {line.category === 'straw'
                ? t('requestStock.inStepsOf', { count: STRAW_STEP })
                : t('requestStock.oneAtATime')}
            </Text>
          </View>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => setLines(current => [...current, blankLine()])}
        style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}
        testID="indent-add-line"
      >
        <Ionicons name="add" size={18} color={colors.primaryDark} />
        <Text style={styles.addLabel}>{t('requestStock.addAnother')}</Text>
      </Pressable>

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
            <Ionicons name="arrow-forward" size={18} color={colors.surface} />
          </Pressable>
        }
      >
        {lines.map((line, index) => (
          <View key={`review-${line.id}`} style={styles.reviewRow}>
            <View style={styles.reviewSwatch}>
              <Ionicons name={CATEGORY_ICON[line.category]} size={16} color={colors.primaryDark} />
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
            <Text style={styles.reviewQty}>{line.qty}</Text>
          </View>
        ))}

        <FlowNotice
          tone="info"
          title={t('requestStock.reviewNoteTitle')}
          body={t('requestStock.reviewNoteBody')}
        />
      </Sheet>

      <BottomSheet
        visible={!!openLine}
        title={t('requestStock.chooseProduct')}
        subtitle={openLine ? t(`requestStock.categoryHint_${openLine.category}`) : undefined}
        sections={openLine ? productOptions(openLine.category) : []}
        selected={openLine?.product ?? null}
        onSelect={value => openLine && update(openLine.id, { product: value })}
        onClose={() => setPicking(null)}
        testID="indent-product-sheet"
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  number: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  numberLabel: { ...typography.caption, color: colors.textMuted },
  cardTitle: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  remove: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorWash,
  },

  segments: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET - 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentActive: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  segmentLabel: { ...typography.label, color: colors.textMuted },
  segmentLabelActive: { color: colors.primaryDark },

  fieldLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing[1] },

  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
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
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  step: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  stepPressed: { backgroundColor: colors.primaryWash },
  quantityBody: { flex: 1, alignItems: 'center' },
  quantityInput: {
    ...typography.h2,
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: 0,
    minWidth: 60,
  },
  quantityUnit: { ...typography.caption, color: colors.textMuted },
  stepHint: { ...typography.caption, color: colors.textMuted, maxWidth: 96 },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  addPressed: { backgroundColor: colors.surface },
  addLabel: { ...typography.label, color: colors.primaryDark },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  footerCount: { ...typography.caption, color: colors.textMuted },
  footerState: { ...typography.bodyStrong, color: colors.primaryDark },
  footerStateWaiting: { color: colors.textMuted },

  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewSwatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryWash,
  },
  reviewBody: { flex: 1 },
  reviewName: { ...typography.bodyStrong, color: colors.ink },
  reviewMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  reviewQty: { ...typography.h3, fontFamily: typography.h2.fontFamily, color: colors.ink },

  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    marginTop: spacing[3],
    paddingHorizontal: spacing[5],
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  confirmPressed: { backgroundColor: colors.primaryPressed },
  confirmLabel: { ...typography.bodyStrong, color: colors.surface },
});
