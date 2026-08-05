/**
 * Register a Non-Member in the field (SRS §6.3 step 2, §7 Compliance).
 *
 * The mobile number is mandatory and validated here as well as server-side. Unlike members,
 * whose numbers come from SAP, this one is being typed by the Mait — and it is the only
 * channel for the payment authorisation OTP, so a wrong digit means the code goes to a
 * stranger and the event can never be completed.
 *
 * Consent is captured explicitly because this is personal data collected outside the SAP
 * membership process.
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCreateNonMemberMutation } from '@api/endpoints';
import type { MPP, NonMember, ProblemDetails } from '@api/types';
import { Banner, Button, Screen, TextField } from '@/components';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

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
  const [banner, setBanner] = useState<string | null>(null);

  const [createNonMember, { isLoading }] = useCreateNonMemberMutation();

  const isValidMobile = /^[6-9]\d{9}$/.test(mobileNo);
  const canSubmit = name.trim().length >= 2 && isValidMobile && consent;

  const handleSubmit = async () => {
    setBanner(null);
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
        setBanner(t('errors.generic'));
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          {!!banner && <Banner message={banner} testID="non-member-error" />}

          <TextField
            label={t('aiFlow.farmerName')}
            value={name}
            onChangeText={setName}
            error={fieldErrors.name?.[0]}
            autoCapitalize="words"
            testID="non-member-name"
          />

          <TextField
            label={t('auth.mobileNumber')}
            hint={t('aiFlow.mobileUsedForOtp')}
            value={mobileNo}
            onChangeText={text => setMobileNo(text.replace(/\D/g, '').slice(0, 10))}
            error={fieldErrors.mobile_no?.[0]}
            keyboardType="number-pad"
            maxLength={10}
            testID="non-member-mobile"
          />

          <TextField
            label={t('aiFlow.address')}
            value={address}
            onChangeText={setAddress}
            error={fieldErrors.address?.[0]}
            testID="non-member-address"
          />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            onPress={() => setConsent(c => !c)}
            style={styles.consentRow}
            testID="non-member-consent"
          >
            <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
              {consent && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.consentText}>{t('aiFlow.consentToStoreDetails')}</Text>
          </Pressable>

          <Button
            label={t('common.save')}
            variant="accent"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={isLoading}
            testID="non-member-save"
          />
          <View style={styles.cancel}>
            <Button
              label={t('common.cancel')}
              variant="ghost"
              onPress={onCancel}
              testID="non-member-cancel"
            />
          </View>
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    marginBottom: spacing[4],
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.neutral,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  checkboxChecked: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  checkmark: { color: colors.surface, fontWeight: '700' },
  consentText: { ...typography.body, color: colors.text, flex: 1 },
  cancel: { marginTop: spacing[2] },
});
