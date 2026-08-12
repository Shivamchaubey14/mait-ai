/**
 * Step 4 of the AI capture flow — which animal (SRS §6.3 step 3, C6).
 *
 * Two jobs on one screen, because in the yard they are one decision: pick an animal already
 * on record, or register the one standing in front of you. Splitting them across two screens
 * would make the Mait guess which they need before they have looked at the list.
 *
 * Cow or buffalo sits above both jobs as a segmented control rather than inside either. It
 * filters the list and it is the species of anything added from it — one question, asked
 * once, whichever of the two things the Mait came here to do.
 *
 * Registering one asks for that and an optional ear tag, and nothing else. Her own breed is
 * not asked: it is a judgement a Mait standing in a yard often cannot make, and a required
 * field there would collect guesses. The breed at the next step is the straw's.
 */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateAnimalMutation, useListBreedsQuery } from '@api/endpoints';
import type { Animal, AnimalTypeCode, ProblemDetails } from '@api/types';

import { AddCard, FieldCard, FlowNotice, FlowScreen, OptionCard, Segmented } from './components';

interface Props {
  /** Who the animal belongs to. One of the two codes is always present. */
  owner: { name: string; memberCode?: string; nonMemberId?: number };
  /** Animals already registered to this farmer, from their detail record. */
  animals: Animal[];
  onSelect: (animal: Animal) => void;
  onBack: () => void;
}

const ANIMAL_TYPES: AnimalTypeCode[] = ['COW', 'BUFF'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "14 Mar 2026" — with the year, unlike the timelines elsewhere in the app.
 *
 * A last insemination can be eighteen months back, and that is precisely the case the Mait is
 * reading the line to catch. "14 Mar" would look like this year.
 */
function longDate(iso: string): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return null;
  }
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function SelectAnimalScreen({
  owner,
  animals,
  onSelect,
  onBack,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();

  // The list first, always — even when it is empty. It used to open straight into the form
  // for a farmer with nothing on record, which was wrong twice over: the Mait lost the "add"
  // card and the empty line that explains it, and an animal list still loading looks exactly
  // like an empty one, so a farmer with four cows was landing on a registration form.
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Opens on the species the farmer actually keeps, so a buffalo household does not land on
  // an empty Cow list and conclude their animals are missing.
  const [animalType, setAnimalType] = useState<AnimalTypeCode>(animals[0]?.animal_type ?? 'COW');
  const [earTag, setEarTag] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  // Read only to put a name to the breed codes already on the farmer's animals. The straw's
  // breed is asked at the next step, and an animal's own breed is not asked at all.
  const { data: breeds = [] } = useListBreedsQuery(animalType);
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

  /**
   * C1, C2, B1 — a handle for an animal that has no tag.
   *
   * Numbered across the farmer's whole record rather than the filtered list, so a cow keeps
   * the same handle whichever half of the toggle is showing.
   */
  const tokens = useMemo(() => {
    const counts: Partial<Record<AnimalTypeCode, number>> = {};
    const out: Record<number, string> = {};
    for (const animal of animals) {
      const next = (counts[animal.animal_type] ?? 0) + 1;
      counts[animal.animal_type] = next;
      out[animal.id] = `${t(`aiFlow.animalInitial.${animal.animal_type}`)}${next}`;
    }
    return out;
  }, [animals, t]);

  const onRecord = animals.filter(animal => animal.animal_type === animalType);

  const chooseType = (next: AnimalTypeCode) => {
    setAnimalType(next);
    // A cow chosen from the list is not in it once the answer becomes buffalo.
    setSelectedId(null);
  };

  const title = (animal: Animal) => {
    const type = t(`aiFlow.animalType.${animal.animal_type}`);
    return animal.ear_tag_no
      ? t('aiFlow.animalWithTag', { type, tag: animal.ear_tag_no })
      : t('aiFlow.noEarTag', { type });
  };

  /**
   * When she was last served, and what she is — the two things that tell one cow from another.
   *
   * Her breed is often blank, because the flow does not ask for it: it is a judgement a Mait
   * standing in a yard cannot reliably make. The line then carries the date alone rather than
   * a dangling separator.
   */
  const describe = (animal: Animal) => {
    const when = animal.last_ai_at ? longDate(animal.last_ai_at) : null;
    const breedLabel = animal.breed ? breedName(animal.breed) : null;
    if (when && breedLabel) {
      return t('aiFlow.lastAi', { date: when, breed: breedLabel });
    }
    if (when) {
      return t('aiFlow.lastAiOnly', { date: when });
    }
    return breedLabel
      ? t('aiFlow.neverServed', { breed: breedLabel })
      : t('aiFlow.neverServedOnly');
  };

  const handleAdd = async () => {
    setFieldErrors({});
    setFailed(false);
    try {
      const created = await createAnimal({
        ...(owner.memberCode
          ? { member_code: owner.memberCode }
          : { non_member_id: owner.nonMemberId }),
        animal_type: animalType,
        ...(earTag.trim() ? { ear_tag_no: earTag.trim() } : {}),
      }).unwrap();
      onSelect(created);
    } catch (err) {
      // The server is the authority on the ear tag being free; surface its per-field message
      // so the Mait knows which box to fix.
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
        // Nothing left to satisfy: the species always has a value and the tag is optional.
        busy: saving,
        testID: 'animal-save',
      }
    : {
        label: t('common.continue'),
        onPress: () => chosen && onSelect(chosen),
        disabled: !chosen,
        testID: 'animal-continue',
      };

  const typeToggle = (
    <Segmented
      options={ANIMAL_TYPES.map(code => ({ value: code, label: t(`aiFlow.animalType.${code}`) }))}
      value={animalType}
      onChange={chooseType}
      testID="animal-type"
    />
  );

  return (
    <FlowScreen
      step={3}
      title={t('aiFlow.whichAnimal')}
      subtitle={
        adding
          ? t('aiFlow.addAnimalSubtitle', { name: owner.name })
          : animals.length === 0
            ? t('aiFlow.nothingOnRecord', { name: owner.name })
            : t('aiFlow.onRecordCount', { name: owner.name, count: animals.length })
      }
      onBack={adding ? () => setAdding(false) : onBack}
      cta={cta}
      link={
        adding
          ? {
              label: t('aiFlow.pickExistingAnimal'),
              onPress: () => setAdding(false),
              testID: 'animal-pick-existing',
            }
          : undefined
      }
    >
      {adding ? (
        <View>
          {/* No label over it. The two words in the control are the question, and a heading
              that repeats them is a line of furniture on a form of two fields. */}
          {typeToggle}

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
          {typeToggle}

          {onRecord.length === 0 && (
            <FlowNotice
              tone="info"
              title={t('aiFlow.noneOfType', { type: t(`aiFlow.animalType.${animalType}`) })}
              body={t('aiFlow.noneOfTypeBody')}
              testID="animal-none-of-type"
            />
          )}

          {onRecord.map(animal => (
            <OptionCard
              key={animal.id}
              swatchLabel={tokens[animal.id]}
              title={title(animal)}
              subtitle={describe(animal)}
              tone="neutral"
              check
              selected={selectedId === animal.id}
              onPress={() => setSelectedId(animal.id)}
              testID={`animal-${animal.id}`}
            />
          ))}

          {/* Dashed, under the list: a place for an animal rather than another animal. */}
          <AddCard
            title={t('aiFlow.addAnimal')}
            subtitle={t('aiFlow.earTagOptionalHint')}
            onPress={() => setAdding(true)}
            testID="animal-add-card"
          />
        </View>
      )}
    </FlowScreen>
  );
}
