/**
 * Step 3, second half — is this her? (SRS §6.3 step 2, C4).
 *
 * The roster is searched by code as often as by name, and a code is sixteen digits typed by a
 * person standing in a yard. Getting one wrong does not fail: it succeeds against somebody
 * else, and the insemination, the straw and the charge all land on another woman's record.
 * Nothing downstream would ever catch it, because every one of those rows is internally
 * consistent. So the choice is read back before it is acted on.
 *
 * It carries her MPP rather than her village. The village is not on the member master — the
 * collection point is what the record is actually keyed to, it is what the Mait knows her by,
 * and it is the fact that catches the commonest mis-tap of all: the right name at the wrong
 * MPP.
 *
 * The member's own detail record is fetched here rather than at the next step, so the wait for
 * it happens while the Mait is reading the card instead of after they have tapped on.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useGetMemberQuery } from '@api/endpoints';
import type { MemberDetail } from '@api/types';
import { AI_FLOW_STEPS, NON_MEMBER_FEE } from '@/config/env';

import { FlowNotice, FlowScreen, groupedMobile, IdentityCard } from './components';

/** Zero-based index of the step this screen is the second half of. */
const FARMER_STEP = AI_FLOW_STEPS.indexOf('selectFarmer');

interface Props {
  memberCode: string;
  onConfirm: (member: MemberDetail) => void;
  /** Back to the roster. A wrong code is corrected by searching again, not by editing. */
  onSearchAgain: () => void;
}

export default function ConfirmMemberScreen({
  memberCode,
  onConfirm,
  onSearchAgain,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { data: member, isLoading, isError, isFetching, refetch } = useGetMemberQuery(memberCode);

  const facts = member
    ? [
        // Her collection point first: it is the one fact on this card that is checked against
        // where the Mait is standing rather than against the woman in front of them.
        { label: t('aiFlow.mppLabel'), value: member.mpp_name || member.mpp_code },
        {
          label: t('aiFlow.mobileLabel'),
          value: member.mobile_no ? groupedMobile(member.mobile_no) : t('aiFlow.noneOnRecord'),
        },
        {
          label: t('aiFlow.fatherHusbandShort'),
          value: member.father_husband_name || t('aiFlow.noneOnRecord'),
        },
        {
          label: t('aiFlow.animalsLabel'),
          value: member.animals?.length
            ? t('aiFlow.animalsOnRecord', { count: member.animals.length })
            : t('aiFlow.noAnimalsYet'),
        },
      ]
    : [];

  return (
    <FlowScreen
      // The same step 3 as the roster it came from, so the bar is not redrawn — this is the
      // second half of one question, and a second bar filling to the same place says a step
      // has passed when none has. It buys back the height the card needs to fit unscrolled.
      step={null}
      stepLabel={t('aiFlow.stepOf', { current: FARMER_STEP + 1, total: AI_FLOW_STEPS.length })}
      title={t('aiFlow.isThisHer')}
      subtitle={t('aiFlow.isThisHerSubtitle')}
      onBack={onSearchAgain}
      refresh={{ refreshing: isFetching && !isLoading, onRefresh: refetch }}
      cta={{
        label: t('aiFlow.yesContinue'),
        onPress: () => member && onConfirm(member),
        disabled: !member,
        busy: isLoading,
        testID: 'member-confirm',
      }}
      link={{
        label: t('aiFlow.noSearchAgain'),
        onPress: onSearchAgain,
        testID: 'member-search-again',
      }}
    >
      {isLoading && <FlowNotice tone="info" title={t('common.loading')} />}
      {isError && (
        <FlowNotice
          tone="error"
          title={t('errors.generic')}
          body={t('aiFlow.tryAgainInAMoment')}
          testID="member-confirm-error"
        />
      )}

      {!!member && (
        <IdentityCard
          name={member.member_name}
          code={member.member_code}
          facts={facts}
          testID="member-card"
        />
      )}

      {/* A statement, not a step. She owes nothing today whatever this screen does next, and
          saying so here stops a Mait asking a member for cash she has already paid for in
          milk. The figure is the price of one insemination — the same one a non-member hands
          over, taken a different way — and it is named only when the build has it configured,
          because a number the system cannot charge is heard by the farmer as final. */}
      {!!member && (
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
