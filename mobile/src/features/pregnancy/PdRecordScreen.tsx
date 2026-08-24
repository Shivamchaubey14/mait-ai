/**
 * What the Mait found — and first, whether they were allowed to look.
 *
 * **The permission comes before the examination, on the screen as in the yard.** A Mait
 * arrives, greets the owner and asks whether to go ahead; only then does a hand go on the
 * animal. A screen that opens on three findings asks the Mait to answer a question they have
 * not been given permission to ask yet, and it leaves them nothing to tap when the answer is
 * no — at which point the row stays open forever or gets closed with a guess. Both are worse
 * than the extra tap.
 *
 * So the flow is two stages. Stage one is the owner's answer. Yes opens the findings; no is
 * itself the record, and there is nothing further to do — no outcome to choose, no photograph
 * to take, no charge, because nothing was examined.
 *
 * Then three answers, and the screen says what each one *does* before it is chosen — a calving
 * date, a fresh insemination today, or another visit in three weeks. A Mait who does not know
 * that "not sure" books a recheck will avoid it and guess instead, and a guess in this record
 * is a conception rate nobody can trust. A refusal says what it does too: the check closes and
 * nothing further is asked, so the Mait is not left wondering whether it will come back.
 *
 * **And what it costs, before it is done.** The price is on the findings stage rather than
 * only at the end, because the Mait has to be able to say it in the yard *before* putting a
 * hand on the animal — a figure produced afterwards is a bill, not a quote. Member and
 * non-member are opposite instructions (deduct later versus collect now), so `charge.ts`
 * decides which and both screens read the one answer.
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
import { settlementFor } from './charge';
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
  role = 'radio',
  tone = 'good',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /**
   * `radio` for the findings, which are chosen and then committed by the button at the foot.
   * `button` for "yes, go ahead", which is not an answer being recorded — it is the way
   * through to the screen that records one, and announcing it as a radio would tell a screen
   * reader that tapping it selects something.
   */
  role?: 'radio' | 'button';
  /** A refusal is not a finding, so it does not turn the card green when chosen. */
  tone?: 'good' | 'plain';
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected } : undefined}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && (tone === 'plain' ? styles.choiceOnPlain : styles.choiceOn),
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.choiceIcon,
          selected && (tone === 'plain' ? styles.choiceIconOnPlain : styles.choiceIconOn),
        ]}
      >
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
      {role === 'radio' ? (
        <View
          style={[styles.tick, selected && (tone === 'plain' ? styles.tickOnPlain : styles.tickOn)]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={colors.surface} />}
        </View>
      ) : (
        // A chevron, not a tick: this one goes somewhere rather than marking an answer.
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      )}
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
  // Stage one until the owner has answered. `null` is "not asked yet" and is different from
  // `false`: one is a screen waiting for a tap, the other is a refusal about to be recorded.
  const [consented, setConsented] = useState<boolean | null>(null);

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
  const declining = consented === false;

  // What this visit costs and who settles it. Read once here so the wording and the figure
  // cannot drift apart between the label and the line under it.
  const settlement = settlementFor(check, outcome);
  const chargeLine =
    settlement.kind === 'member'
      ? t('pd.chargeMember', { amount: settlement.amount })
      : settlement.kind === 'nonMember'
        ? t('pd.chargeNonMember', { amount: settlement.amount })
        : t('pd.chargeUnpriced');
  const chargeHint =
    settlement.kind === 'member'
      ? t('pd.chargeMemberHint')
      : settlement.kind === 'nonMember'
        ? t('pd.chargeNonMemberHint')
        : t('pd.chargeUnpricedHint');

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

  /**
   * The back arrow goes back one stage, not out of the screen.
   *
   * From the findings it returns to the owner's question, because a Mait who taps "yes" and
   * then realises the owner was answering something else has to be able to undo it. Only from
   * the first stage does it leave.
   */
  const heroTop = (onPress: () => void) => (
    <View style={styles.heroTop}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={onPress}
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        testID="pd-back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.surface} />
      </Pressable>
      <Text style={styles.eyebrow}>{t('pd.eyebrow')}</Text>
    </View>
  );

  /**
   * A result already found is a record, not a form.
   *
   * The Done tab exists so a Mait can check what they told a farmer last week before being
   * asked about it again — so tapping the row has to lead somewhere. What it must not lead to
   * is three fresh radio buttons over an answer that has already been given, gone into the
   * ledger, and possibly been repeated to the farmer.
   *
   * The server refuses a second write regardless. This is so a Mait never gets as far as
   * believing they changed something: an answer that appears to save and then does not is
   * worse than one that was never offered.
   */
  if (check.outcome) {
    const answer = t(
      {
        pregnant: 'pd.pregnant',
        not_pregnant: 'pd.notPregnant',
        unsure: 'pd.unsure',
        declined: 'pd.declined',
      }[check.outcome] ?? 'pd.unsure',
    );
    // A refusal is grey with the unsure results rather than red with the failures. Nothing
    // went wrong and nobody is at fault — the animal was simply not examined.
    const tone =
      check.outcome === 'pregnant' ? 'good' : check.outcome === 'not_pregnant' ? 'bad' : 'unsure';

    return (
      <View style={styles.root}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
          {heroTop(onBack)}
          <Text style={styles.heroTitle}>{t('pd.recorded')}</Text>
          <Text style={styles.heroSubtitle} numberOfLines={2}>
            {subject}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>{t('pd.found')}</Text>

          <View style={[styles.settled, styles[`settled_${tone}`]]} testID="pd-recorded">
            <View style={[styles.settledIcon, styles[`settledIcon_${tone}`]]}>
              <Ionicons
                name={
                  check.outcome === 'pregnant'
                    ? 'checkmark'
                    : check.outcome === 'not_pregnant'
                      ? 'close'
                      : check.outcome === 'declined'
                        ? 'hand-left-outline'
                        : 'help'
                }
                size={20}
                color={colors.surface}
              />
            </View>
            <View style={styles.choiceBody}>
              <Text style={styles.choiceLabel}>{answer}</Text>
              <Text style={styles.choiceHint}>
                {check.checked_at
                  ? t('pd.recordedOn', { date: shortDate(check.checked_at.slice(0, 10)) })
                  : ''}
              </Text>
            </View>
          </View>

          {/* The two things a farmer actually asks about afterwards. */}
          {!!check.calving_due_on && (
            <Text style={styles.settledNote} testID="pd-recorded-calving">
              {t('pd.recordedCalving', { date: shortDate(check.calving_due_on) })}
            </Text>
          )}
          {check.outcome === 'unsure' && (
            <Text style={styles.settledNote}>{t('pd.recordedRecheck')}</Text>
          )}
          {check.outcome === 'declined' && (
            <Text style={styles.settledNote} testID="pd-recorded-declined">
              {t('pd.recordedDeclined')}
            </Text>
          )}

          {/* Why there is nothing to tap, said rather than left to be discovered. */}
          <View style={styles.locked} testID="pd-locked">
            <Ionicons name="lock-closed-outline" size={17} color={colors.textMuted} />
            <Text style={styles.lockedText}>{t('pd.cannotChange')}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  /**
   * Stage one: the owner's answer.
   *
   * This is the question the Mait asks at the gate, and the screen asks it in the same order.
   * "Yes" is a way through and nothing is written by it. "No" is the record — so it is chosen
   * here and committed at the foot, the same two taps every other answer on this screen takes,
   * because it is just as final and just as uneditable afterwards.
   */
  if (consented !== true) {
    return (
      <View style={styles.root}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
          {heroTop(onBack)}

          <Text style={styles.heroTitle}>{t('pd.consentAsk')}</Text>
          <Text style={styles.heroSubtitle} numberOfLines={2}>
            {subject}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>{t('pd.consentLabel')}</Text>

          <Choice
            icon="checkmark"
            role="button"
            label={t('pd.consentYes')}
            hint={t('pd.consentYesHint')}
            selected={false}
            onPress={() => setConsented(true)}
            testID="pd-consent-yes"
          />
          <Choice
            icon="hand-left-outline"
            tone="plain"
            label={t('pd.consentNo')}
            hint={t('pd.consentNoHint')}
            selected={declining}
            onPress={() => setConsented(false)}
            testID="pd-consent-no"
          />

          {/* What recording a refusal actually does, before it is done. A Mait who thinks it
              writes the animal off will avoid the button and leave the row open instead. */}
          {declining && (
            <View style={styles.aside} testID="pd-decline-note">
              <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
              <Text style={styles.asideText}>{t('pd.declineWhatHappens')}</Text>
            </View>
          )}
        </ScrollView>

        {/* No foot at all until an answer is chosen. A disabled button under two live choices
            is a third thing to read and reason about on a screen that asks one question. */}
        {declining && (
          <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={() => onSave('declined', null)}
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              testID="pd-decline-save"
            >
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <>
                  <Text style={styles.ctaLabel}>{t('pd.declineSave')}</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.surface} />
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        {heroTop(() => setConsented(null))}

        <Text style={styles.heroTitle}>{t('pd.ask')}</Text>
        <Text style={styles.heroSubtitle} numberOfLines={2}>
          {subject}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Before the findings, not after them. The Mait says this to the owner while the
            animal is still standing there, and a price produced once the work is done is a
            bill rather than a quote. */}
        <Text style={styles.sectionLabel}>{t('pd.chargeLabel')}</Text>
        <View style={styles.charge} testID="pd-charge">
          <View style={styles.chargeIcon}>
            <Ionicons
              name={settlement.kind === 'nonMember' ? 'cash-outline' : 'receipt-outline'}
              size={20}
              color={settlement.kind === 'unpriced' ? colors.secondaryPressed : colors.primaryDark}
            />
          </View>
          <View style={styles.chargeBody}>
            <Text style={styles.chargeTitle}>{chargeLine}</Text>
            <Text style={styles.chargeHint}>{chargeHint}</Text>
          </View>
        </View>

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

  // -- a result already found --------------------------------------------------------------
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  settled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  settled_good: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  settled_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  settled_unsure: { backgroundColor: colors.background, borderColor: colors.border },
  settledIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settledIcon_good: { backgroundColor: colors.primary },
  settledIcon_bad: { backgroundColor: colors.error },
  settledIcon_unsure: { backgroundColor: colors.textMuted },
  settledNote: { ...typography.caption, color: colors.textMuted, marginTop: spacing[3] },
  locked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockedText: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },

  charge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chargeIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  chargeBody: { flex: 1 },
  chargeTitle: { ...typography.bodyStrong, color: colors.ink },
  chargeHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

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
  // Chosen, but not an achievement. Green is this app's colour for a result that went well,
  // and a refusal is neither good nor bad — it is a visit that did not happen.
  choiceOnPlain: { backgroundColor: colors.background, borderColor: colors.textMuted },
  choiceIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  choiceIconOn: { backgroundColor: colors.primary },
  choiceIconOnPlain: { backgroundColor: colors.textMuted },
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
  tickOnPlain: { backgroundColor: colors.textMuted, borderColor: colors.textMuted },

  // What the chosen answer is about to do. Same construction as the locked notice below it,
  // so the two things this screen says out loud are said the same way.
  aside: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginTop: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  asideText: { ...typography.caption, color: colors.textMuted, flex: 1, lineHeight: 18 },

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
