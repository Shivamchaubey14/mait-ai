/**
 * Step 3 of the AI capture flow — which animal (SRS §6.3 step 3, M7).
 *
 * Two jobs on one screen, because in the yard they are one decision: pick an animal already
 * on record, or register the one standing in front of you. Splitting them across two screens
 * would make the Mait guess which they need before they have looked at the list.
 *
 * The breed list is configuration, not an enum in the app. The authoritative list is still an
 * open item (SRS §18.2) and has to be changeable without shipping a build to every handset.
 * Free text is not an option either: "Gir", "gir" and "GIR" would be three breeds in the
 * dashboard within a month.
 */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateAnimalMutation, useListBreedsQuery } from '@api/endpoints';
import type { Animal, AnimalTypeCode, ProblemDetails } from '@api/types';

import { FieldCard, FlowLabel, FlowNotice, FlowScreen, OptionCard } from './components';

interface Props {
  /** Who the animal belongs to. One of the two codes is always present. */
  owner: { name: string; memberCode?: string; nonMemberId?: number };
  /** Animals already registered to this farmer, from their detail record. */
  animals: Animal[];
  onSelect: (animal: Animal) => void;
  onBack: () => void;
}

const ANIMAL_TYPES: AnimalTypeCode[] = ['COW', 'BUFF'];

export default function SelectAnimalScreen({
  owner,
  animals,
  onSelect,
  onBack,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();

  // Straight into the form when the farmer has no animals on record: an empty list with an
  // "add" card under it is a screen that asks the Mait to tap through nothing.
  const [adding, setAdding] = useState(animals.length === 0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [animalType, setAnimalType] = useState<AnimalTypeCode>('COW');
  const [breed, setBreed] = useState<string | null>(null);
  const [earTag, setEarTag] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  const { data: breeds = [], isLoading: breedsLoading } = useListBreedsQuery(animalType);
  const [createAnimal, { isLoading: saving }] = useCreateAnimalMutation();

  const hindi = i18n.language.startsWith('hi');
  const breedName = useMemo(
    () => (code: string) => {
      const match = breeds.find(row => row.code === code);
      if (!match) {
        return code;
      }
      return (hindi && match.name_hi) || match.name;
    },
    [breeds, hindi],
  );

  const describe = (animal: Animal) =>
    animal.ear_tag_no
      ? `${t(`aiFlow.animalType.${animal.animal_type}`)} · ${animal.ear_tag_no}`
      : t('aiFlow.noEarTag', { type: t(`aiFlow.animalType.${animal.animal_type}`) });

  const handleAdd = async () => {
    setFieldErrors({});
    setFailed(false);
    try {
      const created = await createAnimal({
        ...(owner.memberCode
          ? { member_code: owner.memberCode }
          : { non_member_id: owner.nonMemberId }),
        animal_type: animalType,
        breed: breed as string,
        ...(earTag.trim() ? { ear_tag_no: earTag.trim() } : {}),
      }).unwrap();
      onSelect(created);
    } catch (err) {
      // The server is the authority on the ear tag being free and the breed being real;
      // surface its per-field message so the Mait knows which box to fix.
      const problem = (err as { data?: ProblemDetails })?.data;
      if (problem?.errors) {
        setFieldErrors(problem.errors);
      } else {
        setFailed(true);
      }
    }
  };

  const chosen = animals.find(animal => animal.id === selectedId) ?? null;

  const cta = adding
    ? {
        label: t('aiFlow.saveAndContinue'),
        onPress: handleAdd,
        disabled: !breed,
        busy: saving,
        testID: 'animal-save',
      }
    : {
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen),
        disabled: !chosen,
        testID: 'animal-continue',
      };

  return (
    <FlowScreen
      step={2}
      title={t('aiFlow.whichAnimal')}
      subtitle={
        adding
          ? t('aiFlow.addAnimalSubtitle', { name: owner.name })
          : t('aiFlow.whichAnimalSubtitle')
      }
      onBack={adding && animals.length > 0 ? () => setAdding(false) : onBack}
      cta={cta}
      link={
        adding
          ? animals.length > 0
            ? {
                label: t('aiFlow.pickExistingAnimal'),
                onPress: () => setAdding(false),
                testID: 'animal-pick-existing',
              }
            : undefined
          : { label: t('aiFlow.addAnimal'), onPress: () => setAdding(true), testID: 'animal-add' }
      }
    >
      {adding ? (
        <View>
          <FlowLabel>{t('aiFlow.animalTypeLabel')}</FlowLabel>
          {ANIMAL_TYPES.map(code => (
            <OptionCard
              key={code}
              title={t(`aiFlow.animalType.${code}`)}
              subtitle={t(`aiFlow.animalTypeHint.${code}`)}
              radio
              selected={animalType === code}
              onPress={() => {
                setAnimalType(code);
                // The breeds differ per species, so a breed chosen for a cow is meaningless
                // once the answer becomes buffalo.
                setBreed(null);
              }}
              testID={`animal-type-${code}`}
            />
          ))}

          <FlowLabel>{t('aiFlow.breed')}</FlowLabel>
          {breedsLoading ? (
            <FlowNotice tone="info" title={t('common.loading')} />
          ) : breeds.length === 0 ? (
            <FlowNotice tone="info" title={t('aiFlow.noBreeds')} body={t('aiFlow.noBreedsBody')} />
          ) : (
            breeds.map(option => (
              <OptionCard
                key={option.code}
                title={(hindi && option.name_hi) || option.name}
                subtitle={option.code}
                radio
                selected={breed === option.code}
                onPress={() => setBreed(option.code)}
                testID={`breed-${option.code}`}
              />
            ))
          )}
          {!!fieldErrors.breed?.[0] && (
            <FlowNotice
              tone="error"
              title={fieldErrors.breed[0] as string}
              testID="animal-breed-error"
            />
          )}

          <FieldCard
            label={t('aiFlow.earTagOptional')}
            hint={t('aiFlow.earTagHint')}
            error={fieldErrors.ear_tag_no?.[0]}
            value={earTag}
            onChangeText={setEarTag}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="animal-ear-tag"
          />

          {failed && (
            <FlowNotice
              tone="error"
              title={t('errors.generic')}
              body={t('aiFlow.tryAgainInAMoment')}
              testID="animal-error"
            />
          )}
        </View>
      ) : (
        <View>
          {animals.map(animal => (
            <OptionCard
              key={animal.id}
              title={breedName(animal.breed)}
              subtitle={describe(animal)}
              pill={
                animal.ai_event_count > 0
                  ? t('aiFlow.aiCount', { count: animal.ai_event_count })
                  : undefined
              }
              selected={selectedId === animal.id}
              onPress={() => setSelectedId(animal.id)}
              testID={`animal-${animal.id}`}
            />
          ))}

          {/* The same accent treatment the farmer step gives "not a member": a way out of
              the list, not another thing in it. */}
          <OptionCard
            title={t('aiFlow.animalNotListed')}
            subtitle={t('aiFlow.animalNotListedBody')}
            tone="accent"
            onPress={() => setAdding(true)}
            testID="animal-add-card"
          />
        </View>
      )}
    </FlowScreen>
  );
}
