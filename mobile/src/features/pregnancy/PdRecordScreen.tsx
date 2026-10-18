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
 *
 * **And a line of their own, on whichever answer they gave.** Three radio buttons are the
 * whole finding, and a finding is not the whole visit: the animal was thin, the owner said
 * she bulled again on the 5th, the horn felt full but early. That is what a vet reads before
 * the recheck and what an office reads when a farmer argues, and until now the only place for
 * it was a Mait's memory. It is optional on purpose — a remark demanded on every check is a
 * remark that says "ok" — and it is offered only after an answer is chosen, so it is a note
 * *about that answer* rather than a fourth question asked before the first is settled. The
 * server has carried the field all along (`PregnancyCheck.note`); nothing sent one.
 */

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import type { PdOutcome, PregnancyCheck } from '@api/types';
import { settlementFor } from './charge';
import FlowCamera from '@/features/aiFlow/FlowCamera';
import { useRevealOnFocus } from '@/features/aiFlow/components';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

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

/**
 * Each answer's colour, the same the list's marks wear: green pregnant, red not, slate not
 * sure or refused. Always drawn in it — the glyph on a solid chip, the card in its wash — and
 * chosen is the colour's full border and a filled tick.
 */
type ChoiceTone = 'good' | 'bad' | 'unsure' | 'plain';

const PAINT: Record<
  ChoiceTone | 'info' | 'warm',
  { solid: string; word: string; wash: string; edge: string }
> = {
  good: {
    solid: colors.primary,
    word: colors.primaryDark,
    wash: colors.primaryWash,
    edge: green[300],
  },
  bad: { solid: colors.error, word: colors.error, wash: colors.errorWash, edge: colors.error },
  unsure: { solid: ink[400], word: ink[600], wash: ink[50], edge: ink[100] },
  plain: { solid: ink[500], word: ink[600], wash: ink[50], edge: ink[100] },
  info: { solid: colors.info, word: colors.info, wash: colors.infoWash, edge: colors.info },
  warm: { solid: yolk[500], word: yolk[800], wash: colors.secondaryWash, edge: yolk[300] },
};

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
  /** A refusal is not a finding, so it is slate rather than a result's colour. */
  tone?: ChoiceTone;
}): React.JSX.Element {
  const paint = PAINT[tone];
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { selected } : undefined}
      accessibilityLabel={`${label}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: paint.wash, borderColor: selected ? paint.solid : paint.edge },
        selected && styles.choiceOn,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <View style={[styles.choiceIcon, { backgroundColor: paint.solid }]}>
        <Ionicons name={icon} size={20} color={colors.surface} />
      </View>

      <View style={styles.choiceBody}>
        <Text style={styles.choiceLabel}>{label}</Text>
        {/* What this answer *does*, before it is chosen. */}
        <Text style={[styles.choiceHint, { color: paint.word }]} numberOfLines={2}>
          {hint}
        </Text>
      </View>

      {/* A filled tick rather than a dot: this is read in sunlight, and a ring with a smaller
          ring inside it is not a shape that survives that. */}
      {role === 'radio' ? (
        <View
          style={[
            styles.tick,
            { borderColor: paint.solid },
            selected && { backgroundColor: paint.solid },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={colors.surface} />}
        </View>
      ) : (
        // An arrow, not a tick: this one goes somewhere rather than marking an answer.
        <View style={[styles.go, { borderColor: paint.solid }]}>
          <Ionicons name="chevron-forward" size={16} color={paint.word} />
        </View>
      )}
    </Pressable>
  );
}

/** A labelled section heading with its glyph on a small chip. */
function Section({
  icon,
  label,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: keyof typeof PAINT;
}): React.JSX.Element {
  return (
    <View style={styles.sectionRow}>
      <View style={[styles.sectionChip, { backgroundColor: PAINT[tone].solid }]}>
        <Ionicons name={icon} size={13} color={colors.surface} />
      </View>
      <Text style={[styles.sectionLabel, { color: PAINT[tone].word }]}>{label}</Text>
    </View>
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
  onSave: (outcome: PdOutcome, photoUri: string | null, note: string) => void;
  /** Held by the shell, so a photograph survives this screen being rebuilt. */
  photoUri: string | null;
  onPhoto: (uri: string | null) => void;
  busy?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [outcome, setOutcome] = useState<PdOutcome | null>(null);
  /**
   * The Mait's own line about what they found. Kept as typed and trimmed once, on save.
   *
   * Not cleared when the answer is changed: a Mait who wrote "bulled again on the 5th" and
   * then moved from Not sure to Not pregnant wrote it about the animal, not about the radio
   * button, and retyping it is how it stops being written at all.
   */
  const [remark, setRemark] = useState('');
  const [camera, setCamera] = useState(false);
  // Stage one until the owner has answered. `null` is "not asked yet" and is different from
  // `false`: one is a screen waiting for a tap, the other is a refusal about to be recorded.
  const [consented, setConsented] = useState<boolean | null>(null);

  // The remark box is the last thing on a scrolling body with a button pinned under it, so
  // on a short handset the keyboard opens straight over it. Same answer the capture flow's
  // forms use, rather than a second one written here.
  const { scroller, content, overlap: keyboard, api: scrollApi } = useRevealOnFocus();
  // The wrapper, not the box: the label has to come up with the field it names, or a Mait
  // sees an unlabelled box appear over the keyboard.
  const remarkRef = useRef<View>(null);

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
  // Blue: a member's deduction is a fact the dairy settles. Yolk: cash to collect in the yard,
  // or no price set — both something the Mait has to act on.
  const chargeTone: 'info' | 'warm' = settlement.kind === 'member' ? 'info' : 'warm';
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
          <Section icon="clipboard" label={t('pd.found')} tone={tone} />

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
            <View style={[styles.note, styles.note_good]}>
              <Ionicons name="calendar" size={15} color={colors.primaryDark} />
              <Text
                style={[styles.noteText, { color: colors.primaryDark }]}
                testID="pd-recorded-calving"
              >
                {t('pd.recordedCalving', { date: shortDate(check.calving_due_on) })}
              </Text>
            </View>
          )}
          {check.outcome === 'unsure' && (
            <View style={[styles.note, styles.note_warm]}>
              <Ionicons name="repeat" size={15} color={yolk[800]} />
              <Text style={[styles.noteText, { color: yolk[800] }]}>{t('pd.recordedRecheck')}</Text>
            </View>
          )}
          {check.outcome === 'declined' && (
            <View style={[styles.note, styles.note_slate]}>
              <Ionicons name="hand-left" size={15} color={ink[600]} />
              <Text style={[styles.noteText, { color: ink[600] }]} testID="pd-recorded-declined">
                {t('pd.recordedDeclined')}
              </Text>
            </View>
          )}

          {/* What the Mait wrote at the time, read back verbatim. This is the half of the
              record a farmer's question is usually actually about — three radio buttons
              cannot say the animal was thin or that she bulled again on the 5th. */}
          {!!check.note && (
            <View style={styles.remarkRead} testID="pd-recorded-remark">
              <Section icon="chatbubble-ellipses" label={t('pd.recordedRemark')} tone="info" />
              <Text style={styles.remarkReadText}>{check.note}</Text>
            </View>
          )}

          {/* Why there is nothing to tap, said rather than left to be discovered. */}
          <View style={styles.locked} testID="pd-locked">
            <View style={[styles.sectionChip, styles.lockChip]}>
              <Ionicons name="lock-closed" size={14} color={colors.surface} />
            </View>
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
          <Section icon="chatbubbles" label={t('pd.consentLabel')} tone="info" />

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
            icon="hand-left"
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
              <Ionicons name="information-circle" size={18} color={colors.info} />
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
              onPress={() => onSave('declined', null, '')}
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

      <ScrollView
        ref={scroller}
        innerViewRef={content}
        /* A keyboard's worth of room under the content while one is up, so the remark box at
           the foot can actually be scrolled clear of it. */
        contentContainerStyle={keyboard ? [styles.body, { paddingBottom: keyboard }] : styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Before the findings, not after them. The Mait says this to the owner while the
            animal is still standing there, and a price produced once the work is done is a
            bill rather than a quote. */}
        <Section icon="cash" label={t('pd.chargeLabel')} tone={chargeTone} />
        <View
          style={[
            styles.charge,
            { backgroundColor: PAINT[chargeTone].wash, borderColor: PAINT[chargeTone].edge },
          ]}
          testID="pd-charge"
        >
          <View style={[styles.chargeIcon, { backgroundColor: PAINT[chargeTone].solid }]}>
            <Ionicons
              name={
                settlement.kind === 'nonMember'
                  ? 'cash'
                  : settlement.kind === 'member'
                    ? 'receipt'
                    : 'alert'
              }
              size={20}
              color={chargeTone === 'warm' ? colors.ink : colors.surface}
            />
          </View>
          <View style={styles.chargeBody}>
            <Text style={styles.chargeTitle}>{chargeLine}</Text>
            <Text style={[styles.chargeHint, { color: PAINT[chargeTone].word }]}>{chargeHint}</Text>
          </View>
        </View>

        <Section icon="medkit" label={t('pd.found')} tone="good" />

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
          tone="bad"
          label={t('pd.notPregnant')}
          hint={t('pd.notPregnantHint')}
          selected={outcome === 'not_pregnant'}
          onPress={() => setOutcome('not_pregnant')}
          testID="pd-outcome-not-pregnant"
        />
        <Choice
          icon="help"
          tone="unsure"
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
            photoUri && styles.photoTaken,
            needsPhoto && styles.photoRequired,
            pressed && styles.pressed,
          ]}
          testID="pd-photo"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View
              style={[
                styles.photoIcon,
                { backgroundColor: needsPhoto ? colors.error : colors.info },
              ]}
            >
              <Ionicons name="camera" size={20} color={colors.surface} />
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

          <View
            style={[
              styles.photoAction,
              {
                backgroundColor: needsPhoto
                  ? colors.error
                  : photoUri
                    ? colors.primary
                    : colors.info,
              },
            ]}
          >
            <Text style={styles.photoActionLabel}>
              {photoUri ? t('pd.photoRetake') : t('pd.photoTake')}
            </Text>
          </View>
        </Pressable>

        {/* Only once there is an answer to remark on. Before that it is a fourth question
            asked ahead of the first, and a Mait reading four things chooses none of them. */}
        {!!outcome && (
          <View ref={remarkRef} style={styles.remark} testID="pd-remark">
            <Section icon="create" label={t('pd.remarkLabel')} tone="plain" />
            <TextInput
              style={styles.remarkInput}
              value={remark}
              onChangeText={setRemark}
              /* Written for the answer that was given. "Bulled again on the 5th" belongs to a
                 not-pregnant and would be nonsense under a pregnant, and a placeholder that
                 fits is the difference between a remark and a blank. */
              placeholder={t(`pd.remarkHint_${outcome}`, { defaultValue: t('pd.remarkHintAny') })}
              placeholderTextColor={colors.textDisabled}
              accessibilityLabel={t('pd.remarkLabel')}
              onFocus={() => scrollApi.reveal(remarkRef.current)}
              multiline
              /* The column is 255 (`PregnancyCheck.note`). Stopped here rather than truncated
                 there, so nothing a Mait typed is silently dropped between the two. */
              maxLength={255}
              testID="pd-remark-input"
            />
            <Text style={styles.remarkFoot}>{t('pd.remarkOptional')}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy }}
          disabled={!canSave}
          onPress={() => outcome && onSave(outcome, photoUri, remark.trim())}
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  sectionChip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockChip: { backgroundColor: ink[500] },
  sectionLabel: { ...typography.label, letterSpacing: 0.5 },
  settled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  settled_good: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  settled_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  settled_unsure: { backgroundColor: ink[50], borderColor: ink[300] },
  settledIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settledIcon_good: { backgroundColor: colors.primary },
  settledIcon_bad: { backgroundColor: colors.error },
  settledIcon_unsure: { backgroundColor: ink[400] },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  note_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  note_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  note_slate: { backgroundColor: ink[50], borderColor: ink[100] },
  noteText: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  lockedText: { ...typography.caption, color: ink[600], flex: 1, lineHeight: 18 },

  charge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  chargeIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chargeBody: { flex: 1 },
  chargeTitle: { ...typography.bodyStrong, color: colors.ink },
  chargeHint: { ...typography.caption, marginTop: 2 },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    padding: spacing[3],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  // Chosen: the colour's full border, drawn heavier, so the answer reads across the yard.
  choiceOn: { borderWidth: 2 },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceBody: { flex: 1 },
  choiceLabel: { ...typography.h3, color: colors.ink },
  choiceHint: { ...typography.caption, marginTop: 2 },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  go: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  // What the chosen answer is about to do: blue, a fact rather than a warning.
  aside: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginTop: spacing[2],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  asideText: { ...typography.caption, color: colors.info, flex: 1, lineHeight: 18 },

  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    marginTop: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  photoTaken: {
    borderStyle: 'solid',
    borderColor: green[300],
    backgroundColor: colors.primaryWash,
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
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 40, height: 40, borderRadius: radius.md },
  photoBody: { flex: 1 },
  photoTitle: { ...typography.bodyStrong, color: colors.ink },
  photoHint: { ...typography.caption, color: ink[600], marginTop: 2 },
  photoHintRequired: { color: colors.error },
  photoAction: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
  },
  photoActionLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // -- the Mait's own line -----------------------------------------------------------------
  remark: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  remarkInput: {
    ...typography.body,
    color: colors.ink,
    marginTop: spacing[2],
    // Tall enough for two lines before it grows, so a Mait can see it is a place to write a
    // sentence rather than a code.
    minHeight: MIN_TOUCH_TARGET,
    // Android centres a single line in a multiline box and leaves the text floating.
    textAlignVertical: 'top',
    padding: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[200],
    backgroundColor: colors.surface,
  },
  remarkFoot: { ...typography.caption, color: ink[500], marginTop: spacing[2] },
  remarkRead: {
    marginTop: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
  },
  remarkReadText: { ...typography.body, color: colors.ink, marginTop: spacing[2], lineHeight: 20 },

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
