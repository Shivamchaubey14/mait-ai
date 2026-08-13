/**
 * Navigation shell (SRS §6.3, §10.3).
 *
 * Two layers. Four tabs a Mait moves between freely, and the six-step capture flow layered
 * over them with the tab bar hidden: that flow is one task with one forward path, and a tab
 * bar under it is an invitation to leave halfway, with an animal served, a straw scanned and
 * nothing recorded.
 *
 * The capture's `client_uuid` is minted once, when the flow starts, and carried through every
 * step. That is what makes the event safe to retry from the offline queue (ADR 0003) — a key
 * generated at send time would be new on every attempt and deduplicate nothing.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';

import { attachPhoto, completeEvent } from '@api/capture';
import { newClientUuid } from '@api/client';
import {
  useGetInventorySummaryQuery,
  useGetMemberQuery,
  useGetNonMemberQuery,
  useInitiatePaymentMutation,
  useVerifyPaymentOtpMutation,
} from '@api/endpoints';
import { enqueue, pendingCount, readQueue } from '@api/queue';
import type { QueuedJob } from '@api/queue';
import { drainQueue } from '@api/sync';
import type { AIEvent, Animal, Member, MPP, NonMember } from '@api/types';
import BottomNav, { Tab } from '@/components/BottomNav';
import AddNonMemberScreen from '@/features/aiFlow/AddNonMemberScreen';
import CapturePhotoScreen from '@/features/aiFlow/CapturePhotoScreen';
import CaptureDoneScreen from '@/features/aiFlow/CaptureDoneScreen';
import CollectPaymentScreen, { PaymentMode } from '@/features/aiFlow/CollectPaymentScreen';
import ConfirmFarmerScreen from '@/features/aiFlow/ConfirmFarmerScreen';
import MemberNothingToCollectScreen from '@/features/aiFlow/MemberNothingToCollectScreen';
import RecordPaymentScreen from '@/features/aiFlow/RecordPaymentScreen';
import SelectAnimalScreen from '@/features/aiFlow/SelectAnimalScreen';
import SelectBreedScreen from '@/features/aiFlow/SelectBreedScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import OwnerTypeScreen, { OwnerType } from '@/features/aiFlow/OwnerTypeScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import HistoryScreen from '@/features/history/HistoryScreen';
import SyncQueueScreen, { toCaptures } from '@/features/history/SyncQueueScreen';
import HomeScreen from '@/features/home/HomeScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import IndentDetailScreen from '@/features/stock/IndentDetailScreen';
import IndentsScreen from '@/features/stock/IndentsScreen';
import RequestStockScreen from '@/features/stock/RequestStockScreen';
import StockScreen from '@/features/stock/StockScreen';
import { useAppSelector } from '@/store';
import { colors } from '@theme/tokens';

/** Where the capture flow has got to. `null` means it is not running. */
type CaptureStep =
  | 'ownerType'
  | 'selectMpp'
  | 'selectFarmer'
  | 'confirmFarmer'
  | 'addNonMember'
  | 'selectAnimal'
  | 'selectBreed'
  | 'capturePhoto'
  | 'memberStatement'
  | 'collectPayment'
  | 'recordPayment'
  | 'done';

/** Who the capture is for. Exactly one of the two codes is ever set. */
type Farmer =
  | { kind: 'member'; name: string; memberCode: string }
  | { kind: 'nonMember'; name: string; nonMemberId: number };

function clockTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export default function RootNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const accessToken = useAppSelector(state => state.auth.accessToken);

  const [tab, setTab] = useState<Tab>('home');
  const [step, setStep] = useState<CaptureStep | null>(null);
  const [requestingStock, setRequestingStock] = useState(false);
  /** null = not looking at indents, 0 = the list, n = that indent. */
  const [indentView, setIndentView] = useState<number | null>(null);
  /** The waiting-to-sync screen, opened from Home's yellow tile. */
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueJobs, setQueueJobs] = useState<QueuedJob[]>([]);
  const [draining, setDraining] = useState(false);

  const [clientUuid, setClientUuid] = useState(newClientUuid);
  /** Answered at step 1, and it decides where step 3 goes. */
  const [ownerType, setOwnerType] = useState<OwnerType>('member');
  const [mpp, setMpp] = useState<MPP | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [event, setEvent] = useState<AIEvent | null>(null);

  /** How a non-member is paying, and where her authorisation code went. */
  const [payMode, setPayMode] = useState<PaymentMode>('COD');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [payCode, setPayCode] = useState('');
  const [payProblem, setPayProblem] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  /** The server's own words when a payment is refused — it knows why and the Mait needs it. */
  const [payFailed, setPayFailed] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [initiatePayment] = useInitiatePaymentMutation();
  const [verifyPaymentOtp] = useVerifyPaymentOtpMutation();
  const inventory = useGetInventorySummaryQuery();

  const memberDetail = useGetMemberQuery(farmer?.kind === 'member' ? farmer.memberCode : '', {
    skip: farmer?.kind !== 'member',
  });
  const nonMemberDetail = useGetNonMemberQuery(
    farmer?.kind === 'nonMember' ? farmer.nonMemberId : 0,
    { skip: farmer?.kind !== 'nonMember' },
  );

  const sync = useCallback(async () => {
    setDraining(true);
    const result = await drainQueue(accessToken);
    setPending(result.remaining);
    setQueueJobs(await readQueue());
    setDraining(false);
    if (result.sent > 0) {
      setLastSyncAt(clockTime());
    }
  }, [accessToken]);

  /** Read the queue for the screen that lists it, without sending anything. */
  const refreshQueue = useCallback(async () => {
    const jobs = await readQueue();
    setQueueJobs(jobs);
    setPending(jobs.length);
  }, []);

  /**
   * Drain when the connection returns, and once on mount.
   *
   * A Mait finishes a round in a village with no signal and rides back through one. Waiting
   * for them to reopen the app would leave a day's events on a handset that might be dropped
   * in a canal before anyone noticed.
   */
  useEffect(() => {
    pendingCount().then(setPending);

    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = !!state.isConnected;
      setOnline(connected);
      if (connected) {
        sync();
      }
    });
    return () => unsubscribe();
  }, [sync]);

  if (!accessToken) {
    return <LoginScreen />;
  }

  const animals =
    (farmer?.kind === 'member' ? memberDetail.data?.animals : nonMemberDetail.data?.animals) ?? [];

  const startCapture = () => {
    setMpp(null);
    setFarmer(null);
    setAnimal(null);
    setEvent(null);
    setOwnerType('member');
    setClientUuid(newClientUuid());
    setStep('ownerType');
  };

  const leaveCapture = () => {
    setStep(null);
    setTab('home');
  };

  /**
   * Pick a half-finished capture back up.
   *
   * Only ever called with an event whose straw is verified and whose photo never arrived, so
   * the photo step is where it resumes. The event's own `client_uuid` is restored with it —
   * minting a new one here would make the retry a second insemination as far as the server is
   * concerned (ADR 0003).
   */
  const resumeCapture = (unfinished: AIEvent) => {
    setEvent(unfinished);
    setClientUuid(unfinished.client_uuid);
    setStep('capturePhoto');
  };

  /**
   * Close the capture: record the payment, then complete the event.
   *
   * Completion goes through the offline queue, so a Mait in a village with no signal finishes
   * the round rather than being held on a screen by a network they do not have. What is never
   * faked is the authorisation: an unverified payment stays unverified, and the app says so.
   */
  const finishCapture = async (mode?: PaymentMode) => {
    if (!event) {
      return;
    }
    setPayBusy(true);
    setPayFailed(null);
    try {
      await initiatePayment({ eventId: event.id, ...(mode ? { mode } : {}) }).unwrap();
    } catch (err) {
      const problem = err as { status?: number | string; data?: { detail?: string } };
      const unreachable =
        !online || problem.status === 'FETCH_ERROR' || problem.status === 'TIMEOUT_ERROR';

      if (unreachable) {
        // No network is not a refusal. The insemination happened and the cash is already in
        // the Mait's hand; holding them here until a village finds signal would strand a
        // finished round. The payment is queued, and the waiting list carries it from here.
        await enqueue(
          'verifyPayment',
          clientUuid,
          { eventId: event.id, mode: mode ?? 'COD' },
          {
            farmer: farmer?.name ?? '',
            kind: farmer?.kind === 'member' ? 'member' : 'nonMember',
            amount: event.amount_due,
            mode: mode ?? 'COD',
            at: clockTime(),
            eventId: event.id,
          },
        );
      } else {
        // A real refusal, shown rather than swallowed. The commonest by far is a breed the
        // administrator has not priced, and the server says so in a sentence a Mait can act
        // on — where "something went wrong" leaves them tapping a button that never works.
        setPayFailed(problem.data?.detail ?? t('errors.generic'));
        setPayBusy(false);
        return;
      }
    }

    const outcome = await completeEvent(event.id, clientUuid, accessToken);
    setPending(outcome.remaining);
    if (outcome.sent) {
      setLastSyncAt(clockTime());
      inventory.refetch();
    }
    setPayBusy(false);
    setStep('done');
  };

  /** Ask for her authorisation code, and remember whether it could be sent at all. */
  const startCollection = async (mode: PaymentMode) => {
    if (!event) {
      return;
    }
    setPayMode(mode);
    setPayProblem(null);
    setPayBusy(true);
    try {
      const payment = await initiatePayment({ eventId: event.id, mode }).unwrap();
      setCodeSentTo(payment.mode === 'DEDUCT' ? null : t('payment.herNumber'));
    } catch {
      // No signal, or the gateway refused. The cash is already in the Mait's hand, so the
      // capture continues and the code is asked for when the network comes back.
      setCodeSentTo(null);
    }
    setPayBusy(false);
    setStep('recordPayment');
  };

  /**
   * A member is chosen, then read back before the flow acts on it.
   *
   * The roster is searched by a sixteen-digit code as often as by name, and a wrong one does
   * not fail — it succeeds against somebody else. The confirmation screen is where that is
   * caught, so selection lands there rather than at the animal.
   */
  const chooseMember = (selected: Member) => {
    setFarmer({ kind: 'member', name: selected.member_name, memberCode: selected.member_code });
    setStep('confirmFarmer');
  };

  /**
   * A non-member goes through the same confirmation a member does.
   *
   * Her number was typed in by the Mait a moment ago, which is exactly why it is worth
   * proving: it is the number the receipt will go to, and a digit wrong there is a receipt
   * that reaches nobody.
   */
  const chooseNonMember = (selected: NonMember) => {
    setFarmer({ kind: 'nonMember', name: selected.name, nonMemberId: selected.id });
    setStep('confirmFarmer');
  };

  /**
   * The tab bar rides along until something has been committed.
   *
   * Owner type, MPP, farmer and animal are all still just choices — walking away from them
   * costs a Mait four taps, not a record. From the straw scan on it is gone, because that is
   * the step that creates the AI event on the server, and a tab bar under a half-captured
   * insemination is an invitation to strand one: an animal served, a straw spent, nothing
   * recorded.
   */
  const withTabs = (screen: React.JSX.Element) => (
    <View style={styles.flex}>
      <View style={styles.flex}>{screen}</View>
      <BottomNav
        active="home"
        pending={pending}
        onChange={next => {
          setStep(null);
          setTab(next);
        }}
      />
    </View>
  );

  // -- the capture flow, over the tabs ---------------------------------------------------
  if (step === 'ownerType') {
    return withTabs(
      <OwnerTypeScreen
        onBack={leaveCapture}
        onContinue={choice => {
          setOwnerType(choice);
          setStep('selectMpp');
        }}
      />,
    );
  }

  if (step === 'selectMpp') {
    return withTabs(
      <SelectMppScreen
        onBack={() => setStep('ownerType')}
        onSelect={selected => {
          setMpp(selected);
          // The fork answered at step 1 decides which of the two farmer screens this is.
          // A non-member is not in any roster, so searching one would be a dead end.
          setStep(ownerType === 'member' ? 'selectFarmer' : 'addNonMember');
        }}
      />,
    );
  }

  if (step === 'selectFarmer' && mpp) {
    return withTabs(
      <SelectFarmerScreen
        mpp={mpp}
        onSelectMember={chooseMember}
        onAddNonMember={() => setStep('addNonMember')}
        onBack={() => setStep('selectMpp')}
      />,
    );
  }

  if (step === 'confirmFarmer' && farmer) {
    return withTabs(
      <ConfirmFarmerScreen
        farmer={
          farmer.kind === 'member'
            ? { kind: 'member', memberCode: farmer.memberCode }
            : { kind: 'nonMember', id: farmer.nonMemberId }
        }
        onConfirm={() => setStep('selectAnimal')}
        // A member goes back to the roster to be found again. A non-member has already been
        // created, so back goes to the MPP rather than into the form that made her —
        // re-submitting it would register the same woman twice.
        onSearchAgain={() => setStep(farmer.kind === 'member' ? 'selectFarmer' : 'selectMpp')}
      />,
    );
  }

  if (step === 'addNonMember' && mpp) {
    return withTabs(
      <AddNonMemberScreen
        mpp={mpp}
        onCreated={chooseNonMember}
        // Back to wherever this was reached from: the roster, if the Mait went looking for a
        // member first, or the MPP picker if they said non-member at the fork.
        onCancel={() => setStep(ownerType === 'member' ? 'selectFarmer' : 'selectMpp')}
      />,
    );
  }

  if (step === 'selectAnimal' && farmer) {
    return withTabs(
      <SelectAnimalScreen
        owner={{
          name: farmer.name,
          memberCode: farmer.kind === 'member' ? farmer.memberCode : undefined,
          nonMemberId: farmer.kind === 'nonMember' ? farmer.nonMemberId : undefined,
        }}
        animals={animals}
        onSelect={selected => {
          setAnimal(selected);
          setStep('selectBreed');
        }}
        // A non-member has already been created by the time this screen is reached, so back
        // goes past that form rather than into it — re-submitting it would add the same
        // person twice. A member goes back to the card that was just confirmed.
        onBack={() => setStep('confirmFarmer')}
      />,
    );
  }

  if (step === 'selectBreed' && mpp && farmer && animal) {
    return withTabs(
      <SelectBreedScreen
        animalType={animal.animal_type}
        // Her own breed, carried through from step 4 so the step opens already answered.
        suggestedBreed={animal.breed}
        capture={{
          clientUuid,
          mppCode: mpp.mpp_code,
          memberCode: farmer.kind === 'member' ? farmer.memberCode : undefined,
          nonMemberId: farmer.kind === 'nonMember' ? farmer.nonMemberId : undefined,
          animalId: animal.id,
        }}
        onCreated={created => {
          setEvent(created);
          setStep('capturePhoto');
        }}
        onBack={() => setStep('selectAnimal')}
      />,
    );
  }

  if (step === 'capturePhoto' && event) {
    return (
      <CapturePhotoScreen
        busy={uploading}
        onCaptured={async photo => {
          setUploading(true);
          const outcome = await attachPhoto(event.id, clientUuid, photo, accessToken);
          setUploading(false);
          setPending(outcome.remaining);
          if (outcome.sent) {
            setLastSyncAt(clockTime());
          }
          // A member owes nothing and a non-member owes now: two different screens, and the
          // fork was answered at step 1.
          setStep(farmer?.kind === 'member' ? 'memberStatement' : 'collectPayment');
        }}
        onBack={() => setStep('selectBreed')}
      />
    );
  }

  const animalLabel = animal
    ? animal.ear_tag_no
      ? t('aiFlow.animalWithTag', {
          type: t(`aiFlow.animalType.${animal.animal_type}`),
          tag: animal.ear_tag_no,
        })
      : t('aiFlow.noEarTag', { type: t(`aiFlow.animalType.${animal.animal_type}`) })
    : '';

  if (step === 'memberStatement' && event && farmer) {
    return (
      <MemberNothingToCollectScreen
        event={event}
        farmerName={farmer.name}
        animalLabel={animalLabel}
        busy={payBusy}
        failed={payFailed}
        onFinish={() => finishCapture()}
      />
    );
  }

  if (step === 'collectPayment' && event && farmer) {
    return (
      <CollectPaymentScreen
        event={event}
        farmerName={farmer.name}
        online={online}
        busy={payBusy}
        failed={payFailed}
        onContinue={startCollection}
        onBack={() => setStep('capturePhoto')}
      />
    );
  }

  if (step === 'recordPayment' && event && farmer) {
    return (
      <RecordPaymentScreen
        event={event}
        farmerName={farmer.name}
        mode={payMode}
        sentTo={codeSentTo}
        code={payCode}
        onCodeChange={setPayCode}
        onResend={() => startCollection(payMode)}
        problem={payProblem}
        busy={payBusy}
        onFinish={async () => {
          // With a code in hand it has to be right before anything closes. With none — no
          // signal to send one — the capture is saved and the code is asked for later.
          if (codeSentTo) {
            setPayBusy(true);
            try {
              await verifyPaymentOtp({ eventId: event.id, otp: payCode.trim() }).unwrap();
            } catch {
              setPayProblem(t('aiFlow.otpWrong'));
              setPayBusy(false);
              return;
            }
            setPayBusy(false);
          }
          await finishCapture();
        }}
        onBack={() => setStep('collectPayment')}
      />
    );
  }

  if (queueOpen) {
    const captures = toCaptures(queueJobs);
    return withTabs(
      <SyncQueueScreen
        captures={captures}
        synced={[]}
        progress={draining && captures.length ? { done: 0, total: captures.length } : null}
        onRetryAll={sync}
        onEnterCode={capture => {
          // Back into the payment step for that capture, where the code is asked for again.
          const job = queueJobs.find(item => item.clientUuid === capture.clientUuid);
          setQueueOpen(false);
          setPayMode((job?.payload.mode as PaymentMode) ?? 'COD');
          setCodeSentTo(null);
          setPayCode('');
          setEvent({ id: capture.eventId, amount_due: capture.amount } as AIEvent);
          setFarmer({
            kind: capture.kind === 'member' ? 'member' : 'nonMember',
            name: capture.farmer,
            ...(capture.kind === 'member' ? { memberCode: '' } : { nonMemberId: 0 }),
          } as Farmer);
          setStep('recordPayment');
        }}
        onBack={() => setQueueOpen(false)}
      />,
    );
  }

  if (step === 'done') {
    return (
      <CaptureDoneScreen
        event={event}
        farmerName={farmer?.name ?? ''}
        animalLabel={animalLabel}
        time={clockTime()}
        pending={pending}
        strawsLeft={
          event?.semen_breed ? (inventory.data?.by_breed?.[event.semen_breed] ?? null) : null
        }
        strawBreed={event?.semen_breed ?? ''}
        onStartAnother={startCapture}
        onHome={leaveCapture}
      />
    );
  }

  // -- the tabs --------------------------------------------------------------------------
  return (
    <View style={styles.flex}>
      <View style={styles.flex}>
        {/* Keeps the bar, unlike the capture flow: asking for stock is a form a Mait can
            abandon by tapping another tab, not a sequence they can strand halfway. */}
        {requestingStock && (
          <RequestStockScreen
            onDone={() => setRequestingStock(false)}
            onBack={() => setRequestingStock(false)}
          />
        )}

        {!requestingStock && tab === 'home' && (
          <HomeScreen
            onOpenStock={() => setTab('stock')}
            onStartCapture={startCapture}
            onResume={resumeCapture}
            online={online}
            pending={pending}
            // The tile answers for itself now: it opens the list of what is waiting, and
            // pushes at the same time. A number that only kicks an invisible drain leaves a
            // Mait unable to tell a bad network from a lost day's work.
            onSync={() => {
              setQueueOpen(true);
              refreshQueue();
              sync();
            }}
            lastSyncAt={lastSyncAt}
          />
        )}
        {!requestingStock && tab === 'stock' && indentView === null && (
          <StockScreen
            onOpenIndents={() => setIndentView(0)}
            onRequestStock={() => {
              setIndentView(null);
              setRequestingStock(true);
            }}
          />
        )}
        {!requestingStock && tab === 'stock' && indentView === 0 && (
          <IndentsScreen
            onOpen={indent => setIndentView(indent.id)}
            onBack={() => setIndentView(null)}
          />
        )}
        {!requestingStock && tab === 'stock' && !!indentView && (
          <IndentDetailScreen indentId={indentView} onBack={() => setIndentView(0)} />
        )}
        {!requestingStock && tab === 'history' && <HistoryScreen />}
        {!requestingStock && tab === 'settings' && (
          <SettingsScreen pending={pending} onSync={sync} online={online} />
        )}
      </View>

      {/* Destinations only. Each screen's own action lives at the foot of that screen's
          content — "Start new AI" on Home, "Request stock" on Inventory — where it is next to
          the thing it acts on rather than in the furniture. */}
      <BottomNav
        active={tab}
        pending={pending}
        onChange={next => {
          // Switching tabs leaves the form. Nothing is lost that was worth keeping — an
          // unsent indent is a decision not yet made.
          setRequestingStock(false);
          setIndentView(null);
          setTab(next);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
