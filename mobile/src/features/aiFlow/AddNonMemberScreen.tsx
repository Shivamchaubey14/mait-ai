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
 * describe her. The server matches it against the membership roll before creating anything,
 * because this is the one screen in the product that ends with a Mait asking a farmer for
 * cash — and a member recorded as a non-member is a farmer paying twice for a service her
 * milk payment has already covered. She has no reason to query it: she was asked, and she
 * paid. The match is done on a keyed fingerprint server-side; the app never holds a member
 * list to search, and the number never comes back to the handset.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateNonMemberMutation } from '@api/endpoints';
import type { MPP, NonMember, ProblemDetails } from '@api/types';
import { colors, typography } from '@theme/tokens';

import { CheckboxRow, FlowNotice, FlowScreen, FlowSpacer, LabelledField } from './components';

interface Props {
  mpp: MPP;
  onCreated: (nonMember: NonMember) => void;
  onCancel: () => void;
}

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
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  // Split around the product name so it can be set apart inside the sentence. Done this way
  // rather than in three strings because the word sits in a different place in Hindi.
  const brand = t('brand.name');
  const [consentBefore, consentAfter] = useMemo(() => {
    const [head, ...rest] = t('aiFlow.consentToStoreDetails', { brand }).split(brand);
    return [head, rest.join(brand)];
  }, [brand, t]);

  const [createNonMember, { isLoading }] = useCreateNonMemberMutation();

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);
  // Aadhaar is required here and nowhere else in the app. It is what the server checks against
  // the membership roll, and without it the non-member path would be a way to bill a member
  // in cash for a service her milk payment has already covered.
  const canSubmit = name.trim().length >= 2 && isValidMobile && aadhaar.length === 12 && consent;

  const handleSubmit = async () => {
    setFailed(false);
    setFieldErrors({});
    try {
      const created = await createNonMember({
        name: name.trim(),
        father_husband_name: fatherHusband.trim(),
        mobile_no: mobileNo,
        address: address.trim(),
        aadhar_no: aadhaar,
        mpp: mpp.id,
      }).unwrap();
      onCreated(created);
    } catch (err) {
      // Server-side validation is the authority; surface its per-field messages rather than
      // a generic failure, so the Mait knows which box to fix.
      const problem = (err as { data?: ProblemDetails })?.data;
      if (problem?.errors) {
        setFieldErrors(problem.errors);
      } else {
        setFailed(true);
      }
    }
  };

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
        busy: isLoading,
        testID: 'non-member-save',
      }}
    >
      {failed && <FlowNotice tone="error" title={t('errors.generic')} testID="non-member-error" />}

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
          server checks it against the membership roll before creating anything. The number is
          stored encrypted and comes back masked; the card itself is never photographed. */}
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
});
