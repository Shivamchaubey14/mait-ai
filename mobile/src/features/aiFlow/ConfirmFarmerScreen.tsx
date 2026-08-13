/**
 * Step 3, second half — is this her? (SRS §6.3 step 2, §6.5, C4).
 *
 * The roster is searched by code as often as by name, and a code is sixteen digits typed by a
 * person standing in a yard. Getting one wrong does not fail: it succeeds against somebody
 * else, and the insemination, the straw and the charge all land on another woman's record.
 * Nothing downstream would ever catch it, because every one of those rows is internally
 * consistent. So the choice is read back before it is acted on — and then read back to her
 * phone.
 *
 * **The verification is the point of this screen.** A card a Mait reads to themselves proves
 * only that they can read. A code sent to the number on her record and quoted back proves she
 * is there. The app never says where the code should go; the server takes it off the record,
 * because a Mait who could nominate the destination could nominate their own phone.
 *
 * Both kinds of farmer come through here. A member is checked against the number SAP holds; a
 * non-member against the number the Mait just typed in — weaker, but it is the number the
 * receipt goes to, so it is the one worth proving.
 *
 * It carries her MPP rather than her village. The village is not on the member master — the
 * collection point is what the record is keyed to, it is what the Mait knows her by, and it is
 * the fact that catches the commonest mis-tap of all: the right name at the wrong MPP.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useGetMemberQuery,
  useGetNonMemberQuery,
  useSendFarmerOtpMutation,
  useVerifyFarmerOtpMutation,
} from '@api/endpoints';
import type { Animal, FarmerKey } from '@api/types';
import { AI_FLOW_STEPS, NON_MEMBER_FEE, OTP_LENGTH } from '@/config/env';
import { colors, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen, groupedMobile, IdentityCard, LabelledField } from './components';

/** Zero-based index of the step this screen is the second half of. */
const FARMER_STEP = AI_FLOW_STEPS.indexOf('selectFarmer');

interface Props {
  /** Which farmer, in the shape the API names them by. */
  farmer: { kind: 'member'; memberCode: string } | { kind: 'nonMember'; id: number };
  /** Their animals, handed forward so the next step costs no second round trip. */
  onConfirm: (animals: Animal[]) => void;
  /** Back to the roster, or to the form. A wrong farmer is corrected there, not here. */
  onSearchAgain: () => void;
}

export default function ConfirmFarmerScreen({
  farmer,
  onConfirm,
  onSearchAgain,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const isMember = farmer.kind === 'member';
  const key: FarmerKey = isMember
    ? { member_code: farmer.memberCode }
    : { non_member_id: farmer.id };

  const member = useGetMemberQuery(isMember ? farmer.memberCode : '', { skip: !isMember });
  const nonMember = useGetNonMemberQuery(isMember ? 0 : farmer.id, { skip: isMember });
  const source = isMember ? member : nonMember;

  const [sendOtp, { isLoading: sending }] = useSendFarmerOtpMutation();
  const [checkOtp, { isLoading: checking }] = useVerifyFarmerOtpMutation();

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // -- what the card says ------------------------------------------------------------------
  const record = source.data;
  const name = record ? (isMember ? member.data?.member_name : nonMember.data?.name) : undefined;
  const mobile = record?.mobile_no ?? '';
  const animals = record?.animals ?? [];

  const facts = record
    ? [
        // Her collection point first: it is the one fact on this card that is checked against
        // where the Mait is standing rather than against the woman in front of them.
        {
          label: t('aiFlow.mppLabel'),
          value: isMember
            ? member.data?.mpp_name || member.data?.mpp_code || t('aiFlow.noneOnRecord')
            : t('aiFlow.nonMember'),
        },
        {
          label: t('aiFlow.mobileLabel'),
          value: mobile ? groupedMobile(mobile) : t('aiFlow.noneOnRecord'),
        },
        {
          label: t('aiFlow.fatherHusbandShort'),
          value: record.father_husband_name || t('aiFlow.noneOnRecord'),
        },
        {
          label: t('aiFlow.animalsLabel'),
          value: animals.length
            ? t('aiFlow.animalsOnRecord', { count: animals.length })
            : t('aiFlow.noAnimalsYet'),
        },
      ]
    : [];

  // -- verification ------------------------------------------------------------------------
  const send = async () => {
    setProblem(null);
    setCode('');
    try {
      const result = await sendOtp(key).unwrap();
      setSentTo(result.mobile_no);
    } catch (err) {
      setProblem(
        (err as { data?: { detail?: string } })?.data?.detail ?? t('aiFlow.otpSendFailed'),
      );
    }
  };

  const check = async () => {
    setProblem(null);
    try {
      await checkOtp({ ...key, otp: code.trim() }).unwrap();
      setVerified(true);
    } catch (err) {
      // Wrong, expired and out of attempts each need a different action from a Mait standing
      // in a yard, so they are told apart rather than collapsed into "invalid".
      switch (errorCodeOf(err)) {
        case ErrorCode.OTP_EXPIRED:
          setProblem(t('aiFlow.otpExpired'));
          setSentTo(null);
          break;
        case ErrorCode.OTP_ATTEMPTS_EXCEEDED:
          setProblem(t('aiFlow.otpAttemptsExceeded'));
          setSentTo(null);
          break;
        default:
          setProblem(t('aiFlow.otpWrong'));
      }
    }
  };

  // The button is one of three things, in order: send her a code, check the code, go on.
  const cta = !sentTo
    ? {
        label: t('aiFlow.verifyFarmer'),
        onPress: send,
        disabled: !record || !mobile,
        busy: sending,
        testID: 'farmer-verify',
      }
    : !verified
      ? {
          label: t('aiFlow.checkCode'),
          onPress: check,
          disabled: code.trim().length < OTP_LENGTH,
          busy: checking,
          testID: 'farmer-check-code',
        }
      : {
          label: t('aiFlow.yesContinue'),
          onPress: () => onConfirm(animals),
          testID: 'farmer-confirm',
        };

  return (
    <FlowScreen
      // The same step 3 as the roster it came from, so the bar is not redrawn — this is the
      // second half of one question, and a second bar filling to the same place says a step
      // has passed when none has.
      step={null}
      stepLabel={t('aiFlow.stepOf', { current: FARMER_STEP + 1, total: AI_FLOW_STEPS.length })}
      title={t('aiFlow.isThisHer')}
      subtitle={t('aiFlow.isThisHerSubtitle')}
      onBack={onSearchAgain}
      refresh={{ refreshing: source.isFetching && !source.isLoading, onRefresh: source.refetch }}
      cta={cta}
      link={
        verified
          ? undefined
          : { label: t('aiFlow.noSearchAgain'), onPress: onSearchAgain, testID: 'farmer-reject' }
      }
    >
      {source.isLoading && <FlowNotice tone="info" title={t('common.loading')} />}
      {source.isError && (
        <FlowNotice
          tone="error"
          title={t('errors.generic')}
          body={t('aiFlow.tryAgainInAMoment')}
          testID="farmer-error"
        />
      )}

      {!!record && (
        <IdentityCard
          name={name ?? ''}
          code={isMember ? member.data?.member_code : undefined}
          facts={facts}
          testID="farmer-card"
        />
      )}

      {/* A farmer with no number cannot be verified at all, and saying so here is the whole
          reason the row was left on the roster rather than hidden. */}
      {!!record && !mobile && (
        <FlowNotice
          tone="error"
          title={t('aiFlow.memberNoMobile')}
          body={t('aiFlow.memberNoMobileBody')}
          testID="farmer-no-mobile"
        />
      )}

      {!!sentTo && !verified && (
        <View testID="farmer-otp">
          <Text style={styles.sentTo}>{t('aiFlow.codeSentTo', { mobile: sentTo })}</Text>
          <LabelledField
            label={t('aiFlow.enterHerCode')}
            tone="primary"
            placeholder={t('aiFlow.otpPlaceholder')}
            value={code}
            onChangeText={text => setCode(text.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            testID="farmer-otp-input"
          />
          <Text style={styles.resend} onPress={send} testID="farmer-otp-resend">
            {t('aiFlow.sendAgain')}
          </Text>
        </View>
      )}

      {verified && (
        <FlowNotice
          tone="good"
          title={t('aiFlow.verified')}
          body={t('aiFlow.verifiedBody')}
          testID="farmer-verified"
        />
      )}

      {!!problem && <FlowNotice tone="error" title={problem} testID="farmer-otp-problem" />}

      {/* A statement, not a step. A member owes nothing today whatever this screen does next,
          and saying so here stops a Mait asking her for cash she has already paid in milk. */}
      {!!record && isMember && (
        <FlowNotice
          tone="good"
          body={
            NON_MEMBER_FEE === null
              ? t('aiFlow.nothingToCollectPlain')
              : t('aiFlow.nothingToCollect', { amount: NON_MEMBER_FEE })
          }
          testID="member-nothing-to-collect"
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  sentTo: { ...typography.caption, color: colors.textMuted, marginBottom: spacing[3] },
  resend: { ...typography.bodyStrong, color: colors.primaryDark, paddingVertical: spacing[2] },
});
