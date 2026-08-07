/**
 * Step 4 of the AI capture flow — the straw (SRS §6.3 step 4, M8).
 *
 * This is the gate the whole platform exists for: a Mait holding ten straws can complete
 * exactly ten AI events. The check happens here, and the deduction happens at completion —
 * so a Mait who scans and then walks away from a difficult animal loses nothing, which is
 * right, because no insemination happened.
 *
 * Two rejections, kept apart on purpose. "Not in your stock" means raise an indent; "already
 * used" means a data problem worth reporting. Collapsing them into "invalid straw" would
 * leave the Mait with no idea what to do next, standing in a yard, with the animal waiting.
 *
 * Manual entry today; the barcode scanner arrives with the camera work in Day 12, which is
 * when `expo-camera` enters the build for the proof photo.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useCreateAiEventMutation,
  useGetInventorySummaryQuery,
  useLazyValidateStrawQuery,
} from '@api/endpoints';
import type { AIEvent, StrawValidation } from '@api/types';

import { FieldCard, FlowNotice, FlowScreen, FlowSpacer, InfoTile, OptionCard } from './components';

interface Props {
  /** Everything the event needs, gathered by the previous three steps. */
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

type Rejection = 'not_in_stock' | 'already_used' | 'breed_required' | 'generic' | null;

export default function ScanStrawScreen({ capture, onCreated, onBack }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [strawNo, setStrawNo] = useState('');
  const [checked, setChecked] = useState<StrawValidation | null>(null);
  const [rejection, setRejection] = useState<Rejection>(null);
  const [breed, setBreed] = useState<string | null>(null);
  const [breedChoices, setBreedChoices] = useState<string[]>([]);

  const { data: stock } = useGetInventorySummaryQuery();
  const [validateStraw, { isFetching: checking }] = useLazyValidateStrawQuery();
  const [createAiEvent, { isLoading: creating }] = useCreateAiEventMutation();

  const entered = strawNo.trim();

  const handleCheck = async (withBreed?: string) => {
    const chosen = withBreed ?? breed ?? undefined;
    setRejection(null);
    setChecked(null);
    try {
      const result = await validateStraw({ uniqueNo: entered, breed: chosen }).unwrap();
      setChecked(result);
      if (!result.valid) {
        setRejection(result.reason ?? 'generic');
        // A number the server has never seen is not a mistake when the straws were issued
        // as a bundle. It only needs the Mait to say which bundle it came out of.
        setBreedChoices(result.breed_choices ?? []);
      }
    } catch {
      setRejection('generic');
    }
  };

  const handleContinue = async () => {
    setRejection(null);
    try {
      const event = await createAiEvent({
        client_uuid: capture.clientUuid,
        mpp_code: capture.mppCode,
        ...(capture.memberCode
          ? { member_code: capture.memberCode }
          : { non_member_id: capture.nonMemberId }),
        animal_id: capture.animalId,
        straw_unique_no: entered,
        ...(breed ? { semen_breed: breed } : {}),
      }).unwrap();
      onCreated(event);
    } catch (err) {
      // The server re-checks the straw inside the transaction that creates the event. It can
      // legitimately disagree with the check above — another event may have consumed the
      // straw in between — and the server is the authority.
      switch (errorCodeOf(err)) {
        case ErrorCode.INSUFFICIENT_STOCK:
          setRejection('not_in_stock');
          setChecked(null);
          break;
        case ErrorCode.STRAW_ALREADY_CONSUMED:
          setRejection('already_used');
          setChecked(null);
          break;
        default:
          setRejection('generic');
      }
    }
  };

  const verified = checked?.valid === true;

  const notice = {
    not_in_stock: {
      title: t('aiFlow.strawNotInStockTitle'),
      body: t('aiFlow.strawNotInStockBody'),
    },
    already_used: {
      title: t('aiFlow.strawAlreadyUsedTitle'),
      body: t('aiFlow.strawAlreadyUsedBody'),
    },
    breed_required: {
      title: t('aiFlow.whichBreedTitle'),
      body: t('aiFlow.whichBreedBody'),
    },
    generic: { title: t('errors.generic'), body: t('aiFlow.tryAgainInAMoment') },
  };

  return (
    <FlowScreen
      step={3}
      title={t('aiFlow.whichStraw')}
      subtitle={t('aiFlow.whichStrawSubtitle')}
      onBack={onBack}
      cta={{
        label: verified ? t('common.continue') : t('aiFlow.checkStraw'),
        onPress: verified ? handleContinue : handleCheck,
        disabled: entered.length < 3,
        busy: checking || creating,
        testID: verified ? 'straw-continue' : 'straw-check',
      }}
    >
      <InfoTile
        label={t('aiFlow.strawsInStock')}
        value={String(stock?.total_straws ?? '—')}
        pill={stock?.is_low_stock ? t('aiFlow.lowStock') : undefined}
        testID="straw-stock"
      />

      <FieldCard
        label={t('aiFlow.strawNumber')}
        hint={t('aiFlow.strawNumberHint')}
        value={strawNo}
        onChangeText={text => {
          setStrawNo(text.toUpperCase());
          // The old verdict describes the old number. Leaving it up would let a Mait tap
          // Continue on a straw they have since retyped.
          setChecked(null);
          setRejection(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="straw-number"
      />

      {verified && checked?.straw && (
        <View>
          <OptionCard
            title={t('aiFlow.strawVerified')}
            subtitle={`${checked.straw.breed} · ${checked.straw.unique_straw_no}`}
            pill={t('aiFlow.inStock')}
            selected
            testID="straw-verified"
          />
          {checked.available_straws <= 5 && (
            <FlowNotice
              tone="accent"
              title={t('aiFlow.strawsLeft', { count: checked.available_straws })}
              body={t('aiFlow.raiseIndentSoon')}
              testID="straw-low-stock"
            />
          )}
        </View>
      )}

      {!!rejection && (
        <FlowNotice
          tone={rejection === 'breed_required' ? 'accent' : 'error'}
          title={notice[rejection].title}
          body={notice[rejection].body}
          testID={`straw-rejected-${rejection}`}
        />
      )}

      {/* Asked rather than guessed at. Picking wrong records the wrong bull against the
          animal, and nothing downstream would ever catch it. */}
      {rejection === 'breed_required' &&
        breedChoices.map(choice => (
          <OptionCard
            key={choice}
            title={choice}
            subtitle={t('aiFlow.breedInFlask', { count: stock?.by_breed?.[choice] ?? 0 })}
            selected={breed === choice}
            onPress={() => {
              setBreed(choice);
              handleCheck(choice);
            }}
            testID={`straw-breed-${choice}`}
          />
        ))}

      <FlowSpacer />
    </FlowScreen>
  );
}
