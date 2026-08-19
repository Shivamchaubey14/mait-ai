/**
 * Step 5 of the AI capture flow — which breed of straw (SRS §6.3 step 4, C7).
 *
 * **The straw is named by breed and by nothing else.** The flow used to ask for the number
 * printed on it, and that number can only be read by lifting the goblet clear of the liquid
 * nitrogen — which warms every straw in it, cumulatively and invisibly. The app was asking a
 * Mait to damage the semen in order to record it. So identity gives way to quantity: the
 * Mait says which breed, the platform holds one of that breed from their stock, and ten
 * straws still complete exactly ten inseminations.
 *
 * This is therefore the step that commits. The event is created here, which is why the tab
 * bar disappears after it and not before: from here on there is a record on the server that
 * walking away would strand.
 *
 * Every configured breed for this species is listed, including the ones the flask is empty of.
 * They are shown blocked with the reason on the row, never hidden: a Mait who cannot find
 * Sahiwal in the list concludes the app is broken, where a greyed row with "None in your
 * stock" tells them to raise an indent.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useCreateAiEventMutation,
  useGetInventorySummaryQuery,
  useListBreedsQuery,
} from '@api/endpoints';
import type { AIEvent, AnimalTypeCode, BreedConfig } from '@api/types';
import { LOW_STRAWS_PER_BREED } from '@/config/env';

import { FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

interface Props {
  /** The species of the animal chosen at the previous step — a cow is not served buffalo semen. */
  animalType: AnimalTypeCode;
  /**
   * The breed of the animal chosen at step 4, if her record carries one.
   *
   * Pre-selected here when the Mait is holding straws of it. Like breeds to like is the
   * ordinary case — a Sahiwal is served Sahiwal — so the step arrives already answered and a
   * Mait who agrees taps Continue once. It is a default, not a decision: every other breed is
   * one tap away, and changing it costs nothing.
   */
  suggestedBreed?: string | null;
  /** Everything the event needs, gathered by the previous four steps. */
  capture: {
    clientUuid: string;
    mppCode: string;
    memberCode?: string;
    nonMemberId?: number;
    animalId: number;
  };
  onCreated: (event: AIEvent) => void;
  onBack: () => void;
}

export default function SelectBreedScreen({
  animalType,
  suggestedBreed,
  capture,
  onCreated,
  onBack,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [rejection, setRejection] = useState<'out_of_stock' | 'generic' | null>(null);

  const [createAiEvent, { isLoading: creating }] = useCreateAiEventMutation();

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

  /**
   * Answer the step with her own breed, once the flask is known.
   *
   * It has to wait for both the catalogue and the stock: a breed the Mait is not carrying
   * cannot be pre-selected, and until the stock lands every breed looks like one they have
   * none of. Applied once, and never again — a Mait who has changed the answer must not have
   * it changed back under them by a refresh.
   */
  useEffect(() => {
    if (suggestionApplied || loading || rows.length === 0) {
      return;
    }
    setSuggestionApplied(true);
    const match = rows.find(row => row.breed.code === suggestedBreed && row.straws > 0);
    if (match) {
      setCode(match.breed.code);
    }
  }, [suggestionApplied, loading, rows, suggestedBreed]);

  /**
   * Open the event against a straw of this breed.
   *
   * The server holds one from the Mait's stock and deducts nothing yet — an abandoned
   * capture costs them no straw, because no insemination happened. It can still refuse: the
   * screen's counts are a moment old, and another event may have taken the last one.
   */
  const commit = async () => {
    if (!chosen) {
      return;
    }
    setRejection(null);
    try {
      const event = await createAiEvent({
        client_uuid: capture.clientUuid,
        mpp_code: capture.mppCode,
        ...(capture.memberCode
          ? { member_code: capture.memberCode }
          : { non_member_id: capture.nonMemberId }),
        animal_id: capture.animalId,
        semen_breed: chosen.breed.code,
      }).unwrap();
      onCreated(event);
    } catch (err) {
      setRejection(errorCodeOf(err) === ErrorCode.INSUFFICIENT_STOCK ? 'out_of_stock' : 'generic');
      refetch();
    }
  };

  return (
    <FlowScreen
      step={4}
      title={t('aiFlow.whichBreed')}
      subtitle={t('aiFlow.whichBreedSubtitle')}
      onBack={onBack}
      refresh={{ refreshing: isFetching && !loading, onRefresh: refetch }}
      cta={{
        label: t('common.continue'),
        onPress: commit,
        disabled: !chosen,
        busy: creating,
        testID: 'breed-continue',
      }}
    >
      {rejection === 'out_of_stock' && (
        <FlowNotice
          tone="error"
          title={t('aiFlow.strawNotInStockTitle')}
          body={t('aiFlow.raiseIndentSoon')}
          testID="breed-rejected"
        />
      )}
      {rejection === 'generic' && (
        <FlowNotice
          tone="error"
          title={t('errors.generic')}
          body={t('aiFlow.tryAgainInAMoment')}
          testID="breed-rejected"
        />
      )}

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
          // No swatch: a breed is a word, and a coloured tile beside each of eleven of them
          // is eleven blocks of nothing. The row is stretched instead, like the steps before
          // it — the count under the name is what a Mait is really reading here, and it has
          // to be legible at arm's length with a flask in the other hand.
          swatch={false}
          size="roomy"
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
