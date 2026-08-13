/**
 * Step 4 of the AI capture flow — which animal (SRS §6.3 step 3, C6).
 *
 * Two jobs on one screen, because in the yard they are one decision: pick an animal already
 * on record, or register the one standing in front of you. Splitting them across two screens
 * would make the Mait guess which they need before they have looked at the list.
 *
 * Cow or buffalo sits above the list as a segmented control, filtering it. Registering happens
 * in a sheet over the top (AddAnimalSheet) rather than by replacing the screen: it is a detour
 * from the list, handed straight back to it, and the question stays legible behind.
 *
 * Rows lead with her photograph where there is one. Most animals in this data carry no ear
 * tag, so a face is the difference between "the black one" and a record.
 */

import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  useCreateAnimalMutation,
  useListBreedsQuery,
  useUploadAnimalPhotoMutation,
} from '@api/endpoints';
import type { Animal, AnimalTypeCode, ProblemDetails } from '@api/types';
import { mediaUrl } from '@/config/env';
import { radius } from '@theme/tokens';

import AddAnimalSheet, { AnimalDraftInput } from './AddAnimalSheet';
import { AddCard, FlowNotice, FlowScreen, OptionCard, Segmented } from './components';

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  // Read only to put a name to the breed codes already on the farmer's animals; the sheet asks
  // for its own list when it opens.
  const { data: breeds = [] } = useListBreedsQuery(animalType);
  const [createAnimal, { isLoading: saving }] = useCreateAnimalMutation();
  const [uploadPhoto] = useUploadAnimalPhotoMutation();

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
   * C1, C2, B1 — a handle for an animal with no photograph and no tag.
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
   * Her breed can be blank on older records, and the line then carries the date alone rather
   * than a dangling separator.
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

  /**
   * Register her, then send her portrait.
   *
   * Two calls, and the photo is the one allowed to fail: the flow is standing on the new
   * animal's id by the time it is sent, and a Mait with a farmer waiting should not be sent
   * back to the start of the step because a village connection dropped a JPEG.
   */
  const handleSave = async (draft: AnimalDraftInput) => {
    setFieldErrors({});
    setFailed(false);
    try {
      const created = await createAnimal({
        ...(owner.memberCode
          ? { member_code: owner.memberCode }
          : { non_member_id: owner.nonMemberId }),
        animal_type: draft.animalType,
        ...(draft.breed ? { breed: draft.breed } : {}),
        ...(draft.earTag.trim() ? { ear_tag_no: draft.earTag.trim() } : {}),
      }).unwrap();

      if (draft.photoUri) {
        try {
          await uploadPhoto({ id: created.id, uri: draft.photoUri }).unwrap();
        } catch {
          // Deliberately swallowed. She is registered and the flow can go on; the photo can
          // be taken again from her record later.
        }
      }

      setAdding(false);
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

  return (
    <View style={styles.root}>
      <FlowScreen
        step={3}
        title={t('aiFlow.whichAnimal')}
        subtitle={
          animals.length === 0
            ? t('aiFlow.nothingOnRecord', { name: owner.name })
            : t('aiFlow.onRecordCount', { name: owner.name, count: animals.length })
        }
        onBack={onBack}
        cta={{
          label: t('common.continue'),
          onPress: () => chosen && onSelect(chosen),
          disabled: !chosen,
          testID: 'animal-continue',
        }}
      >
        <Segmented
          options={ANIMAL_TYPES.map(code => ({
            value: code,
            label: t(`aiFlow.animalType.${code}`),
          }))}
          value={animalType}
          onChange={chooseType}
          testID="animal-type"
        />

        {onRecord.length === 0 && (
          <FlowNotice
            tone="info"
            title={t(`aiFlow.noneOfType.${animalType}`)}
            body={t('aiFlow.noneOfTypeBody')}
            testID="animal-none-of-type"
          />
        )}

        {onRecord.map(animal => (
          <OptionCard
            key={animal.id}
            swatchLabel={animal.photo_url ? undefined : tokens[animal.id]}
            iconNode={
              animal.photo_url ? (
                <Image
                  source={{ uri: mediaUrl(animal.photo_url) }}
                  style={styles.portrait}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : undefined
            }
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
      </FlowScreen>

      {adding && (
        <AddAnimalSheet
          owner={{ name: owner.name, code: owner.memberCode }}
          initialType={animalType}
          saving={saving}
          fieldErrors={fieldErrors}
          failed={failed}
          onSave={handleSave}
          onClose={() => setAdding(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Fills the swatch the token would have used, so a list of photographed and unphotographed
  // animals still reads as one column.
  portrait: { width: 40, height: 40, borderRadius: radius.sm },
});
