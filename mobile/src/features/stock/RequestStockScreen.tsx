/**
 * Request stock — M18 (SRS §6.6.1).
 *
 * One line is one row: category, product, quantity, side by side. A Mait restocking is
 * writing a list, and a list reads across — three stacked sections per item turned a
 * four-item request into four screens of scrolling.
 *
 * Category and product open a sheet rather than expanding inline, so adding a fourth line
 * never pushes the first three off the screen.
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
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Category = 'straw' | 'consumable' | 'asset';

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_STRAWS = 25;

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
  /** Which cell is open: the line, and which of its two dropdowns. */
  const [picking, setPicking] = useState<{ id: string; field: 'category' | 'product' } | null>(
    null,
  );
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

  const categoryOptions: SheetSection[] = [
    {
      title: t('requestStock.category'),
      options: (['straw', 'consumable', 'asset'] as Category[]).map(category => ({
        value: category,
        label: t(`requestStock.category_${category}`),
        meta: t(`requestStock.categoryHint_${category}`),
      })),
    },
  ];

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

  return (
    <FlowScreen
      step={null}
      stepLabel={t('requestStock.label')}
      title={t('requestStock.title')}
      subtitle={t('requestStock.subtitle')}
      onBack={onBack}
      stickyHero
    >
      {/* Column headings once, not per row: three labels repeated down the screen is three
          times the reading for the same information. */}
      <View style={styles.headings}>
        <Text style={[styles.heading, styles.colCategory]}>{t('requestStock.category')}</Text>
        <Text style={[styles.heading, styles.colProduct]}>{t('requestStock.product')}</Text>
        <Text style={[styles.heading, styles.colQty]}>{t('requestStock.qty')}</Text>
      </View>

      {lines.map((line, index) => (
        <View key={line.id} style={styles.lineWrap}>
          <View style={styles.line}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('requestStock.category')}
              onPress={() => setPicking({ id: line.id, field: 'category' })}
              style={({ pressed }) => [
                styles.cell,
                styles.colCategory,
                pressed && styles.cellPressed,
              ]}
              testID={`indent-cat-${index}`}
            >
              <Ionicons name={CATEGORY_ICON[line.category]} size={14} color={colors.primaryDark} />
              <Text style={styles.cellValue} numberOfLines={1}>
                {t(`requestStock.categoryShort_${line.category}`)}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('requestStock.product')}
              onPress={() => setPicking({ id: line.id, field: 'product' })}
              style={({ pressed }) => [
                styles.cell,
                styles.colProduct,
                pressed && styles.cellPressed,
              ]}
              testID={`indent-prod-${index}`}
            >
              <Text
                style={[styles.cellValue, !line.product && styles.cellPlaceholder]}
                numberOfLines={1}
              >
                {productLabel(line) ?? t('requestStock.choose')}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </Pressable>

            <View style={[styles.cell, styles.colQty]}>
              <TextInput
                style={styles.qtyInput}
                value={line.qty}
                onChangeText={text => update(line.id, { qty: text.replace(/\D/g, '').slice(0, 4) })}
                placeholder={line.category === 'straw' ? String(USUAL_STRAWS) : '1'}
                placeholderTextColor={colors.textDisabled}
                keyboardType="number-pad"
                accessibilityLabel={t('requestStock.qty')}
                testID={`indent-qty-${index}`}
              />
            </View>
          </View>

          {lines.length > 1 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setLines(current => current.filter(l => l.id !== line.id))}
              style={styles.remove}
              testID={`indent-remove-${index}`}
            >
              <Ionicons name="close-circle" size={16} color={colors.error} />
              <Text style={styles.removeLabel}>
                {t('requestStock.removeLine', { n: index + 1 })}
              </Text>
            </Pressable>
          )}
        </View>
      ))}

      {/* Side by side: adding a line and finishing the list are the only two things left to
          do here, and neither is worth a full-width button of its own. */}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setLines(current => [...current, blankLine()])}
          style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}
          testID="indent-add-line"
        >
          <Ionicons name="add" size={18} color={colors.primaryDark} />
          <Text style={styles.addLabel}>{t('requestStock.addAnother')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: isLoading }}
          onPress={() => setReviewing(true)}
          disabled={!canSubmit || isLoading}
          style={({ pressed }) => [
            styles.submitButton,
            (!canSubmit || isLoading) && styles.submitDisabled,
            pressed && canSubmit && styles.submitPressed,
          ]}
          testID="indent-submit"
        >
          <Text style={[styles.submitLabel, !canSubmit && styles.submitLabelDisabled]}>
            {t('requestStock.submit')}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={16}
            color={canSubmit ? colors.surface : colors.textDisabled}
          />
        </Pressable>
      </View>

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
        visible={!!openLine && picking?.field === 'category'}
        title={t('requestStock.chooseCategory')}
        sections={categoryOptions}
        selected={openLine?.category ?? null}
        onSelect={value =>
          openLine &&
          update(openLine.id, {
            category: value as Category,
            // The product list changes with the category, so the old choice is void.
            product: null,
            qty: value === 'straw' ? String(USUAL_STRAWS) : '1',
          })
        }
        onClose={() => setPicking(null)}
        testID="indent-category-sheet"
      />

      <BottomSheet
        visible={!!openLine && picking?.field === 'product'}
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
  headings: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[2] },
  heading: { ...typography.caption, color: colors.textMuted },

  // The three columns, sized by how much each has to say.
  colCategory: { flex: 1.05 },
  colProduct: { flex: 1.35 },
  colQty: { width: 62 },

  lineWrap: { marginBottom: spacing[3] },
  line: { flexDirection: 'row', gap: spacing[2] },

  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellPressed: { backgroundColor: colors.background },
  cellValue: { ...typography.label, color: colors.ink, flex: 1 },
  cellPlaceholder: { color: colors.textMuted },

  qtyInput: {
    ...typography.bodyStrong,
    color: colors.ink,
    flex: 1,
    textAlign: 'center',
    paddingVertical: 0,
  },

  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH_TARGET - 16,
    marginTop: spacing[1],
  },
  removeLabel: { ...typography.caption, color: colors.error },

  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[3] },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  addPressed: { backgroundColor: colors.surface },
  addLabel: { ...typography.label, color: colors.primaryDark },

  submitButton: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  submitPressed: { backgroundColor: colors.primaryPressed },
  submitDisabled: { backgroundColor: colors.disabledFill },
  submitLabel: { ...typography.label, color: colors.surface },
  submitLabelDisabled: { color: colors.textDisabled },

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
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmPressed: { backgroundColor: colors.primaryPressed },
  confirmLabel: { ...typography.bodyStrong, color: colors.surface },
});
