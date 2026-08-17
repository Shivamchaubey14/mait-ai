/**
 * Registering an animal, as a sheet over step 4 (C6).
 *
 * A sheet rather than a screen, because registering is not a step of the flow — it is a
 * detour taken from the list and handed straight back to it. The list stays visible behind,
 * so the Mait can see they have not lost their place, and the tab bar underneath is not
 * covered: nothing here has been committed yet.
 *
 * Four things are asked, in the order a Mait can answer them by looking at the animal: cow or
 * buffalo, her breed, her ear tag if she carries one, and a photograph. The photo is the point
 * of the whole sheet — most animals in this data have no tag, and "the black one" is not a
 * record. Next visit, the row shows her face.
 */

import React, { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useListBreedsQuery } from '@api/endpoints';
import type { AnimalTypeCode } from '@api/types';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import AnimalCamera from './AnimalCamera';
import { Dropdown, FlowNotice, LabelledField, Segmented, useKeyboardOverlap } from './components';

const ANIMAL_TYPES: AnimalTypeCode[] = ['COW', 'BUFF'];

export interface AnimalDraftInput {
  animalType: AnimalTypeCode;
  breed: string | null;
  earTag: string;
  /** Where the camera wrote her portrait, or null if the Mait skipped it. */
  photoUri: string | null;
}

interface Props {
  /** Whose animal this will be, named on the sheet so it cannot be registered to the wrong one. */
  owner: { name: string; code?: string };
  /** The species the list was filtered to when the Mait tapped Add — the likely answer. */
  initialType: AnimalTypeCode;
  saving: boolean;
  /** Per-field messages from the server, keyed as the API sends them. */
  fieldErrors: Record<string, string[]>;
  /**
   * The part of a refusal no field on this sheet can carry, in the server's own words.
   *
   * Drawn against the Save button rather than in the scroll, because that is where the Mait
   * is looking when they tap it — a message further up is a tap that appears to do nothing.
   */
  refusal: string | null;
  onSave: (draft: AnimalDraftInput) => void;
  onClose: () => void;
}

export default function AddAnimalSheet({
  owner,
  initialType,
  saving,
  fieldErrors,
  refusal,
  onSave,
  onClose,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap();
  const scroller = useRef<ScrollView>(null);

  const [animalType, setAnimalType] = useState<AnimalTypeCode>(initialType);
  const [breed, setBreed] = useState<string | null>(null);
  const [earTag, setEarTag] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);

  const hindi = i18n.language.startsWith('hi');
  const { data: breeds = [] } = useListBreedsQuery(animalType);

  const chooseType = (next: AnimalTypeCode) => {
    setAnimalType(next);
    // The breeds differ per species, so a breed chosen for a cow means nothing once the
    // answer becomes buffalo.
    setBreed(null);
  };

  if (camera) {
    return (
      <AnimalCamera
        onCaptured={uri => {
          setPhotoUri(uri);
          setCamera(false);
        }}
        onCancel={() => setCamera(false)}
      />
    );
  }

  return (
    <View style={styles.root}>
      {/* Dimmed, not hidden. The question the sheet belongs to stays legible behind it. */}
      <Pressable
        style={styles.scrim}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={onClose}
        testID="add-animal-scrim"
      />

      {/* The sheet stays welded to the bottom edge and grows into the keyboard rather than
          being lifted off it. Lifting it left a band of scrim under the Save button, which
          read as the sheet floating loose; padding it keeps the white running all the way
          down, with the keyboard covering the part nobody needs to see. */}
      <View
        style={[
          styles.sheet,
          { paddingBottom: keyboard > 0 ? keyboard + spacing[4] : spacing[5] + insets.bottom },
        ]}
      >
        <View style={styles.grabber} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{t('aiFlow.addAnimal')}</Text>
            <Text style={styles.forWhom} numberOfLines={1}>
              {owner.code
                ? t('aiFlow.forFarmerWithCode', { name: owner.name, code: owner.code })
                : t('aiFlow.forFarmer', { name: owner.name })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            testID="add-animal-close"
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView
          ref={scroller}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>{t('aiFlow.animalTypeLabel')}</Text>
          <Segmented
            options={ANIMAL_TYPES.map(code => ({
              value: code,
              label: t(`aiFlow.animalType.${code}`),
            }))}
            value={animalType}
            onChange={chooseType}
            testID="sheet-animal-type"
          />

          <Dropdown
            label={t('aiFlow.breed')}
            placeholder={t('aiFlow.chooseBreed')}
            value={breed}
            options={breeds.map(option => ({
              value: option.code,
              label: (hindi && option.name_hi) || option.name,
            }))}
            onChange={setBreed}
            testID="animal-breed"
          />

          <LabelledField
            label={t('aiFlow.earTagNumber')}
            optionalNote={t('aiFlow.optionalSuffix')}
            tone="primary"
            placeholder={t('aiFlow.earTagExample')}
            error={fieldErrors.ear_tag_no?.[0]}
            value={earTag}
            onChangeText={setEarTag}
            // The tag sits low in the sheet, so tapping it brings the rest of the sheet up
            // with the keyboard rather than leaving the field under the cursor off screen.
            onFocus={() => scroller.current?.scrollToEnd({ animated: true })}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="animal-ear-tag"
          />

          {/* Dashed and unfilled while it is empty, like the add card that opened this
                sheet: a place for something, not the thing. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setCamera(true)}
            style={({ pressed }) => [
              styles.photo,
              !!photoUri && styles.photoTaken,
              pressed && styles.photoPressed,
            ]}
            testID="animal-photo"
          >
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.photoChip}>
                <Ionicons name="camera-outline" size={20} color={colors.text} />
              </View>
            )}

            <View style={styles.photoText}>
              <Text style={styles.photoTitle}>{t('aiFlow.animalPhotoTitle')}</Text>
              <Text style={styles.photoBody}>{t('aiFlow.animalPhotoBody')}</Text>
            </View>

            <Text style={styles.take}>{photoUri ? t('aiFlow.retake') : t('aiFlow.take')}</Text>
          </Pressable>

        </ScrollView>

        {/* Outside the scroll, so a refusal cannot arrive off-screen. */}
        {!!refusal && <FlowNotice tone="error" title={refusal} testID="animal-error" />}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !breed || saving, busy: saving }}
          onPress={() => onSave({ animalType, breed, earTag, photoUri })}
          disabled={!breed || saving}
          style={({ pressed }) => [
            styles.save,
            !breed || saving ? styles.saveDisabled : styles.saveEnabled,
            pressed && !!breed && !saving && styles.savePressed,
          ]}
          testID="animal-save"
        >
          <Text style={[styles.saveLabel, (!breed || saving) && styles.saveLabelDisabled]}>
            {t('aiFlow.saveAnimal')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(21,35,45,0.45)' },

  // Shrinks rather than overflows. With the keyboard up there is less room, and the sheet
  // giving way is what keeps the button and the field being typed into on screen — the
  // fields scroll inside it.
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    ...shadows.raised,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing[4],
  },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  headerText: { flex: 1 },
  title: { ...typography.h2, color: colors.ink },
  // Green, and carrying the code as well as the name: this sheet writes a record against one
  // farmer, and the code is what a Mait can check it against.
  forWhom: { ...typography.caption, color: colors.primaryDark, marginTop: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  closePressed: { backgroundColor: colors.disabledFill },

  label: {
    ...typography.label,
    color: colors.primaryDark,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },

  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.textDisabled,
    borderRadius: radius.lg,
    padding: spacing[3],
  },
  // Once she has been photographed it is a record, not a space for one.
  photoTaken: { borderStyle: 'solid', borderColor: colors.border },
  photoPressed: { backgroundColor: colors.background },
  photoChip: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  photoText: { flex: 1 },
  photoTitle: { ...typography.bodyStrong, color: colors.ink },
  photoBody: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  // Yolk 800: the action here is optional and must not read as the screen's primary green.
  take: { ...typography.bodyStrong, color: yolk[800] },

  save: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.lg,
    marginTop: spacing[4],
  },
  saveEnabled: { backgroundColor: colors.primary },
  saveDisabled: { backgroundColor: colors.disabledFill },
  savePressed: { backgroundColor: colors.primaryPressed },
  saveLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  saveLabelDisabled: { color: colors.textDisabled },
});
