/**
 * Request stock — M18 (SRS §6.6.1).
 *
 * Category, then product, then quantity. The product list is behind a bottom sheet rather
 * than inline: three categories of a dozen items would bury the quantity field, and a Mait
 * filling this in one-handed should not have to scroll past everything they did not want.
 *
 * A request carries several lines, because that is how restocking is thought about: one trip,
 * one list. The API takes one product per indent, so each line is posted as its own request —
 * each with its own idempotency key, so a double tap on a bad connection does not make the
 * depot pack twice.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import {
  FieldCard,
  FlowLabel,
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  OptionCard,
} from '@/features/aiFlow/components';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_STRAWS = 25;

const CATEGORY_ICON: Record<'straw' | 'consumable' | 'asset', IoniconName> = {
  straw: 'thermometer-outline',
  consumable: 'medkit-outline',
  asset: 'construct-outline',
};

type Category = 'straw' | 'consumable' | 'asset';

interface Line {
  id: string;
  category: Category;
  /** Breed code for straws, product code otherwise. */
  product: string | null;
  qty: string;
}

function blankLine(category: Category = 'straw'): Line {
  return {
    id: newClientUuid(),
    category,
    product: null,
    qty: category === 'straw' ? String(USUAL_STRAWS) : '1',
  };
}

export interface RequestFormState {
  canSubmit: boolean;
  busy: boolean;
  submit: () => void;
}

export default function RequestStockScreen({
  onDone,
  onBack,
  onFormState,
}: {
  onDone: () => void;
  onBack: () => void;
  /** Lets the bar's action button drive this form — one action, always in one place. */
  onFormState: (state: RequestFormState) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const hindi = i18n.language.startsWith('hi');

  const breeds = useListBreedsQuery();
  const products = useListProductsQuery();
  const stock = useGetInventorySummaryQuery();
  const [createIndent, { isLoading }] = useCreateIndentMutation();

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [picking, setPicking] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  const held = stock.data?.by_breed ?? {};
  const heldProducts = [...(stock.data?.consumables ?? []), ...(stock.data?.assets ?? [])];

  const update = (id: string, patch: Partial<Line>) =>
    setLines(current => current.map(line => (line.id === id ? { ...line, ...patch } : line)));

  const valid = (line: Line) => !!line.product && Number(line.qty) > 0;
  const canSubmit = lines.length > 0 && lines.every(valid);

  /** What the sheet offers for a line, given its category. */
  function optionsFor(category: Category): SheetSection[] {
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

    const inCategory = (products.data ?? []).filter(product => product.category === category);
    return [
      {
        title: category === 'consumable' ? t('stock.consumables') : t('stock.assets'),
        options: inCategory.map(product => ({
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

  function labelFor(line: Line): string | null {
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

  useEffect(() => {
    onFormState({ canSubmit, busy: isLoading, submit: () => setReviewing(true) });
    // `submit` closes over the current lines, so it is refreshed whenever they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, isLoading, lines]);

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

  const openLine = lines.find(line => line.id === picking) ?? null;

  return (
    <FlowScreen
      step={null}
      stepLabel={t('requestStock.label')}
      title={t('requestStock.title')}
      subtitle={t('requestStock.subtitle')}
      onBack={onBack}
      stickyHero
    >
      {/* What is on the request so far. A Mait adding a third line cannot see the first two
          without scrolling back, and a request they cannot read is one they resend. */}
      {lines.length > 1 && (
        <View style={styles.summary}>
          <Text style={styles.summaryHead}>{t('requestStock.onThisRequest')}</Text>
          {lines.map((line, index) => (
            <View key={`row-${line.id}`} style={styles.summaryRow}>
              <Text style={styles.summaryIndex}>{index + 1}</Text>
              <Text style={styles.summaryName} numberOfLines={1}>
                {labelFor(line) ?? t('requestStock.notChosen')}
              </Text>
              <Text style={styles.summaryQty}>{valid(line) ? line.qty : '—'}</Text>
            </View>
          ))}
        </View>
      )}

      {lines.map((line, index) => (
        <View key={line.id} style={index > 0 ? styles.extraLine : undefined}>
          <View style={styles.lineHead}>
            <Text style={styles.lineLabel}>{t('requestStock.lineN', { n: index + 1 })}</Text>
            {lines.length > 1 && (
              <Text
                style={styles.remove}
                onPress={() => setLines(current => current.filter(l => l.id !== line.id))}
                testID={`indent-remove-${index}`}
              >
                {t('requestStock.remove')}
              </Text>
            )}
          </View>

          <FlowLabel>{t('requestStock.category')}</FlowLabel>
          {(['straw', 'consumable', 'asset'] as Category[]).map(category => (
            <OptionCard
              key={category}
              title={t(`requestStock.category_${category}`)}
              subtitle={t(`requestStock.categoryHint_${category}`)}
              icon={CATEGORY_ICON[category]}
              tone={
                category === 'straw' ? 'primary' : category === 'consumable' ? 'info' : 'accent'
              }
              radio
              selected={line.category === category}
              onPress={() =>
                update(line.id, {
                  category,
                  // The product list changes with the category, so the old choice is void.
                  product: null,
                  qty: category === 'straw' ? String(USUAL_STRAWS) : '1',
                })
              }
              testID={`indent-cat-${category}-${index}`}
            />
          ))}

          <FlowLabel>{t('requestStock.product')}</FlowLabel>
          <View
            style={styles.picker}
            onTouchEnd={() => setPicking(line.id)}
            testID={`indent-pick-${index}`}
          >
            <View style={[styles.pickerSwatch, !line.product && styles.pickerSwatchEmpty]}>
              <Ionicons
                name={CATEGORY_ICON[line.category]}
                size={16}
                color={line.product ? colors.primaryDark : colors.textMuted}
              />
            </View>
            <View style={styles.pickerBody}>
              <Text style={styles.pickerLabel}>{labelFor(line) ?? t('requestStock.choose')}</Text>
              <Text style={styles.pickerHint}>
                {labelFor(line) ? t('requestStock.tapToChange') : t('requestStock.tapToChoose')}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </View>

          <FlowLabel>{t('requestStock.quantity')}</FlowLabel>
          <FieldCard
            label={line.category === 'straw' ? t('requestStock.straws') : t('requestStock.units')}
            hint={
              line.category === 'straw'
                ? t('requestStock.qtyHintStraw', { count: USUAL_STRAWS })
                : t('requestStock.qtyHintUnit')
            }
            placeholder={line.category === 'straw' ? String(USUAL_STRAWS) : '1'}
            value={line.qty}
            onChangeText={text => update(line.id, { qty: text.replace(/\D/g, '').slice(0, 4) })}
            keyboardType="number-pad"
            testID={`indent-qty-${index}`}
          />
        </View>
      ))}

      <FlowLabel style={styles.addLabel}>{t('requestStock.addAnother')}</FlowLabel>
      <OptionCard
        title={t('requestStock.addLine')}
        subtitle={t('requestStock.addLineHint')}
        tone="neutral"
        onPress={() => setLines(current => [...current, blankLine()])}
        testID="indent-add-line"
      />

      {!!failed && <FlowNotice tone="error" title={failed} testID="indent-error" />}

      <FlowSpacer />

      {/* Checked before it is sent. An indent is packed by someone in a depot who cannot ask
          what was meant, so the last thing a Mait does is read it back. */}
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
              <Text style={styles.reviewName}>{labelFor(line) ?? t('requestStock.notChosen')}</Text>
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
        sections={openLine ? optionsFor(openLine.category) : []}
        selected={openLine?.product ?? null}
        onSelect={value => openLine && update(openLine.id, { product: value })}
        onClose={() => setPicking(null)}
        testID="indent-sheet"
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  extraLine: {
    marginTop: spacing[4],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lineHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  lineLabel: { ...typography.label, color: colors.ink },
  remove: { ...typography.label, color: colors.error },

  // Looks like a field, behaves like a button — the list it opens is too long to inline.
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerSwatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryWash,
  },
  // Muted until something is chosen, so an unfilled line is visible at a glance.
  pickerSwatchEmpty: { backgroundColor: colors.background },
  pickerBody: { flex: 1 },
  pickerLabel: { ...typography.bodyStrong, color: colors.ink },
  pickerHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  addLabel: { marginTop: spacing[4] },

  summary: {
    padding: spacing[3],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryHead: { ...typography.label, color: colors.textMuted, marginBottom: spacing[2] },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryIndex: { ...typography.caption, color: colors.textMuted, width: 14 },
  summaryName: { ...typography.bodyStrong, color: colors.ink, flex: 1 },
  summaryQty: { ...typography.bodyStrong, color: colors.primaryDark },

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
