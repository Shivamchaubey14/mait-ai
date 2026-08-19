/**
 * Step 2b â€” register a Non-Member in the field (SRS Â§6.3 step 2, Â§7 Compliance, M6).
 *
 * The mobile number is mandatory and validated here as well as server-side. Unlike members,
 * whose numbers come from SAP, this one is being typed by the Mait â€” and it is the only
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
 * Both faces of the card are photographed, as the evidence behind the number that was typed.
 * They are uploaded after the record exists rather than with it, so a village connection
 * dropping a JPEG costs a retry and not the whole form — and they are never read back to the
 * handset, which is told only that each face is on file.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateNonMemberMutation, useUploadNonMemberAadhaarMutation } from '@api/endpoints';
import { splitRejection } from '@api/problem';
import type { MPP, NonMember, Relation } from '@api/types';
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
  onCreated: (nonMember: NonMember) => void;
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
];

/** Which face of the card the camera is open for, or null when it is closed. */
type Face = 'front' | 'back';

/** 4+4+4, the way it is printed on the card and read aloud from it. */
function formatAadhaar(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export default function AddNonMemberScreen({ mpp, onCreated, onCancel }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [fatherHusband, setFatherHusband] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [address, setAddress] = useState('');
  const [aadhaar, setAadhaar] = useState('');
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

  const [createNonMember, { isLoading }] = useCreateNonMemberMutation();
  const [uploadAadhaar, { isLoading: uploading }] = useUploadNonMemberAadhaarMutation();

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);
  // Aadhaar is required here and nowhere else in the app. It is what the server checks against
  // the membership roll, and without it the non-member path would be a way to bill a member
  // in cash for a service her milk payment has already covered.
  //
  // Both faces of the card are required with it. An optional evidence field is one that is
  // always skipped, and a number with no card behind it is exactly the row nobody can settle
  // an argument with six months later. The relation is required for the same reason it was
  // added: "Sunita w/o Ram" and "Sunita d/o Ram" are two women, and a blank says which is
  // neither.
  const canSubmit =
    name.trim().length >= 2 &&
    isValidMobile &&
    aadhaar.length === 12 &&
    !!relation &&
    !!front &&
    !!back &&
    consent;

  const handleSubmit = async () => {
    setRefusal(null);
    setFieldErrors({});
    try {
      const created = await createNonMember({
        name: name.trim(),
        father_husband_name: fatherHusband.trim(),
        ...(relation ? { relation } : {}),
        mobile_no: mobileNo,
        address: address.trim(),
        aadhar_no: aadhaar,
        mpp: mpp.id,
        // The tick above the button, sent rather than merely enforced on the handset. It is
        // what stamps `consent_captured_at`, and a consent that exists only as a disabled
        // button is not a record of anything (SRS §7 Compliance).
        consent: true,
      }).unwrap();

      // She exists now. The card follows, and is allowed to fail: sending the Mait back to
      // re-enter five fields and re-photograph a document because a village dropped a JPEG
      // would be a worse answer than a record whose images can be retried from her detail.
      try {
        await uploadAadhaar({ id: created.id, front, back }).unwrap();
      } catch {
        // Deliberately swallowed — see above. The record is what the flow needs to go on.
      }

      onCreated(created);
    } catch (err) {
      // Server-side validation is the authority; surface its per-field messages rather than
      // a generic failure, so the Mait knows which box to fix — and say out loud anything
      // this form has no box for, rather than letting the tap look like nothing happened.
      const { fields, message } = splitRejection(err, OWNED_FIELDS, t('errors.generic'));
      setFieldErrors(fields);
      setRefusal(message);
    }
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
        busy: isLoading || uploading,
        testID: 'non-member-save',
      }}
      /* In the footer, not at the top of the body. This form is five fields and a consent
         tick, so a Mait tapping Save is looking at the bottom of a screen they have scrolled;
         a notice above the name field is off-screen at the exact moment it is needed, which
         is indistinguishable from the button having done nothing. */
      footerNote={
        refusal ? <FlowNotice tone="error" title={refusal} testID="non-member-error" /> : undefined
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
        onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
        error={fieldErrors.mobile_no?.[0]}
        keyboardType="number-pad"
        maxLength={10}
        testID="non-member-mobile"
      />

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
        onChangeText={text => setAadhaar(text.replace(/\D/g, '').slice(0, 12))}
        error={fieldErrors.aadhar_no?.[0]}
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
  consent: { ...typography.body, color: colors.info },
  consentBrand: { color: colors.primaryDark, fontFamily: typography.bodyStrong.fontFamily },

  cards: { flexDirection: 'row', gap: spacing[3] },
  cardsHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[2],
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
