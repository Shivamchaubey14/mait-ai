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

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AppText from '@/components/AppText';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';

import { ErrorCode, errorCodeOf } from '@api/client';
import {
  useGetMemberQuery,
  useGetNonMemberQuery,
  useAskFarmerOfficeCodeMutation,
  useSendFarmerOtpMutation,
  useVerifyFarmerOtpMutation,
} from '@api/endpoints';
import { fieldCode, localDay } from '@api/fieldCode';
import { fieldCheckFor } from '@api/offlinePack';
import type { Animal, FarmerKey } from '@api/types';
import { Sheet } from '@/components/BottomSheet';
import OtpInput from '@/components/OtpInput';
import { AI_FLOW_STEPS, OTP_LENGTH } from '@/config/env';
import { useAppSelector } from '@/store';
import { OfficeCallCard, OfficeCodeAsk } from './OfficeCode';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { FlowLabel, FlowNotice, FlowScreen, groupedMobile, IdentityCard } from './components';
import { procurementLine } from './procurement';
import { useServiceRate } from './rates';

/**
 * Wrong office codes allowed on the phone before it stops taking them. Six digits and five tries
 * is a one-in-two-hundred-thousand guess — and every one that did get through would still have
 * to match a code the office wrote down.
 */
const FIELD_MAX_TRIES = 5;

/** A check done on the phone with no signal: the office's code, and the day of the key. */
export interface OfficeCheck {
  code: string;
  day: string;
}

/** Zero-based index of the step this screen is the second half of. */
const FARMER_STEP = AI_FLOW_STEPS.indexOf('selectFarmer');

interface Props {
  /** Which farmer, in the shape the API names them by. */
  farmer: { kind: 'member'; memberCode: string } | { kind: 'nonMember'; id: number };
  /**
   * Their animals, handed forward so the next step costs no second round trip — and, where
   * she was checked with no signal, the office's code, for the capture to carry to the server.
   */
  onConfirm: (animals: Animal[], officeCheck?: OfficeCheck) => void;
  /** Back to the roster, or to the form. A wrong farmer is corrected there, not here. */
  onSearchAgain: () => void;
}

/** Whether the handset has any connection. An unreadable answer counts as yes: try the request. */
async function connectedNow(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    // Android's own "no internet" counts too: a Wi-Fi with nothing behind it is no signal.
    return state?.isConnected !== false && state?.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** No answer came back at all — no connection, or none in time. Not a refusal. */
function noAnswer(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 'FETCH_ERROR' || status === 'TIMEOUT_ERROR';
}

export default function ConfirmFarmerScreen({
  farmer,
  onConfirm,
  onSearchAgain,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const memberRate = useServiceRate('member');

  const isMember = farmer.kind === 'member';
  const key: FarmerKey = isMember
    ? { member_code: farmer.memberCode }
    : { non_member_id: farmer.id };

  const member = useGetMemberQuery(isMember ? farmer.memberCode : '', { skip: !isMember });
  const nonMember = useGetNonMemberQuery(isMember ? 0 : farmer.id, { skip: isMember });
  const source = isMember ? member : nonMember;

  const [sendOtp, { isLoading: sending }] = useSendFarmerOtpMutation();
  const [checkOtp, { isLoading: checking }] = useVerifyFarmerOtpMutation();
  const [askOffice, { isLoading: askingOffice }] = useAskFarmerOfficeCodeMutation();
  /** The office has been asked to phone her the code; the next thing is her reading it out. */
  const [officeAsked, setOfficeAsked] = useState(false);

  const askTheOffice = async () => {
    setProblem(null);
    try {
      const answer = await askOffice(key).unwrap();
      setSentTo(answer.mobile_no);
      setOfficeAsked(true);
    } catch (err) {
      setProblem(
        (err as { data?: { detail?: string } })?.data?.detail ?? t('aiFlow.officeAskFailed'),
      );
    }
  };

  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);

  /**
   * No signal at all: the office's code by voice, checked on this phone (`api/fieldCode`).
   *
   * Offered once a send has failed for want of signal. The Mait rings the office, the office
   * rings her, she reads the Mait the code, and the phone checks it against the day's key in
   * the offline pack. The capture carries the code to the server, which matches it against
   * what the office issued.
   */
  const owner = useAppSelector(state => state.auth.user?.id ?? null);
  const [byCall, setByCall] = useState(false);
  const [officePhone, setOfficePhone] = useState('');
  const [wrongTries, setWrongTries] = useState(0);
  const [officeCheck, setOfficeCheck] = useState<OfficeCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * The verification runs in a sheet over this screen rather than in the page under it.
   *
   * Inline, the card a Mait is checking her against scrolled away the moment the code field
   * appeared — so the screen asking "is this her" no longer showed her. The sheet keeps the
   * card visible behind it, holds the two steps that belong to the phone in her hand, and
   * closes when they are done, leaving the screen to do the one thing it is for.
   */
  const [asking, setAsking] = useState(false);

  // -- what the card says ------------------------------------------------------------------
  const record = source.data;
  const name = record ? (isMember ? member.data?.member_name : nonMember.data?.name) : undefined;
  const mobile = record?.mobile_no ?? '';
  const animals = record?.animals ?? [];

  // Her milk against the code-eligibility bar — members only (a non-member pays in cash, so no
  // bar applies), and only once the gate is live. The same figures the picker row and the portal
  // show, read back here as one more fact the Mait can check before her phone is asked.
  const procurement = isMember ? member.data?.procurement : undefined;
  const procLine = procurementLine(t, procurement);

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
        ...(procLine
          ? [
              {
                label: t('aiFlow.milkLabel'),
                value: `${
                  procurement?.eligible ? t('aiFlow.eligible') : t('aiFlow.notEligible')
                } · ${procLine}`,
              },
            ]
          : []),
      ]
    : [];

  // -- verification ------------------------------------------------------------------------
  /**
   * What to do again once the connection returns: send her the code, or check the one typed.
   *
   * A tap in a dead patch used to hang until the Mait gave up, and coming back into signal did
   * nothing — the request that was stuck stayed stuck. The requests are capped now
   * (`CODE_REQUEST_CAP_MS`), a network failure is said as one, and the step is repeated by
   * itself the moment the phone has a connection again. A refusal from the server is never
   * retried: that is the server's answer, not a missing one.
   */
  const [retryOnSignal, setRetryOnSignal] = useState<'send' | 'check' | null>(null);

  const send = async () => {
    setProblem(null);
    setCode('');
    // No connection at all: say so now rather than after the cap runs out.
    if (!(await connectedNow())) {
      setRetryOnSignal('send');
      setProblem(t('aiFlow.otpNoSignal'));
      return;
    }
    try {
      const result = await sendOtp(key).unwrap();
      setRetryOnSignal(null);
      setSentTo(result.mobile_no);
    } catch (err) {
      if (noAnswer(err)) {
        setRetryOnSignal('send');
        setProblem(t('aiFlow.otpNoSignal'));
        return;
      }
      setRetryOnSignal(null);
      setProblem(
        (err as { data?: { detail?: string } })?.data?.detail ?? t('aiFlow.otpSendFailed'),
      );
    }
  };

  const check = async () => {
    setProblem(null);
    if (!(await connectedNow())) {
      setRetryOnSignal('check');
      setProblem(t('aiFlow.otpNoSignalCheck'));
      return;
    }
    try {
      await checkOtp({ ...key, otp: code.trim() }).unwrap();
      setRetryOnSignal(null);
      setVerified(true);
      // Her phone has answered, and there is nothing else in here to do. The screen behind
      // takes it from here: the card, now confirmed, and the one button that moves on.
      setAsking(false);
    } catch (err) {
      if (noAnswer(err)) {
        setRetryOnSignal('check');
        setProblem(t('aiFlow.otpNoSignalCheck'));
        return;
      }
      setRetryOnSignal(null);
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
          // The office's code answers in its own words — "not the code the office read out" —
          // which is the sentence a Mait needs to go back to her with.
          setProblem(
            officeAsked
              ? ((err as { data?: { detail?: string } })?.data?.detail ?? t('aiFlow.otpWrong'))
              : t('aiFlow.otpWrong'),
          );
      }
    }
  };

  const startByCall = async () => {
    setProblem(null);
    setCode('');
    // The call replaces the SMS: an SMS sent by itself when signal returns would be a second
    // code arriving on her phone while she is reading out the first.
    setRetryOnSignal(null);
    setByCall(true);
    if (owner === null) {
      return;
    }
    const { key: dayKey, officePhone: phone } = await fieldCheckFor(owner, localDay());
    setOfficePhone(phone);
    if (!dayKey) {
      setProblem(t('aiFlow.fieldNoKey'));
    }
  };

  const checkByCall = async () => {
    setProblem(null);
    if (wrongTries >= FIELD_MAX_TRIES) {
      setProblem(t('aiFlow.fieldLocked'));
      return;
    }
    const day = localDay();
    const { key: dayKey } = owner === null ? { key: null } : await fieldCheckFor(owner, day);
    if (!dayKey) {
      setProblem(t('aiFlow.fieldNoKey'));
      return;
    }
    const typed = code.trim();
    if (fieldCode(dayKey, mobile, OTP_LENGTH) === typed) {
      setOfficeCheck({ code: typed, day });
      setVerified(true);
      setAsking(false);
      return;
    }
    const tries = wrongTries + 1;
    setWrongTries(tries);
    setCode('');
    setProblem(
      tries >= FIELD_MAX_TRIES
        ? t('aiFlow.fieldLocked')
        : t('aiFlow.fieldWrong', { count: FIELD_MAX_TRIES - tries }),
    );
  };

  // The latest of each, for the listener below, which outlives the render that made it.
  const sendRef = useRef(send);
  sendRef.current = send;
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    if (!retryOnSignal || !asking) {
      return;
    }
    // Once per wait. NetInfo may call this the moment it is attached, before there is an
    // unsubscribe to call, so a flag rather than unsubscribing from inside.
    let fired = false;
    const unsubscribe = NetInfo.addEventListener(state => {
      if (!fired && state.isConnected && state.isInternetReachable !== false) {
        fired = true;
        (retryOnSignal === 'send' ? sendRef : checkRef).current();
      }
    });
    return () => unsubscribe?.();
  }, [retryOnSignal, asking]);

  /**
   * Two states, not three. The middle one moved into the sheet.
   *
   * Before her phone has answered the only thing this screen offers is the way to ask it;
   * afterwards, the way on. A button that changed its job three times while a Mait read one
   * card was the control they had to keep re-reading.
   */
  /**
   * What a member owes today, which is nothing in the yard.
   *
   * Read once and used in two places, because after her phone answers the two green cards
   * become one: "her phone answered" and "there is nothing to collect" are both good news
   * about the same woman, and stacked they said it twice in the same colour while pushing the
   * card that proves who she is off the screen.
   */
  const nothingToCollect =
    // Her own rate, which is not the non-member's — the dairy prices the two apart because
    // they are settled in different worlds. It used to read a build constant that was null in
    // every build, so this sentence never named a figure at all.
    memberRate === null
      ? t('aiFlow.nothingToCollectPlain')
      : t('aiFlow.nothingToCollect', { amount: memberRate });

  const cta = verified
    ? {
        label: t('aiFlow.yesContinue'),
        onPress: () => (officeCheck ? onConfirm(animals, officeCheck) : onConfirm(animals)),
        testID: 'farmer-confirm',
      }
    : {
        label: t('aiFlow.verifyFarmer'),
        onPress: () => {
          setProblem(null);
          setAsking(true);
        },
        disabled: !record || !mobile,
        testID: 'farmer-verify',
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
          : {
              label: t('aiFlow.noSearchAgain'),
              onPress: onSearchAgain,
              testID: 'farmer-reject',
              // A button, not small print: this is the other answer to "is this her?".
              button: true,
            }
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

      {verified && (
        <FlowNotice
          tone="good"
          title={t('aiFlow.verified')}
          body={
            officeCheck
              ? t('aiFlow.fieldVerifiedBody')
              : isMember
                ? nothingToCollect
                : t('aiFlow.verifiedBody')
          }
          testID="farmer-verified"
        />
      )}

      {/* A refusal that happened inside the sheet is repeated here, because the sheet closes
          on the ones it cannot recover from — an expired code, the attempts run out — and a
          Mait would otherwise be left on a screen that simply had not moved. */}
      {!verified && !!problem && !asking && (
        <FlowNotice tone="error" title={problem} testID="farmer-otp-problem" />
      )}

      {/* A warning, not a statement: the thing it prevents is a Mait taking cash from a member
          who pays in milk, so it is in the yellow that means "mind this" rather than the green
          of something settled. Once her phone has answered it moves into the card above. */}
      {!!record && isMember && !verified && (
        <FlowNotice tone="accent" body={nothingToCollect} testID="member-nothing-to-collect" />
      )}
      {/* The two steps that belong to the phone in her hand, in the order they happen. Her
          number is never typed here and never chosen here — it is read off her record and
          shown, because a Mait who could nominate where the code goes could nominate their
          own phone, and a check a Mait can satisfy alone checks nothing. */}
      <Sheet
        visible={asking}
        title={
          byCall
            ? t('aiFlow.fieldTitle')
            : sentTo
              ? t('aiFlow.enterHerCode')
              : t('aiFlow.verifyFarmer')
        }
        subtitle={
          byCall
            ? t('aiFlow.fieldSubtitle')
            : sentTo
              ? t('aiFlow.codeSentTo', { mobile: sentTo })
              : t('aiFlow.codeGoesToHer')
        }
        onClose={() => setAsking(false)}
        testID="farmer-otp"
        footer={
          byCall ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: code.trim().length < OTP_LENGTH }}
              onPress={checkByCall}
              disabled={code.trim().length < OTP_LENGTH}
              style={({ pressed }) => [
                styles.sheetCta,
                code.trim().length < OTP_LENGTH && styles.sheetCtaInert,
                pressed && styles.sheetCtaPressed,
              ]}
              testID="farmer-field-check"
            >
              <AppText style={styles.sheetCtaLabel}>{t('aiFlow.checkCode')}</AppText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                busy: sending || checking,
                disabled: !!sentTo && code.trim().length < OTP_LENGTH,
              }}
              onPress={sentTo ? check : send}
              disabled={sending || checking || (!!sentTo && code.trim().length < OTP_LENGTH)}
              style={({ pressed }) => [
                styles.sheetCta,
                !!sentTo && code.trim().length < OTP_LENGTH && styles.sheetCtaInert,
                pressed && styles.sheetCtaPressed,
              ]}
              testID={sentTo ? 'farmer-check-code' : 'farmer-send-code'}
            >
              {sending || checking ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                // Words alone: the label says where the tap goes, and the arrow said nothing more.
                <AppText style={styles.sheetCtaLabel}>
                  {sentTo ? t('aiFlow.checkCode') : t('aiFlow.sendTheCode')}
                </AppText>
              )}
            </Pressable>
          )
        }
      >
        {byCall ? (
          <View>
            <OfficeCallCard
              officePhone={officePhone}
              body={
                isMember
                  ? t('aiFlow.fieldCallBodyMember', {
                      code: farmer.memberCode,
                      mobile: groupedMobile(mobile),
                    })
                  : t('aiFlow.fieldCallBodyNonMember', { mobile: groupedMobile(mobile) })
              }
              testID="farmer-field-call"
            />
            <FlowLabel style={styles.codeLabel}>{t('aiFlow.enterHerCode')}</FlowLabel>
            <OtpInput
              value={code}
              onChangeText={setCode}
              accessibilityLabel={t('aiFlow.enterHerCode')}
              testID="farmer-field-input"
            />
            <AppText
              style={styles.resend}
              onPress={() => {
                setByCall(false);
                send();
              }}
              testID="farmer-field-back"
            >
              {t('aiFlow.fieldBackToSms')}
            </AppText>
          </View>
        ) : !sentTo ? (
          <View style={styles.number} testID="farmer-otp-number">
            <AppText style={styles.numberLabel}>{t('aiFlow.mobileLabel')}</AppText>
            <AppText style={styles.numberValue}>{mobile ? groupedMobile(mobile) : ''}</AppText>
            <AppText style={styles.numberNote}>{t('aiFlow.codeGoesToHerBody')}</AppText>
          </View>
        ) : (
          <View>
            {/* The same six boxes a Mait types their own code into at sign-in, with the number
                keypad up under them from the moment the code is sent. */}
            <FlowLabel style={styles.codeLabel}>{t('aiFlow.enterHerCode')}</FlowLabel>
            <OtpInput
              value={code}
              onChangeText={setCode}
              autoFocus
              accessibilityLabel={t('aiFlow.enterHerCode')}
              testID="farmer-otp-input"
            />
            <AppText style={styles.resend} onPress={send} testID="farmer-otp-resend">
              {t('aiFlow.sendAgain')}
            </AppText>
            <OfficeCodeAsk
              asked={officeAsked}
              busy={askingOffice}
              onAsk={askTheOffice}
              sentTo={sentTo}
              testID="farmer-office-code"
            />
          </View>
        )}

        {!!problem && <FlowNotice tone="error" title={problem} testID="farmer-otp-sheet-problem" />}

        {/* The way out of a dead patch: offered once a send has failed for want of signal. */}
        {!byCall && retryOnSignal === 'send' && !!mobile && (
          <Pressable
            accessibilityRole="button"
            onPress={startByCall}
            style={styles.byCall}
            testID="farmer-field-start"
          >
            <AppText style={styles.byCallLabel}>{t('aiFlow.fieldStart')}</AppText>
          </Pressable>
        )}
      </Sheet>
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  byCall: {
    minHeight: 48,
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  byCallLabel: { ...typography.bodyStrong, color: colors.primaryDark, textAlign: 'center' },
  resend: { ...typography.bodyStrong, color: colors.primaryDark, paddingVertical: spacing[3] },

  // Her number, read back at the size a number is read back at. It is the one thing in this
  // sheet a Mait can check against the woman standing in front of them.
  number: {
    alignItems: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  codeLabel: { marginBottom: spacing[2] },
  numberLabel: { ...typography.caption, color: colors.textMuted },
  numberValue: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.ink },
  numberNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[2],
  },

  sheetCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    marginTop: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  sheetCtaPressed: { backgroundColor: colors.primaryPressed },
  sheetCtaInert: { backgroundColor: colors.disabledFill },
  // Across the button rather than sized to itself: Android measures Hindi narrow.
  sheetCtaLabel: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.surface,
    textAlign: 'center',
    // `flex`, not `alignSelf: stretch`: in a row, stretch is the height, and the label stayed
    // as wide as Android measured it — off the centre of the button.
    flex: 1,
  },
});
