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
import { StyleSheet, Text, View } from 'react-native';
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
import BottomSheet, { SheetSection } from '@/components/BottomSheet';
import {
  FieldCard,
  FlowLabel,
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  OptionCard,
} from '@/features/aiFlow/components';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_STRAWS = 25;

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
    onFormState({ canSubmit, busy: isLoading, submit });
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
    >
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
  pickerBody: { flex: 1 },
  pickerLabel: { ...typography.bodyStrong, color: colors.ink },
  pickerHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  addLabel: { marginTop: spacing[4] },
});
