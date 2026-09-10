/**
 * Step 2b — register a Non-Member in the field (SRS §6.3 step 2, §7 Compliance, M6).
 *
 * The mobile number is mandatory and validated here as well as server-side. Unlike members,
 * whose numbers come from SAP, this one is being typed by the Mait — and it is the only
 * channel for the payment authorisation OTP, so a wrong digit means the code goes to a
 * stranger and the event can never be completed.
 *
 * Consent is captured explicitly, and the CTA stays inert without it. This is personal data
 * collected outside the SAP membership process, so "they probably agreed" is not a record.
 *
 * Aadhaar is mandatory here and nowhere else in the app, and it is not being collected to
 * describe her. The server matches it against the membership roll — and against every
 * non-member already on file — before creating anything, because this is the one screen in
 * the product that ends with a Mait asking a farmer for cash. A member recorded as a
 * non-member is a farmer paying twice for a service her milk payment has already covered, and
 * a non-member registered twice is one who can be charged twice. She has no reason to query
 * either: she was asked, and she paid. The match is done on a keyed fingerprint server-side;
 * the app never holds a roster to search, and the number never comes back to the handset.
 *
 * **And it is asked while the number is being typed, not when Save is tapped.** That timing is
 * the whole value of it. By the time a Mait reaches the button they have already told the
 * farmer she is being registered as a non-member — and a non-member pays cash, in the yard,
 * now. A refusal that arrives at the end is a conversation that has to be taken back; one that
 * arrives on the twelfth digit is a Mait quietly going to look her up in the member roster
 * instead. Same rule, same sentence, from one implementation server-side (`identity.py`), so
 * the form cannot promise something the create then refuses.
 *
 * **Two checks, two different consequences.** The Aadhaar match *is* the same person, so it
 * stops the form. The mobile number is a question, not an answer — a mother and a daughter
 * share a handset, and one phone per household is ordinary — so it warns and lets the Mait
 * decide. Blocking on a shared number would refuse real registrations in exactly the villages
 * where sharing one is normal.
 *
 * Both faces of the card are photographed, as the evidence behind the number that was typed.
 * They are uploaded after the record exists rather than with it, so a village connection
 * dropping a JPEG costs a retry and not the whole form — and they are never read back to the
 * handset, which is told only that each face is on file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { registerNonMember } from '@api/capture';
import { useCheckFarmerIdentityMutation, useGetFarmerRosterQuery } from '@api/endpoints';
import { splitRejection } from '@api/problem';
import { clockTime } from '@api/queue';
import type { FarmerRosterRow, IdentityCheck, MPP, NonMember, Relation } from '@api/types';
import { colors, spacing, typography } from '@theme/tokens';

import FlowCamera from './FlowCamera';
import {
  CaptureTile,
  CheckboxRow,
  FlowLabel,
  FlowNotice,
  FlowScreen,
  FlowSpacer,
  LabelledField,
  RadioGroup,
} from './components';

interface Props {
  mpp: MPP;
  /**
   * The Mait's token, or null while the session is being restored.
   *
   * Passed in rather than read from the store, the way every other write in the flow gets it.
   */
  accessToken: string | null;
  /** Whether the handset has a connection, for saying plainly what is about to happen. */
  online: boolean;
  /**
   * Where the flow goes next, with the farmer it will carry.
   *
   * `queued` is true when nothing reached the server: she is registered on this handset and
   * her details are still to be checked against the membership roll. The screens after this
   * one are the same either way — this is so the Mait can be told the truth about it.
   */
  onCreated: (nonMember: NonMember, queued: boolean) => void;
  onCancel: () => void;
}

/**
 * The keys this form can put under a box of its own.
 *
 * Anything the server names outside this list is announced above the button instead. Keeping
 * it beside the fields rather than inferring it means adding a field without adding it here
 * fails loudly, not silently.
 */
const OWNED_FIELDS = [
  'name',
  'father_husband_name',
  'relation',
  'mobile_no',
  'address',
  'aadhar_no',
  'cattle_cows',
  'cattle_buffaloes',
  'daily_yield_litres',
];

/** Which face of the card the camera is open for, or null when it is closed. */
type Face = 'front' | 'back';

/** 4+4+4, the way it is printed on the card and read aloud from it. */
function formatAadhaar(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/**
 * How long to sit still before asking the server about a number.
 *
 * A Mait types twelve digits into the Aadhaar box, and asking on each one would be twelve
 * requests to answer a question that only has meaning once the last digit lands. This is long
 * enough that a normal run of typing produces one request, and short enough that the answer is
 * on screen before a thumb reaches the next field.
 */
const CHECK_AFTER_MS = 450;

/**
 * Ask, once the Mait stops typing, whether this identifier already belongs to somebody.
 *
 * `null` covers three different situations and the screen renders all three the same way,
 * which is correct: not enough digits yet, nothing found, and no signal to ask over. None of
 * them is a reason to say anything, and a form that announced "could not check" on every
 * keystroke in a village would train a Mait to ignore the one message that matters.
 *
 * A failure is deliberately silent for the same reason. The create is still the authority and
 * still refuses; this is the courtesy that gets the answer there earlier.
 */
function useIdentityCheck(value: string, ready: boolean, field: 'aadhar' | 'mobile') {
  const [check, { reset }] = useCheckFarmerIdentityMutation();
  const [found, setFound] = useState<IdentityCheck | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!ready) {
      setFound(null);
      return;
    }

    let alive = true;
    setAsking(true);
    const timer = setTimeout(async () => {
      try {
        const answer = await check(
          field === 'aadhar' ? { aadharNo: value } : { mobileNo: value },
        ).unwrap();
        // An explicit "no", with a reason. Anything else — a `200` from something that is not
        // this endpoint, a proxy's own page, a body that lost a field — is treated as nothing
        // found. This warning stops a registration and names a farmer, so it may only ever be
        // raised by an answer that actually said so.
        if (alive) {
          const refused = answer?.available === false && !!answer.detail;
          setFound(refused ? answer : null);
        }
      } catch {
        // No signal, or the server is unwell. Say nothing: the create still checks, and a
        // warning about the check itself is noise on top of a form that already works.
        if (alive) {
          setFound(null);
        }
      } finally {
        if (alive) {
          setAsking(false);
        }
      }
    }, CHECK_AFTER_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
      setAsking(false);
    };
  }, [value, ready, field, check]);

  const clear = useCallback(() => {
    setFound(null);
    reset();
  }, [reset]);

  return { found, asking, clear };
}

/**
 * The same duplicate question, asked of the handset's own copy of the books.
 *
 * The Aadhaar check needs the server and always will. This one does not: members' and
 * non-members' mobile numbers are already served to the app unmasked — a Mait has to be able
 * to ring a farmer — so a village with no signal can still be told that the number being typed
 * belongs to somebody at this collection point.
 *
 * It matters most exactly where the online check cannot run. A farmer registered offline is
 * one whose Aadhaar is validated hours later, after the cash has been taken, and this is what
 * catches the ordinary shape of that mistake before it happens: a Mait registering somebody
 * who is already on the books.
 *
 * A warning, never a refusal — one phone per household is normal, so it is a question put to
 * the Mait rather than an answer given to them.
 */
function rosterClash(roster: FarmerRosterRow[], mobileNo: string): FarmerRosterRow | null {
  // Guarded rather than trusted. What comes back here has been through a cache and, in a
  // village, quite possibly through a captive portal — and this runs on every keystroke in the
  // mobile box, so anything that is not a list must be nothing rather than a crash on the one
  // screen a farmer is waiting in front of.
  if (!Array.isArray(roster) || !/^[6-9]\d{9}$/.test(mobileNo)) {
    return null;
  }
  return roster.find(row => row?.mobile_no === mobileNo) ?? null;
}

export default function AddNonMemberScreen({
  mpp,
  accessToken,
  online,
  onCreated,
  onCancel,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [fatherHusband, setFatherHusband] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [address, setAddress] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  /**
   * Her herd, as she reports it. Kept as typed rather than as numbers.
   *
   * An empty box is "she was not asked", and a `number` state cannot hold that — it collapses
   * to 0, which is a different answer. The form no longer lets an unasked box through (see
   * `canSubmit`), so what this distinction now buys is an honest zero: a box holding "0" was
   * answered and a blank one was not, and only the first may be sent. Parsed once, on submit.
   */
  const [cows, setCows] = useState('');
  const [buffaloes, setBuffaloes] = useState('');
  const [litres, setLitres] = useState('');
  /** Unanswered until the Mait says. Nobody should guess between a father and a husband. */
  const [relation, setRelation] = useState<Relation | null>(null);
  /** Where the camera wrote each face of the card. */
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [camera, setCamera] = useState<Face | null>(null);
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  /** Whatever the refusal said that no box on this form can carry. */
  const [refusal, setRefusal] = useState<string | null>(null);

  // Split around the product name so it can be set apart inside the sentence. Done this way
  // rather than in three strings because the word sits in a different place in Hindi.
  const brand = t('brand.name');
  const [consentBefore, consentAfter] = useMemo(() => {
    const [head, ...rest] = t('aiFlow.consentToStoreDetails', { brand }).split(brand);
    return [head, rest.join(brand)];
  }, [brand, t]);

  const [saving, setSaving] = useState(false);

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);

  // Asked as the digits go in, so an answer arrives before the farmer is asked for money.
  const aadhaarCheck = useIdentityCheck(aadhaar, aadhaar.length === 12, 'aadhar');
  const mobileCheck = useIdentityCheck(mobileNo, isValidMobile, 'mobile');

  /**
   * This collection point's books, as the handset holds them.
   *
   * Read through the offline cache, so it answers in a village with no signal — which is the
   * only situation it exists for. The server's own answer is better and is preferred whenever
   * there is one; this is what stands in when there is not.
   */
  const { data: roster = [] } = useGetFarmerRosterQuery(mpp.mpp_code);
  const knownLocally = useMemo(
    () => (mobileCheck.found ? null : rosterClash(roster, mobileNo)),
    [roster, mobileNo, mobileCheck.found],
  );
  // Aadhaar is required here and nowhere else in the app. It is what the server checks against
  // the membership roll, and without it the non-member path would be a way to bill a member
  // in cash for a service her milk payment has already covered.
  //
  // Both faces of the card are required with it. An optional evidence field is one that is
  // always skipped, and a number with no card behind it is exactly the row nobody can settle
  // an argument with six months later. The relation is required for the same reason it was
  // added: "Sunita w/o Ram" and "Sunita d/o Ram" are two women, and a blank says which is
  // neither.
  //
  // The herd and the milk are required too. They were optional, and an optional box on the
  // one screen that registers a farmer the dairy has no other file on is a box that is
  // always empty — which left the platform with non-members it could say nothing about: not
  // how many animals are behind the round, not what the village yields, not whether a
  // household is worth a second visit. Asking is two questions in a conversation the Mait is
  // already having. Zero is a legitimate answer to any of them and is typed as "0"; what is
  // no longer accepted is silence.
  const herdAnswered = cows.trim() !== '' && buffaloes.trim() !== '';
  // She is being registered so her animal can be inseminated, so a herd of nothing at all is
  // not an answer — it is the fastest way past two boxes. One of the two must be a real head
  // count; either on its own may be zero.
  const keepsAnimals = herdAnswered && Number(cows) + Number(buffaloes) > 0;
  const canSubmit =
    name.trim().length >= 2 &&
    isValidMobile &&
    aadhaar.length === 12 &&
    // She is somebody the platform already knows, and registering her here is the mistake
    // this screen exists to prevent. The mobile warning deliberately does *not* appear in
    // this list — see the note at the head of the file.
    //
    // A check still in flight is deliberately not in it either. Disabling the button while one
    // runs would give the Mait a dead button for half a second after the last digit, to guard
    // a case the create already guards: the server is the authority and refuses her anyway.
    // This is a courtesy that arrives earlier, not a second gate.
    !aadhaarCheck.found &&
    !!relation &&
    !!front &&
    !!back &&
    keepsAnimals &&
    // Milk is asked of the household, not of the animal being served: a cow in calf is dry,
    // and "0" here is both ordinary and worth recording.
    litres.trim() !== '' &&
    consent;

  /**
   * Register her — on the server if it can be reached, on the handset if it cannot.
   *
   * The offline path is a decision the business made rather than a convenience: a Mait who
   * meets an unregistered farmer in a village with no signal can now serve her, and her
   * details are checked against the membership roll when the queue drains. The screen says so
   * out loud above the button, because what follows this step is the Mait asking her for cash.
   *
   * Her card goes with her, queued as its own job. It is the evidence behind the number that
   * was typed and it must not be lost with the network.
   */
  const handleSubmit = async () => {
    setRefusal(null);
    setFieldErrors({});
    setSaving(true);

    const outcome = await registerNonMember(
      {
        name: name.trim(),
        father_husband_name: fatherHusband.trim(),
        ...(relation ? { relation } : {}),
        mobile_no: mobileNo,
        address: address.trim(),
        aadhar_no: aadhaar,
        // Required by the button above, so these are answers rather than defaults. Still
        // written defensively: a blank must never be sent as 0, because the server cannot
        // tell that zero from one somebody meant.
        ...(cows.trim() ? { cattle_cows: Number(cows) } : {}),
        ...(buffaloes.trim() ? { cattle_buffaloes: Number(buffaloes) } : {}),
        ...(litres.trim() ? { daily_yield_litres: litres.trim() } : {}),
        mpp: mpp.id,
        // The tick above the button, sent rather than merely enforced on the handset. It is
        // what stamps `consent_captured_at`, and a consent that exists only as a disabled
        // button is not a record of anything (SRS §7 Compliance).
        consent: true,
      },
      // Enough of her for the flow to carry and for the waiting list to name her. The rest is
      // what the server fills in.
      {
        name: name.trim(),
        father_husband_name: fatherHusband.trim(),
        relation: relation ?? '',
        mobile_no: mobileNo,
        address: address.trim(),
        // Masked here the same way the server masks it, because the flow shows it back and
        // the full number has no business travelling on into the rest of the app.
        masked_aadhar: `XXXX XXXX ${aadhaar.slice(-4)}`,
        aadhar_front_captured: !!front,
        aadhar_back_captured: !!back,
        mpp: mpp.id,
        created_by_mait: 0,
        created_at: new Date().toISOString(),
      },
      accessToken,
      { front, back },
      {
        farmer: name.trim(),
        kind: 'nonMember',
        at: clockTime(),
        kindOfRow: 'registration',
      },
    );
    setSaving(false);

    if (outcome.nonMember) {
      onCreated(outcome.nonMember, outcome.queued);
      return;
    }

    // The server considered her and said no — nearly always an Aadhaar already on file. That
    // is a fact about who she is rather than a network problem, so it is shown here and the
    // registration is not queued. Its per-field messages go under the boxes they belong to,
    // and anything this form has no box for is said against the button rather than dropped.
    const { fields, message } = splitRejection(
      { data: outcome.problemBody },
      OWNED_FIELDS,
      t('errors.generic'),
    );
    setFieldErrors(fields);
    setRefusal(message || outcome.problem || t('errors.generic'));
  };

  if (camera) {
    return (
      <FlowCamera
        instruction={camera === 'front' ? t('aiFlow.frameCardFront') : t('aiFlow.frameCardBack')}
        permissionBody={t('aiFlow.aadhaarPhotoBody')}
        guide="card"
        testIDPrefix={`aadhaar-camera-${camera}`}
        onCaptured={uri => {
          (camera === 'front' ? setFront : setBack)(uri);
          setCamera(null);
        }}
        onCancel={() => setCamera(null)}
      />
    );
  }

  return (
    <FlowScreen
      step={2}
      title={t('aiFlow.newNonMember')}
      subtitle={t('aiFlow.newNonMemberSubtitle')}
      onBack={onCancel}
      cta={{
        label: t('aiFlow.saveAndContinue'),
        onPress: handleSubmit,
        disabled: !canSubmit,
        busy: saving,
        testID: 'non-member-save',
      }}
      /* In the footer, not at the top of the body. This form is five fields and a consent
         tick, so a Mait tapping Save is looking at the bottom of a screen they have scrolled;
         a notice above the name field is off-screen at the exact moment it is needed, which
         is indistinguishable from the button having done nothing. */
      footerNote={
        refusal ? (
          <FlowNotice tone="error" title={refusal} testID="non-member-error" />
        ) : !online ? (
          /* Said before the button, not after it. The next thing that happens on this flow is
             the Mait asking her for cash, and with no signal her details cannot be checked
             against the membership roll until the queue drains. That is a real difference and
             the person about to ask for money is the person who should know about it. */
          <FlowNotice
            tone="info"
            title={t('aiFlow.registerOfflineTitle')}
            body={t('aiFlow.registerOfflineBody')}
            icon="cloud-offline-outline"
            testID="non-member-offline"
          />
        ) : undefined
      }
    >
      <LabelledField
        label={t('aiFlow.farmerName')}
        tone="primary"
        icon="person-outline"
        placeholder={t('aiFlow.farmerNameHint')}
        value={name}
        onChangeText={setName}
        error={fieldErrors.name?.[0]}
        autoCapitalize="words"
        testID="non-member-name"
      />

      {/* Two women in one village share a first name more often than not, and this is the
          line that tells them apart on the second visit. */}
      <LabelledField
        label={t('aiFlow.fatherHusbandName')}
        tone="primary"
        icon="people-outline"
        placeholder={t('aiFlow.fatherHusbandHint')}
        value={fatherHusband}
        onChangeText={setFatherHusband}
        error={fieldErrors.father_husband_name?.[0]}
        autoCapitalize="words"
        testID="non-member-father-husband"
      />

      {/* Whose name that was. Asked here rather than folded into the label, because the
          column it fills has held both since SAP, and a record that cannot say which is a
          record that cannot tell a daughter from a wife. */}
      <RadioGroup
        options={[
          { value: 'father', label: t('aiFlow.relationFather') },
          { value: 'husband', label: t('aiFlow.relationHusband') },
        ]}
        value={relation}
        onChange={setRelation}
        testID="non-member-relation"
      />
      {!!fieldErrors.relation?.[0] && (
        <Text style={styles.relationError}>{fieldErrors.relation[0]}</Text>
      )}

      <LabelledField
        label={t('auth.mobileNumber')}
        tone="info"
        icon="call-outline"
        placeholder={t('aiFlow.tenDigits')}
        hint={t('aiFlow.mobileUsedForOtp')}
        value={mobileNo}
        onChangeText={text => {
          setMobileNo(text.replace(/\D/g, '').slice(0, 10));
          mobileCheck.clear();
        }}
        error={fieldErrors.mobile_no?.[0]}
        keyboardType="number-pad"
        maxLength={10}
        testID="non-member-mobile"
      />

      {/* Under the field, and it does not stop the form. One phone per household is ordinary,
          so this is a question put to the Mait — go and look, or carry on because it really is
          a different woman — rather than an answer given to them. */}
      {(!!mobileCheck.found || !!knownLocally) && (
        <View style={styles.warning} testID="non-member-mobile-warning">
          <FlowNotice
            tone="accent"
            title={t('aiFlow.numberAlreadyOnFile')}
            /* The server's sentence where there is one, and the handset's own where there is
               not. The offline one is the case this matters most in: a farmer registered with
               no signal has her Aadhaar checked hours later, after the cash, so catching her
               by her number *now* is what stops the mistake rather than reporting it. */
            body={
              mobileCheck.found?.detail ??
              t(
                knownLocally?.kind === 'member'
                  ? 'aiFlow.numberIsAMembers'
                  : 'aiFlow.numberIsANonMembers',
                { name: knownLocally?.name ?? '' },
              )
            }
          />
        </View>
      )}

      <LabelledField
        label={t('aiFlow.address')}
        tone="accent"
        icon="home-outline"
        placeholder={t('aiFlow.addressHint')}
        value={address}
        onChangeText={setAddress}
        error={fieldErrors.address?.[0]}
        testID="non-member-address"
      />

      {/* Required, and it is the only field here that is doing more than describing her: the
          server checks it against the membership roll, and against every non-member already
          registered, before creating anything. The number is stored encrypted and comes back
          masked — it never returns to the handset in full. */}
      <LabelledField
        label={t('aiFlow.aadhaar')}
        tone="info"
        icon="card-outline"
        hint={t('aiFlow.aadhaarHint')}
        placeholder={t('aiFlow.aadhaarPlaceholder')}
        value={formatAadhaar(aadhaar)}
        onChangeText={text => {
          setAadhaar(text.replace(/\D/g, '').slice(0, 12));
          // Whatever it said was about the old number. Cleared on the keystroke rather than
          // when the next answer lands, so a warning can never sit under a number it is not
          // about — which is the one way this check could mislead rather than help.
          aadhaarCheck.clear();
        }}
        /* The server's own sentence, under the box it is about. It names her, because the
           Mait's next move is to go and find her in the member roster and "already
           registered" would leave them guessing which farmer. */
        error={aadhaarCheck.found?.detail ?? fieldErrors.aadhar_no?.[0]}
        keyboardType="number-pad"
        maxLength={14} // twelve digits plus two grouping spaces
        testID="non-member-aadhaar"
      />

      {/* The card behind the number. Both faces, side by side, because they are one job —
          stacked down the page the second one reads as an afterthought and gets skipped. */}
      <FlowLabel>{t('aiFlow.aadhaarCard')}</FlowLabel>
      <View style={styles.cards}>
        <CaptureTile
          label={t('aiFlow.cardFront')}
          hint={t('aiFlow.tapToPhotograph')}
          uri={front}
          onPress={() => setCamera('front')}
          testID="non-member-aadhaar-front"
        />
        <CaptureTile
          label={t('aiFlow.cardBack')}
          hint={t('aiFlow.tapToPhotograph')}
          uri={back}
          onPress={() => setCamera('back')}
          testID="non-member-aadhaar-back"
        />
      </View>
      <Text style={styles.cardsHint}>{t('aiFlow.aadhaarCardHint')}</Text>

      {/* What she keeps and what it gives. Asked, not offered: this is the only record the
          dairy will ever hold of the herd behind a farmer who is not on the membership roll,
          and left optional it was left blank. The hint under the row says a zero is welcome,
          so the way past a box a Mait cannot answer is to ask her, not to invent a number. */}
      <FlowLabel>{t('aiFlow.herd')}</FlowLabel>
      <View style={styles.herd}>
        <View style={styles.herdField}>
          <LabelledField
            label={t('aiFlow.cows')}
            tone="accent"
            icon="egg-outline"
            placeholder="0"
            value={cows}
            onChangeText={text => setCows(text.replace(/\D/g, '').slice(0, 3))}
            error={fieldErrors.cattle_cows?.[0]}
            keyboardType="number-pad"
            maxLength={3}
            testID="non-member-cows"
          />
        </View>
        <View style={styles.herdField}>
          <LabelledField
            label={t('aiFlow.buffaloes')}
            tone="accent"
            icon="egg-outline"
            placeholder="0"
            value={buffaloes}
            onChangeText={text => setBuffaloes(text.replace(/\D/g, '').slice(0, 3))}
            error={fieldErrors.cattle_buffaloes?.[0]}
            keyboardType="number-pad"
            maxLength={3}
            testID="non-member-buffaloes"
          />
        </View>
      </View>
      {/* Under the pair, because it answers both of them: the box a Mait is stuck on is the
          one for the kind of animal she keeps none of. Said once rather than as a hint on
          each field, where it would read twice and be read neither time. */}
      <Text style={styles.herdHint}>{t('aiFlow.herdRequiredHint')}</Text>

      <LabelledField
        label={t('aiFlow.dailyMilk')}
        tone="info"
        icon="water-outline"
        hint={t('aiFlow.dailyMilkHint')}
        placeholder="0"
        value={litres}
        // One decimal point, digits either side. Half a litre is an ordinary answer; a second
        // point is a typo the server would refuse after the Mait had already walked away.
        onChangeText={text =>
          setLitres(
            text
              .replace(/[^\d.]/g, '')
              .replace(/(\..*)\./g, '$1')
              .slice(0, 6),
          )
        }
        error={fieldErrors.daily_yield_litres?.[0]}
        keyboardType="decimal-pad"
        maxLength={6}
        testID="non-member-litres"
      />

      <CheckboxRow
        checked={consent}
        onToggle={() => setConsent(value => !value)}
        testID="non-member-consent"
      >
        {/* The brand is set in green inside the sentence, because the farmer is being told
            who is keeping her details, and that is the word she should catch. */}
        <Text style={styles.consent}>
          {consentBefore}
          <Text style={styles.consentBrand}>{brand}</Text>
          {consentAfter}
        </Text>
      </CheckboxRow>

      <FlowSpacer />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // The field above carries its own bottom margin, so this pulls up against it — under a gap
  // it would read as belonging to the address field below rather than to the number above.
  warning: { marginTop: -spacing[3], marginBottom: spacing[4] },
  consent: { ...typography.body, color: colors.info },
  consentBrand: { color: colors.primaryDark, fontFamily: typography.bodyStrong.fontFamily },

  cards: { flexDirection: 'row', gap: spacing[3] },
  // Side by side, because they are one question asked twice — stacked, the second reads as a
  // separate field and gets left blank.
  herd: { flexDirection: 'row', gap: spacing[3] },
  herdField: { flex: 1 },
  cardsHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[2],
    marginBottom: spacing[4],
  },
  // The pair above carries its own bottom margin, so this pulls up against it — under a gap
  // it would read as a hint belonging to the milk field below rather than to the two boxes
  // it answers.
  herdHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing[3],
    marginBottom: spacing[4],
  },
  // The radio pair carries its own bottom margin, so this sits against it rather than under
  // a gap that would read as the message belonging to the field below.
  relationError: {
    ...typography.caption,
    color: colors.error,
    marginTop: -spacing[3],
    marginBottom: spacing[4],
  },
});
