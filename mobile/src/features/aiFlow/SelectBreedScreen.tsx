/**
 * Step 5 of the AI capture flow — which breed of straw (SRS §6.3 step 4, C7).
 *
 * Asked before the straw number rather than after it. A Mait carrying unnumbered stock in two
 * breeds cannot be identified by the number alone — the server answers `breed-required` and
 * the old flow only found that out after the Mait had typed the number and been refused.
 * Asking first turns a rejection into a question.
 *
 * Every configured breed for this species is listed, including the ones the flask is empty of.
 * They are shown blocked with the reason on the row, never hidden: a Mait who cannot find
 * Sahiwal in the list concludes the app is broken, where a greyed row with "None in your
 * stock" tells them to raise an indent.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGetInventorySummaryQuery, useListBreedsQuery } from '@api/endpoints';
import type { AnimalTypeCode, BreedConfig } from '@api/types';
import { LOW_STRAWS_PER_BREED } from '@/config/env';

import { FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

interface Props {
  /** The species of the animal chosen at the previous step — a cow is not served buffalo semen. */
  animalType: AnimalTypeCode;
  onSelect: (breed: BreedConfig) => void;
  onBack: () => void;
}

export default function SelectBreedScreen({
  animalType,
  onSelect,
  onBack,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState<string | null>(null);

  const { data: breeds = [], isLoading: breedsLoading } = useListBreedsQuery(animalType);
  const {
    data: stock,
    isLoading: stockLoading,
    isFetching,
    refetch,
  } = useGetInventorySummaryQuery();

  const hindi = i18n.language.startsWith('hi');
  const label = (breed: BreedConfig) => (hindi && breed.name_hi) || breed.name;

  /**
   * What the Mait is actually carrying, most first.
   *
   * The configured order is the administrator's, and it is the right one for a catalogue. In a
   * flask it is not: the breed there are eighteen of is the likely answer and the breed there
   * are none of is the last thing worth reading.
   */
  const rows = useMemo(() => {
    const counted = breeds.map(breed => ({
      breed,
      straws: stock?.by_breed?.[breed.code] ?? 0,
    }));
    return counted.sort((a, b) => b.straws - a.straws);
  }, [breeds, stock]);

  const carrying = rows.some(row => row.straws > 0);
  const chosen = rows.find(row => row.breed.code === code && row.straws > 0);
  const loading = breedsLoading || stockLoading;

  return (
    <FlowScreen
      step={4}
      title={t('aiFlow.whichBreed')}
      subtitle={t('aiFlow.whichBreedSubtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !loading, onRefresh: refetch }}
      cta={{
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen.breed),
        disabled: !chosen,
        testID: 'breed-continue',
      }}
    >
      {loading && <FlowNotice tone="info" title={t('common.loading')} />}

      {!loading && breeds.length === 0 && (
        <FlowNotice
          tone="info"
          title={t('aiFlow.noBreeds')}
          body={t('aiFlow.noBreedsBody')}
          testID="breed-none-configured"
        />
      )}

      {/* An empty flask is not a wrong tap to correct on this screen. It is a round that
          cannot go ahead, and the only useful thing to say is what to do about it. */}
      {!loading && breeds.length > 0 && !carrying && (
        <FlowNotice
          tone="error"
          title={t('aiFlow.noStrawsAtAll')}
          body={t('aiFlow.raiseIndentSoon')}
          testID="breed-no-stock"
        />
      )}

      {rows.map(({ breed, straws }) => (
        <OptionCard
          key={breed.code}
          swatch={false}
          title={label(breed)}
          subtitle={t('aiFlow.strawsWithYou', { count: straws })}
          blockedReason={straws === 0 ? t('aiFlow.noneInStock') : undefined}
          pill={
            straws === 0
              ? t('aiFlow.blocked')
              : straws <= LOW_STRAWS_PER_BREED
                ? t('aiFlow.low')
                : undefined
          }
          pillTone="accent"
          check
          selected={code === breed.code}
          onPress={() => setCode(breed.code)}
          testID={`breed-${breed.code}`}
        />
      ))}

      <FlowSpacer />
    </FlowScreen>
  );
}
