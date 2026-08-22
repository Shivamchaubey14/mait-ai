/**
 * What the Mait found.
 *
 * Three answers, and the screen says what each one *does* before it is chosen — a calving
 * date, a fresh insemination today, or another visit in three weeks. A Mait who does not know
 * that "not sure" books a recheck will avoid it and guess instead, and a guess in this record
 * is a conception rate nobody can trust.
 *
 * The consequences themselves are the server's: `services.py` decides what an outcome means.
 * What is here is the choosing, and saying plainly what is about to happen.
 *
 * **The photo is required for one outcome only.** Not pregnant is the answer that costs
 * somebody money and the one a farmer disputes six months later. Everywhere else a photograph
 * is a courtesy, and demanding one would teach a Mait to take a picture of a wall to get past
 * the screen.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import type { PdOutcome, PregnancyCheck } from '@api/types';
import FlowCamera from '@/features/aiFlow/FlowCamera';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

import { shortDate } from './PdListScreen';

/** Mirrors `RECHECK_AFTER_DAYS` on the server. Shown so "not sure" is a known quantity. */
const RECHECK_DAYS = 21;

/** Gestation, for the calving date shown *before* the answer is committed. */
const GESTATION_DAYS: Record<string, number> = { COW: 283, BUFF: 310 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The calving date this answer would set, worked out on the handset.
 *
 * A preview only — the server computes and stores the real one, and it is the server's that a
 * farmer is told. It is here because "Pregnant" with a month attached is a different decision
 * from "Pregnant" on its own: it is the first thing the farmer will ask, and a Mait should
 * see it before committing rather than after.
 */
export function calvingPreview(servedOn: string | null, animalType: string): string {
  if (!servedOn) {
    return '';
  }
  const [y, m, d] = servedOn.split('-').map(Number);
  if (!y || !m || !d) {
    return '';
  }
  const due = new Date(y, m - 1, d);
  due.setDate(due.getDate() + (GESTATION_DAYS[animalType] ?? 283));
  return `${due.getDate()} ${MONTHS[due.getMonth()] ?? ''} ${due.getFullYear()}`;
}

function Choice({
  icon,
  label,
  hint,
  selected,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceOn,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={[styles.choiceIcon, selected && styles.choiceIconOn]}>
        <Ionicons name={icon} size={20} color={selected ? colors.surface : colors.textMuted} />
      </View>

      <View style={styles.choiceBody}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {/* What this answer *does*, before it is chosen. */}
        <Text style={styles.choiceHint} numberOfLines={2}>
          {hint}
        </Text>
      </View>

      {/* A filled tick rather than a dot: this is read in sunlight, and a ring with a smaller
          ring inside it is not a shape that survives that. */}
      <View style={[styles.tick, selected && styles.tickOn]}>
        {selected && <Ionicons name="checkmark" size={15} color={colors.surface} />}
      </View>
    </Pressable>
  );
}

export default function PdRecordScreen({
  check,
  onBack,
  onSave,
  photoUri,
  onPhoto,
  busy = false,
}: {
  check: PregnancyCheck;
  onBack: () => void;
  onSave: (outcome: PdOutcome, photoUri: string | null) => void;
  /** Held by the shell, so a photograph survives this screen being rebuilt. */
  photoUri: string | null;
  onPhoto: (uri: string | null) => void;
  busy?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [outcome, setOutcome] = useState<PdOutcome | null>(null);
  const [camera, setCamera] = useState(false);

  const animal = t(`animalType.${check.animal_type}`, { defaultValue: check.animal_type });
  const subject = check.ear_tag_no
    ? t('pd.askSubject', {
        name: check.owner_name,
        animal,
        tag: check.ear_tag_no,
        date: shortDate(check.served_on),
        days: check.days_since_ai ?? 0,
      })
    : t('pd.askSubjectNoTag', {
        name: check.owner_name,
        animal,
        date: shortDate(check.served_on),
        days: check.days_since_ai ?? 0,
      });

  // The server enforces this too. It is checked here as well so a Mait is stopped before the
  // walk back to the yard, not after a request fails.
  const needsPhoto = outcome === 'not_pregnant' && !photoUri;
  const canSave = !!outcome && !needsPhoto && !busy;

  if (camera) {
    // The flow's own camera rather than a new one: it already handles the permission gate,
    // the resize that keeps a 3000px handset photo out of the upload, and the EXIF strip.
    // Building a second would be building all three again, differently.
    return (
      <FlowCamera
        instruction={t('aiFlow.frameTheAnimal')}
        permissionBody={t('aiFlow.animalPhotoBody')}
        testIDPrefix="pd-camera"
        onCaptured={uri => {
          onPhoto(uri);
          setCamera(false);
        }}
        onCancel={() => setCamera(false)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="pd-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
          <Text style={styles.eyebrow}>{t('pd.eyebrow')}</Text>
        </View>

        <Text style={styles.heroTitle}>{t('pd.ask')}</Text>
        <Text style={styles.heroSubtitle} numberOfLines={2}>
          {subject}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Choice
          icon="checkmark"
          label={t('pd.pregnant')}
          hint={t('pd.pregnantHint', {
            date: calvingPreview(check.served_on, check.animal_type),
          })}
          selected={outcome === 'pregnant'}
          onPress={() => setOutcome('pregnant')}
          testID="pd-outcome-pregnant"
        />
        <Choice
          icon="close"
          label={t('pd.notPregnant')}
          hint={t('pd.notPregnantHint')}
          selected={outcome === 'not_pregnant'}
          onPress={() => setOutcome('not_pregnant')}
          testID="pd-outcome-not-pregnant"
        />
        <Choice
          icon="help"
          label={t('pd.unsure')}
          hint={t('pd.unsureHint', { days: RECHECK_DAYS })}
          selected={outcome === 'unsure'}
          onPress={() => setOutcome('unsure')}
          testID="pd-outcome-unsure"
        />

        {/* Dashed while it is optional, solid and outlined once the chosen answer needs it.
            The border does the asking, so no error message has to appear and then be read. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('pd.photoTitle')}
          onPress={() => setCamera(true)}
          style={({ pressed }) => [
            styles.photo,
            needsPhoto && styles.photoRequired,
            pressed && styles.pressed,
          ]}
          testID="pd-photo"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={styles.photoIcon}>
              <Ionicons
                name="camera-outline"
                size={20}
                color={needsPhoto ? colors.error : colors.textMuted}
              />
            </View>
          )}

          <View style={styles.photoBody}>
            <Text style={styles.photoTitle}>{t('pd.photoTitle')}</Text>
            <Text
              style={[styles.photoHint, needsPhoto && styles.photoHintRequired]}
              numberOfLines={2}
            >
              {photoUri ? t('pd.photoTaken') : t('pd.photoHint')}
            </Text>
          </View>

          <Text style={styles.photoAction}>
            {photoUri ? t('pd.photoRetake') : t('pd.photoTake')}
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy }}
          disabled={!canSave}
          onPress={() => outcome && onSave(outcome, photoUri)}
          style={({ pressed }) => [
            styles.cta,
            !canSave && styles.ctaInert,
            pressed && canSave && styles.ctaPressed,
          ]}
          testID="pd-save"
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <>
              <Text style={[styles.ctaLabel, !canSave && styles.ctaLabelInert]}>
                {t('pd.save')}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={canSave ? colors.surface : colors.textDisabled}
              />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  eyebrow: { ...typography.label, color: colors.surface, opacity: 0.72 },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  body: { padding: spacing[4] },
  pressed: { opacity: 0.85 },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  choiceOn: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  choiceIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  choiceIconOn: { backgroundColor: colors.primary },
  choiceBody: { flex: 1 },
  choiceLabel: { ...typography.h3, color: colors.ink },
  choiceHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },

  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Solid and red once the chosen answer requires it: the border asks, so no error message
  // has to appear and then be read.
  photoRequired: {
    borderStyle: 'solid',
    borderColor: colors.error,
    backgroundColor: colors.errorWash,
  },
  photoIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
  photoBody: { flex: 1 },
  photoTitle: { ...typography.bodyStrong, color: colors.ink },
  photoHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  photoHintRequired: { color: colors.error },
  photoAction: { ...typography.bodyStrong, color: colors.primaryDark },

  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaInert: { backgroundColor: colors.disabledFill },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  ctaLabelInert: { color: colors.textDisabled },
});
