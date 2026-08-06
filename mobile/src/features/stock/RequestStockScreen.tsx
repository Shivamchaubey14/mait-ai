/**
 * Request stock — M18 (SRS §6.6.1).
 *
 * A Mait asks for straws by breed and quantity. Which physical straws get issued is decided
 * at the depot, so there is nothing here to scan or pick.
 *
 * A request can carry several lines — straws of one breed, gloves, sheaths — because that is
 * how a Mait thinks about restocking: one trip, one list. The API takes one product per
 * indent, so each line is posted as its own request; the depot sees them together because
 * they arrive at the same moment from the same Mait.
 *
 * Every line carries its own uuid as an idempotency key, so a Mait tapping twice on a bad
 * connection raises one request per line rather than doubling the order.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useCreateIndentMutation,
  useGetInventorySummaryQuery,
  useListAiEventsQuery,
  useListBreedsQuery,
} from '@api/endpoints';
import type { ProblemDetails } from '@api/types';
import {
  FieldCard,
  FlowLabel,
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  OptionCard,
} from '@/features/aiFlow/components';
import { colors, spacing, typography } from '@theme/tokens';

/** What a full round usually needs. A Mait can change it; most will not have to. */
const USUAL_QTY = 25;

interface Line {
  id: string;
  product: 'straw' | 'consumable';
  breed: string | null;
  qty: string;
}

function blankLine(): Line {
  return { id: newClientUuid(), product: 'straw', breed: null, qty: String(USUAL_QTY) };
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
  /** Lets the bar's action button drive this form (SRS §10.3 — one action per screen). */
  onFormState: (state: RequestFormState) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const hindi = i18n.language.startsWith('hi');

  const breeds = useListBreedsQuery();
  const stock = useGetInventorySummaryQuery();
  const events = useListAiEventsQuery();
  const [createIndent, { isLoading }] = useCreateIndentMutation();

  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState(0);

  const held = stock.data?.by_breed ?? {};

  const usedLastMonth = (events.data?.results ?? []).filter(event => {
    const when = new Date(event.completed_at ?? event.created_at);
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return (
      event.status === 'completed' &&
      when.getMonth() === lastMonth.getMonth() &&
      when.getFullYear() === lastMonth.getFullYear()
    );
  }).length;

  const valid = (line: Line) =>
    (line.product === 'consumable' || !!line.breed) && Number(line.qty) > 0;
  const canSubmit = lines.length > 0 && lines.every(valid);

  const update = (id: string, patch: Partial<Line>) =>
    setLines(current => current.map(line => (line.id === id ? { ...line, ...patch } : line)));

  const submit = async () => {
    setFailed(null);
    let posted = 0;
    try {
      for (const line of lines) {
        await createIndent({
          client_uuid: line.id,
          product_type: line.product,
          breed: line.breed ?? '',
          qty_requested: Number(line.qty),
        }).unwrap();
        posted += 1;
      }
      setSent(posted);
    } catch (err) {
      const problem = (err as { data?: ProblemDetails })?.data;
      // Says how many landed: a partial failure must not read as though nothing was sent,
      // or the Mait resends the whole list and the depot packs twice.
      setFailed(
        posted > 0
          ? t('requestStock.partial', { sent: posted, total: lines.length })
          : (problem?.detail ?? t('errors.generic')),
      );
    }
  };

  // Reported upward rather than rendered here: the one action on this screen lives on the
  // bar, where every other screen's action lives.
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
          {index > 0 && (
            <View style={styles.lineHead}>
              <Text style={styles.lineLabel}>{t('requestStock.lineN', { n: index + 1 })}</Text>
              <Text
                style={styles.remove}
                onPress={() => setLines(current => current.filter(l => l.id !== line.id))}
                testID={`indent-remove-${index}`}
              >
                {t('requestStock.remove')}
              </Text>
            </View>
          )}

          <FlowLabel>{t('requestStock.product')}</FlowLabel>
          <OptionCard
            title={t('requestStock.semenStraw')}
            subtitle={t('requestStock.semenStrawHint')}
            radio
            selected={line.product === 'straw'}
            onPress={() => update(line.id, { product: 'straw' })}
            testID={`indent-product-straw-${index}`}
          />
          <OptionCard
            title={t('requestStock.consumable')}
            subtitle={t('requestStock.consumableHint')}
            tone="info"
            radio
            selected={line.product === 'consumable'}
            onPress={() => update(line.id, { product: 'consumable', breed: null })}
            testID={`indent-product-consumable-${index}`}
          />

          {line.product === 'straw' && (
            <View>
              <FlowLabel>{t('requestStock.breed')}</FlowLabel>
              {(breeds.data ?? []).map(option => (
                <OptionCard
                  key={option.code}
                  title={(hindi && option.name_hi) || option.name}
                  // The count already held, so the ask is made against a number rather than
                  // from memory.
                  subtitle={t('requestStock.inHand', { count: held[option.code] ?? 0 })}
                  radio
                  selected={line.breed === option.code}
                  onPress={() => update(line.id, { breed: option.code })}
                  testID={`indent-breed-${option.code}-${index}`}
                />
              ))}
            </View>
          )}

          <FlowLabel>{t('requestStock.quantity')}</FlowLabel>
          <FieldCard
            label={line.product === 'straw' ? t('requestStock.straws') : t('requestStock.units')}
            value={line.qty}
            onChangeText={text => update(line.id, { qty: text.replace(/\D/g, '').slice(0, 4) })}
            keyboardType="number-pad"
            testID={`indent-qty-${index}`}
          />
        </View>
      ))}

      {/* Grounds the number in what actually happened rather than leaving it to memory. */}
      <FlowNotice
        tone="accent"
        title={t('requestStock.usualTitle', { count: USUAL_QTY })}
        body={t('requestStock.usualBody', { count: usedLastMonth })}
        testID="indent-usual"
      />

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
  addLabel: { marginTop: spacing[4] },
});
