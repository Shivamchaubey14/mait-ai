/**
 * Request stock (SRS §6.6.1).
 *
 * A Mait asks for straws by breed and quantity. Which physical straws get issued is decided
 * at the depot, so there is nothing here to scan or pick — that is the whole reason this is a
 * two-field screen rather than a flow.
 *
 * Sent with the request's own uuid as an idempotency key, so a Mait who taps twice on a bad
 * connection raises one indent rather than two, and the depot does not pack double.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import {
  useCreateIndentMutation,
  useGetInventorySummaryQuery,
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

/** What a round typically needs. A Mait can change it; most will not have to. */
const DEFAULT_QTY = '25';

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
  const stock = useGetInventorySummaryQuery();
  const [createIndent, { isLoading }] = useCreateIndentMutation();

  const [breed, setBreed] = useState<string | null>(null);
  const [qty, setQty] = useState(DEFAULT_QTY);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const quantity = Number(qty.replace(/\D/g, '')) || 0;
  const held = stock.data?.by_breed ?? {};

  const submit = async () => {
    setFailed(null);
    try {
      await createIndent({
        client_uuid: newClientUuid(),
        product_type: 'straw',
        breed: breed as string,
        qty_requested: quantity,
        note: note.trim(),
      }).unwrap();
      setSent(true);
    } catch (err) {
      const problem = (err as { data?: ProblemDetails })?.data;
      setFailed(problem?.detail ?? t('errors.generic'));
    }
  };

  if (sent) {
    return (
      <FlowScreen
        step={null}
        stepLabel={t('requestStock.sentLabel')}
        title={t('requestStock.sentTitle')}
        subtitle={t('requestStock.sentSubtitle')}
        onBack={onDone}
        cta={{ label: t('requestStock.backToStock'), onPress: onDone, testID: 'indent-done' }}
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
      cta={{
        label: t('requestStock.send'),
        onPress: submit,
        disabled: !breed || quantity < 1,
        busy: isLoading,
        testID: 'indent-send',
      }}
    >
      <FlowLabel>{t('requestStock.whichBreed')}</FlowLabel>

      {breeds.isLoading ? (
        <FlowNotice tone="info" title={t('common.loading')} />
      ) : (
        (breeds.data ?? []).map(option => (
          <OptionCard
            key={option.code}
            title={(hindi && option.name_hi) || option.name}
            // The count they already hold, so the ask is made against a number rather than
            // from memory.
            subtitle={t('requestStock.inHand', { count: held[option.code] ?? 0 })}
            radio
            selected={breed === option.code}
            onPress={() => setBreed(option.code)}
            testID={`indent-breed-${option.code}`}
          />
        ))
      )}

      <FieldCard
        label={t('requestStock.howMany')}
        hint={t('requestStock.howManyHint')}
        value={qty}
        onChangeText={text => setQty(text.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        testID="indent-qty"
      />

      <FieldCard
        label={t('requestStock.note')}
        hint={t('requestStock.noteHint')}
        tone="accent"
        value={note}
        onChangeText={setNote}
        testID="indent-note"
      />

      {!!failed && <FlowNotice tone="error" title={failed} testID="indent-error" />}

      <View>
        <FlowSpacer />
      </View>
    </FlowScreen>
  );
}
