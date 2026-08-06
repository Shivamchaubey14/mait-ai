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
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateNonMemberMutation } from '@api/endpoints';
import type { MPP, NonMember, ProblemDetails } from '@api/types';

import { FieldCard, FlowNotice, FlowScreen, FlowSpacer, OptionCard } from './components';

interface Props {
  mpp: MPP;
  onCreated: (nonMember: NonMember) => void;
  onCancel: () => void;
}

export default function AddNonMemberScreen({ mpp, onCreated, onCancel }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [address, setAddress] = useState('');
  const [consent, setConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [failed, setFailed] = useState(false);

  const [createNonMember, { isLoading }] = useCreateNonMemberMutation();

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);
  const canSubmit = name.trim().length >= 2 && isValidMobile && consent;

  const handleSubmit = async () => {
    setFailed(false);
    setFieldErrors({});
    try {
      const created = await createNonMember({
        name: name.trim(),
        mobile_no: mobileNo,
        address: address.trim(),
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
      step={1}
      stepLabel={t('aiFlow.stepNonMember')}
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

      <FieldCard
        label={t('aiFlow.farmerName')}
        value={name}
        onChangeText={setName}
        error={fieldErrors.name?.[0]}
        autoCapitalize="words"
        testID="non-member-name"
      />

      <FieldCard
        label={t('auth.mobileNumber')}
        hint={t('aiFlow.mobileUsedForOtp')}
        tone="info"
        value={mobileNo}
        onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
        error={fieldErrors.mobile_no?.[0]}
        keyboardType="number-pad"
        maxLength={10}
        testID="non-member-mobile"
      />

      <FieldCard
        label={t('aiFlow.address')}
        tone="accent"
        value={address}
        onChangeText={setAddress}
        error={fieldErrors.address?.[0]}
        testID="non-member-address"
      />

      <View>
        <OptionCard
          title={t('aiFlow.consentRecorded')}
          subtitle={t('aiFlow.consentToStoreDetails')}
          pill={consent ? t('aiFlow.ticked') : undefined}
          selected={consent}
          onPress={() => setConsent(value => !value)}
          testID="non-member-consent"
        />
        <FlowNotice
          tone="info"
          title={t('aiFlow.consentMandatory')}
          body={t('aiFlow.consentMandatoryBody')}
        />
      </View>

      <FlowSpacer />
    </FlowScreen>
  );
}
