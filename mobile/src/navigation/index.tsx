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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';

import { attachPhoto, completeEvent } from '@api/capture';
import { ErrorCode, errorCodeOf, newClientUuid } from '@api/client';
import {
  maitaiApi,
  useGetInventorySummaryQuery,
  useGetMemberQuery,
  useGetNonMemberQuery,
  useInitiatePaymentMutation,
  useListAiEventsQuery,
  useGetPdRouteQuery,
  useListPregnancyChecksQuery,
  useRecordPregnancyCheckMutation,
  useVerifyPaymentOtpMutation,
} from '@api/endpoints';
import { enqueue, pendingCount, readQueue } from '@api/queue';
import type { QueuedJob, QueuedLabel } from '@api/queue';
import { drainQueue } from '@api/sync';
import type { SyncProgress } from '@api/sync';
import type {
  AIEvent,
  Animal,
  Member,
  MPP,
  NonMember,
  NonMemberSummary,
  PdOutcome,
  PregnancyCheck,
} from '@api/types';
import BottomNav, { Tab } from '@/components/BottomNav';
import { RouteTransitionHost, useRouteTransition } from '@/components/routeTransition';
import type { RouteKey } from '@/navigation/routes';
import { Toast } from '@/components/toast';
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
import SelectNonMemberScreen from '@/features/aiFlow/SelectNonMemberScreen';
import UnfinishedScreen from '@/features/aiFlow/UnfinishedScreen';
import { resumePoint, whatIsMissing } from '@/features/aiFlow/resume';
import OwnerTypeScreen, { OwnerType } from '@/features/aiFlow/OwnerTypeScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import { useLiveScope } from '@/features/auth/liveScope';
import AiEventDetailScreen from '@/features/history/AiEventDetailScreen';
import AiEventsScreen from '@/features/history/AiEventsScreen';
import SyncQueueScreen, { toCaptures } from '@/features/history/SyncQueueScreen';
import HomeScreen from '@/features/home/HomeScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import IndentDetailScreen from '@/features/stock/IndentDetailScreen';
import IndentsScreen from '@/features/stock/IndentsScreen';
import PdDoneScreen from '@/features/pregnancy/PdDoneScreen';
import PdListScreen from '@/features/pregnancy/PdListScreen';
import PdReorderScreen from '@/features/pregnancy/PdReorderScreen';
import type { OrderKey } from '@/features/pregnancy/PdReorderScreen';
import PdRouteScreen from '@/features/pregnancy/PdRouteScreen';
import PdRecordScreen from '@/features/pregnancy/PdRecordScreen';
import RequestStockScreen from '@/features/stock/RequestStockScreen';
import StockScreen from '@/features/stock/StockScreen';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors } from '@theme/tokens';

/** Where the capture flow has got to. `null` means it is not running. */
type CaptureStep =
  | 'ownerType'
  | 'selectMpp'
  | 'selectFarmer'
  | 'selectNonMember'
  | 'confirmFarmer'
  | 'addNonMember'
  | 'selectAnimal'
  | 'selectBreed'
  | 'capturePhoto'
  | 'memberStatement'
  | 'collectPayment'
  | 'recordPayment'
  | 'done';

/**
 * The order the flow runs in, for deciding which way a slide goes.
 *
 * `addNonMember` sits beside the roster it is reached from and `done` at the end. A step not
 * in this list compares as -1, which reads as "further back than anything" — so leaving the
 * flow slides backwards, which is what leaving is.
 */
const STEP_ORDER: CaptureStep[] = [
  'ownerType',
  'selectMpp',
  'selectFarmer',
  'selectNonMember',
  'addNonMember',
  'confirmFarmer',
  'selectAnimal',
  'selectBreed',
  'capturePhoto',
  'memberStatement',
  'collectPayment',
  'recordPayment',
  'done',
];

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
  const dispatch = useAppDispatch();
  const accessToken = useAppSelector(state => state.auth.accessToken);

  const [tab, setTab] = useState<Tab>('home');
  const [step, setStepDirect] = useState<CaptureStep | null>(null);
  /**
   * The Mait's own scope, kept current while the app is open.
   *
   * Mounted here rather than on a screen because it outlives every screen: an MPP assigned
   * while a Mait is halfway through Inventory has to be true by the time they reach the
   * capture flow, which reads the same list.
   */
  const scope = useLiveScope();
  /**
   * Pulled out on its own because it is the stable half.
   *
   * `sync` must not depend on the whole hook: `scope.change` moves whenever the office
   * reassigns something, and the netinfo effect below depends on `sync` — so taking the whole
   * object would rebuild `sync`, re-run that effect, drain again, and re-read the scope, in a
   * circle. `refresh` never changes identity, so this is what `sync` is allowed to see.
   */
  const refreshScope = scope.refresh;

  /**
   * A scope change, said out loud.
   *
   * A silent refetch turns "3 MPPs" into "4 MPPs" under the Mait's name with nothing to say
   * why, and the capture flow quietly grows a collection point they have never been told
   * about. Both directions are worth a sentence — losing one matters more than gaining one,
   * because a Mait who walks to a yard that is no longer theirs has wasted a morning.
   */
  const scopeNotice = ((): string | null => {
    if (!scope.change) {
      return null;
    }
    const { added, removed } = scope.change;
    if (added.length && removed.length) {
      return t('scope.both');
    }
    return added.length
      ? t('scope.added', { count: added.length, codes: added.join(', ') })
      : t('scope.removed', { count: removed.length, codes: removed.join(', ') });
  })();

  const transition = useRouteTransition();

  /**
   * The tab to light while the screen behind is still the old one.
   *
   * Only the four that are tabs: a card on its way to an AI event is not a reason to move the
   * bar, because the record is layered over the tab that opened it and that tab stays lit.
   */
  const pendingTab = (['home', 'stock', 'history', 'settings'] as RouteKey[]).includes(
    transition.pending as RouteKey,
  )
    ? (transition.pending as Tab)
    : null;

  /**
   * Where each step sits in the flow, so a change between two of them knows which way it is
   * going without every call site being told.
   *
   * The forks are flattened onto the path they belong to — a non-member's list sits where a
   * member's list sits, because from the Mait's side they are the same question asked of a
   * different roster, and a slide that went backwards between them would say otherwise.
   */
  const stepRef = useRef<CaptureStep | null>(null);
  stepRef.current = step;

  /**
   * Every step change in the flow, wrapped once.
   *
   * Shadowing the setter rather than editing twenty call sites: a slide is a property of
   * moving between steps, not a decision each screen should be making, and one of the twenty
   * would eventually be added without it.
   *
   * Deliberately not a card. Six cards on a six-step flow is six interruptions in a task a
   * Mait is trying to get through, and the destination of a step is never in doubt — they
   * just answered the question that chose it.
   */
  const setStep = useCallback(
    (next: CaptureStep | null) => {
      const from = STEP_ORDER.indexOf(stepRef.current as CaptureStep);
      const to = STEP_ORDER.indexOf(next as CaptureStep);
      transition.slide(to >= from ? 'forward' : 'back', () => setStepDirect(next));
    },
    [transition],
  );

  const [requestingStock, setRequestingStock] = useState(false);
  /** null = not looking at indents, 0 = the list, n = that indent. */
  const [indentView, setIndentView] = useState<number | null>(null);
  /**
   * Where the pregnancy checks are.
   *
   * `null` is not looking at them; `'list'` is the week; a check means it is being recorded;
   * and `done` holds what was just found, because that screen has to say what happened after
   * the check itself has left the list.
   */
  const [pdView, setPdView] = useState<'list' | 'route' | 'reorder' | null>(null);
  const [pdCheck, setPdCheck] = useState<PregnancyCheck | null>(null);
  const [pdPhoto, setPdPhoto] = useState<string | null>(null);
  const [pdDone, setPdDone] = useState<{
    check: PregnancyCheck;
    outcome: PdOutcome;
    queued: boolean;
  } | null>(null);
  const [pdSaving, setPdSaving] = useState(false);
  /** The animal a follow-up capture is for, until the roster carrying it has loaded. */
  const [pendingAnimalId, setPendingAnimalId] = useState<number | null>(null);
  /** Which of the two orders the Mait is working from. */
  const [pdOrder, setPdOrder] = useState<OrderKey>('shortest');
  /** Where the round is planned from, once the handset has a fix. */
  const [pdFrom, setPdFrom] = useState<{ lat: number; lng: number } | null>(null);

  const [recordPd] = useRecordPregnancyCheckMutation();
  const pdChecks = useListPregnancyChecksQuery({ window: 'due' }, { skip: pdView === null });

  /**
   * The round, worked out once and held.
   *
   * Asked for only while a route screen is up, and keyed on the fix so it is computed again
   * if the Mait has moved a village since. Both orders come back together, so choosing
   * between them on the next screen needs no network at all — which is what makes reordering
   * work in a yard.
   */
  const pdRoute = useGetPdRouteQuery(pdFrom ?? undefined, {
    skip: pdView !== 'route' && pdView !== 'reorder',
  });

  useEffect(() => {
    if (pdView !== 'route' || pdFrom !== null) {
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }
        const fix = await Location.getCurrentPositionAsync({});
        if (alive) {
          setPdFrom({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        }
      } catch {
        // No fix, and nothing to do about it. The server orders the round from the first
        // stop instead and the screen says so, which is better than a spinner that never
        // resolves in a yard with no sky.
      }
    })();
    return () => {
      alive = false;
    };
  }, [pdView, pdFrom]);

  /** The waiting-to-sync screen, opened from Home's yellow tile. */
  const [queueOpen, setQueueOpen] = useState(false);
  /** The list of captures still owed a finish, opened from Home. */
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  /**
   * The AI event being read, or null for the list.
   *
   * Held here rather than inside the AI events screen because opening one can *leave* that
   * screen: an unfinished event resumes into the capture flow, and a screen cannot navigate
   * out of itself in a shell that is a state machine of `if`s.
   */
  const [eventView, setEventView] = useState<number | null>(null);
  /** A close-off in flight, and the server's reason if it refused one. */
  const [closing, setClosing] = useState(false);
  const [closeProblem, setCloseProblem] = useState<string | null>(null);
  const [queueJobs, setQueueJobs] = useState<QueuedJob[]>([]);
  const [draining, setDraining] = useState(false);
  /** How far the running drain has got, and which capture is on the wire. */
  const [progress, setProgress] = useState<SyncProgress | null>(null);

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

  /**
   * What the badge on AI events counts.
   *
   * Two things are waiting, not one. A capture sitting in the offline queue has not reached
   * the server; a capture the server has but that stopped short of `completed` — no photo, no
   * payment — reached it and is still not done. Both are work the Mait has to come back to,
   * and the badge counted only the first, so on a handset with a good signal it was almost
   * always zero while the AI events screen listed rows needing attention.
   *
   * The same query Home runs, so RTK Query serves it from cache rather than fetching twice.
   */
  const allEvents = useListAiEventsQuery();
  const waiting =
    pending +
    (allEvents.data?.results ?? []).filter(
      recorded => !['completed', 'cancelled'].includes(recorded.status),
    ).length;
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

  /**
   * The animals on the chosen farmer's roster.
   *
   * Memoised: `?? []` builds a new array on every render, and an effect depending on it would
   * then run on every render — which for one that advances a step is a flow that will not
   * stand still.
   */
  const animals = useMemo(
    () =>
      (farmer?.kind === 'member' ? memberDetail.data?.animals : nonMemberDetail.data?.animals) ??
      [],
    [farmer?.kind, memberDetail.data?.animals, nonMemberDetail.data?.animals],
  );

  /**
   * Resolve the animal the check was about, once the roster it lives in has loaded.
   *
   * Only ever skips *forward*, and only while the Mait is still on the animal step — if they
   * have already chosen a different animal, or moved on, this must not reach in and change
   * what they picked. A cow can be served for a different animal in the same yard.
   */
  useEffect(() => {
    if (pendingAnimalId === null || step !== 'selectAnimal') {
      return;
    }
    const found = animals.find(row => row.id === pendingAnimalId);
    if (found) {
      setAnimal(found);
      setPendingAnimalId(null);
      setStepDirect('selectBreed');
    }
  }, [pendingAnimalId, step, animals]);

  /**
   * Tell the cached lists that the server has moved on.
   *
   * Completion, the photo upload and the queue drain all go out through `api/capture` and
   * `api/sync` as plain fetches — they have to, because they run offline and through a retry
   * queue that RTK Query knows nothing about. The cost is that nothing invalidates the event
   * cache, so a capture that had just been completed on the server was still being served
   * from memory as unfinished: the Unfinished list kept listing it and Home kept counting it,
   * and the only way to clear it was to restart the app.
   */
  const eventsChanged = useCallback(() => {
    dispatch(maitaiApi.util.invalidateTags(['AIEvent', 'Payment']));
  }, [dispatch]);

  const sync = useCallback(async () => {
    setDraining(true);
    // Both directions on one gesture. Every pull-to-refresh in the app calls this, so a Mait
    // pulling any screen also re-reads who they are and what the office has changed — which
    // is the one thing they cannot see from the handset.
    const scopeRead = refreshScope();
    const result = await drainQueue(accessToken, setProgress);
    await scopeRead;
    setPending(result.remaining);
    setQueueJobs(await readQueue());
    setDraining(false);
    // Cleared rather than left at its last value: the line is about a send happening now, and
    // a finished count sitting under the hero reads as one that is still running.
    setProgress(null);
    if (result.sent > 0) {
      setLastSyncAt(clockTime());
      // A drain can carry completions, so what the lists hold is out of date the moment one
      // lands.
      eventsChanged();
    }
  }, [accessToken, eventsChanged, refreshScope]);

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

  /**
   * Android's back gesture, which this navigator had never listened for.
   *
   * There is no react-navigation here — the shell is a state machine of `if`s — so nothing was
   * claiming the press and Android did what it does with an unhandled one: it backgrounded the
   * app. A Mait swiping back off the waiting list, expecting Home, got their whole round thrown
   * off screen instead, which on a screen whose entire purpose is "nothing here is lost" is the
   * worst possible answer.
   *
   * Each state goes exactly where that screen's own back affordance goes, and no further. The
   * steps that deliberately offer no way back — a payment taken, an event recorded and not yet
   * closed — swallow the press rather than inventing a route out of a half-finished capture.
   */
  const goBack = useCallback((): boolean => {
    /**
     * Every branch below is reversal, so every branch runs the same way: the exit and the
     * settle, and no card. Going back is not arriving anywhere — a Mait pressing back already
     * knows where they will land, and announcing it would be the app explaining a decision
     * they just made.
     *
     * The thunks call `setStepDirect`, never the shadowed `setStep`: the reversal already owns
     * the movement, and the slide underneath it would be a second transition cancelling the
     * first.
     */
    const reverse = (change: () => void): boolean => {
      transition.back(change);
      return true;
    };

    if (queueOpen) {
      return reverse(() => {
        setQueueOpen(false);
        setTab('home');
      });
    }

    if (unfinishedOpen) {
      return reverse(() => {
        setUnfinishedOpen(false);
        setTab('home');
      });
    }

    if (step) {
      const previous: Partial<Record<CaptureStep, CaptureStep | null>> = {
        ownerType: null,
        selectMpp: 'ownerType',
        selectFarmer: 'selectMpp',
        selectNonMember: 'selectMpp',
        confirmFarmer: farmer?.kind === 'member' ? 'selectFarmer' : 'selectNonMember',
        addNonMember: ownerType === 'member' ? 'selectFarmer' : 'selectNonMember',
        selectAnimal: 'confirmFarmer',
        selectBreed: 'selectAnimal',
        capturePhoto: 'selectBreed',
        collectPayment: 'capturePhoto',
        recordPayment: 'collectPayment',
        done: null,
      };

      // A step absent from the map is one with no back affordance on screen — the member's
      // statement, where the event exists and the only way on is forward. The press is taken
      // and dropped, so it cannot strand a capture.
      if (!(step in previous)) {
        return true;
      }

      const target = previous[step] ?? null;
      // Leaving the flow is reversal; stepping back inside it is a step, and keeps the flow's
      // own horizontal slide rather than dimming the whole screen.
      if (target === null) {
        return reverse(() => {
          setStepDirect(null);
          setTab('home');
        });
      }
      transition.slide('back', () => setStepDirect(target));
      return true;
    }

    // The pregnancy journey, unwound in the order it was walked. Without this, back from a
    // half-recorded check drops a Mait onto whichever tab was lit underneath and the visit
    // they were part-way through is simply gone from the screen.
    if (pdDone) {
      return reverse(() => setPdDone(null));
    }

    if (pdCheck) {
      return reverse(() => {
        setPdCheck(null);
        setPdPhoto(null);
      });
    }

    if (pdView === 'reorder') {
      return reverse(() => setPdView('route'));
    }

    if (pdView === 'route') {
      return reverse(() => setPdView('list'));
    }

    if (pdView) {
      return reverse(() => setPdView(null));
    }

    if (requestingStock) {
      return reverse(() => setRequestingStock(false));
    }

    if (indentView) {
      return reverse(() => setIndentView(0));
    }

    if (indentView === 0) {
      return reverse(() => setIndentView(null));
    }

    // The detail is layered over the AI events tab, so back closes it rather than leaving
    // the tab — the list is where it was opened from.
    if (eventView !== null) {
      return reverse(() => setEventView(null));
    }

    if (tab !== 'home') {
      return reverse(() => setTab('home'));
    }

    // Home is the bottom of the stack. Left unhandled on purpose, so back there still closes
    // the app the way every other Android app does.
    return false;
  }, [
    queueOpen,
    unfinishedOpen,
    step,
    farmer,
    ownerType,
    requestingStock,
    indentView,
    eventView,
    tab,
    transition,
    pdView,
    pdCheck,
    pdDone,
  ]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => subscription.remove();
  }, [goBack]);

  if (!accessToken) {
    return <LoginScreen />;
  }

  /**
   * Write what the Mait found, offline or not.
   *
   * The key is minted here, before anything is sent, and reused by the queued job — a check
   * happens in a yard with no signal as often as not, and a key generated at send time is new
   * on every retry and deduplicates nothing (ADR 0003).
   *
   * A failure is not an error the Mait can act on: the visit happened, the answer is known,
   * and the only thing missing is a network. So it is queued and the screen says so, rather
   * than asking somebody to examine the animal again.
   */
  const savePd = async (check: PregnancyCheck, outcome: PdOutcome, photoUri: string | null) => {
    // A result is written once. The screen already refuses to offer the choices for a check
    // that carries an outcome, and the server refuses the write regardless — this is the
    // third: a guard here means no future call site can reopen a settled record for editing
    // by wiring the screen up differently.
    if (check.outcome) {
      return;
    }

    setPdSaving(true);
    const key = newClientUuid();
    let queued = false;

    try {
      await recordPd({
        id: check.id,
        outcome,
        photoUrl: photoUri ?? undefined,
        clientUuid: key,
      }).unwrap();
    } catch {
      await enqueue(
        'recordPd',
        key,
        { checkId: check.id, outcome, photoUrl: photoUri },
        {
          farmer: check.owner_name,
          kind: check.owner_type === 'member' ? 'member' : 'nonMember',
          at: clockTime(),
          checkId: check.id,
          outcome,
        },
      );
      setPending(await pendingCount());
      queued = true;
    }

    setPdSaving(false);
    setPdPhoto(null);
    setPdDone({ check, outcome, queued });
    setPdCheck(null);
  };

  /**
   * Start a fresh insemination for the animal that was just checked.
   *
   * The card offering this promises the member and animal are already filled in, and until
   * now the button called `startCapture`, which clears everything — so it promised four steps
   * and delivered six. A promise a Mait tests once and finds false is a button they stop
   * pressing.
   *
   * Everything the check already knows is set here: who she is, which collection point, and
   * which animal. The animal itself arrives with the member's detail a moment later, so it is
   * held as an id and resolved by the effect below — landing on the animal step meanwhile,
   * which is a step forward rather than a wait.
   */
  const startCaptureFor = (check: PregnancyCheck) => {
    setEvent(null);
    setAnimal(null);
    setClientUuid(newClientUuid());

    const isMember = check.owner_type === 'member';
    setOwnerType(isMember ? 'member' : 'nonMember');
    setFarmer(
      isMember
        ? { kind: 'member', name: check.owner_name, memberCode: check.member_code }
        : { kind: 'nonMember', name: check.owner_name, nonMemberId: check.non_member_id ?? 0 },
    );
    // Built from what the check carries rather than looked up: the flow only ever shows the
    // code and the name, and a round trip here would be a spinner between two taps.
    setMpp({ id: check.mpp_id, mpp_code: check.mpp_code, mpp_name: check.mpp_name } as MPP);
    setPendingAnimalId(check.animal_id);

    transition.go('capture', () => setStepDirect('selectAnimal'));
  };

  /** The next check still open, so the done screen can point at the rest of the round. */
  const nextPdAfter = (check: PregnancyCheck): PregnancyCheck | null =>
    (pdChecks.data?.results ?? []).find(row => row.id !== check.id && !row.outcome) ?? null;

  const startCapture = () => {
    setMpp(null);
    setFarmer(null);
    setAnimal(null);
    setEvent(null);
    setOwnerType('member');
    setClientUuid(newClientUuid());
    // The one step change in the flow that announces itself: this is arriving somewhere, not
    // moving within somewhere. Everything after it is a step, and gets the slide.
    transition.go('capture', () => setStepDirect('ownerType'));
  };

  const leaveCapture = () => {
    transition.back(() => {
      setStepDirect(null);
      setTab('home');
    });
  };

  /**
   * Who the capture in progress is for, to be written onto every job it queues.
   *
   * The waiting list is read on a handset that by definition cannot reach the server, so a row
   * that had to ask who the farmer was would be blank exactly when it is needed — which is why
   * the name travels with the job rather than being looked up later.
   *
   * Only the payment job used to carry one. A member never queues a payment, so a member's
   * record reached that screen with nothing to show but the word "Capture": a Mait scrolling a
   * list of anonymous rows, looking for the insemination they are afraid went missing, cannot
   * tell whether it is there.
   */
  const captureLabel = (mode?: PaymentMode): QueuedLabel => ({
    farmer: farmer?.name ?? '',
    kind: farmer?.kind === 'member' ? 'member' : 'nonMember',
    amount: event?.amount_due ?? null,
    ...(mode ? { mode } : {}),
    at: clockTime(),
    ...(event ? { eventId: event.id } : {}),
  });

  /**
   * Pick a half-finished capture back up, at the step it actually stopped on.
   *
   * This used to send every resume to the photo step, which is right for one of the four
   * places a capture can be abandoned and wrong for the other three — a Mait resumed at the
   * camera for an event that already had its photo would take a second one and still not
   * close it. `resumePoint` owns that mapping, and the Unfinished list labels its rows from
   * the same function, so what the row promises is what tapping it does.
   *
   * The farmer is rebuilt from the event rather than re-fetched: every screen a resume lands
   * on needs her name and her key, and both travel on the record. The event's own
   * `client_uuid` is restored with it — minting a new one here would make the retry a second
   * insemination as far as the server is concerned (ADR 0003).
   */
  const resumeCapture = async (unfinished: AIEvent) => {
    const point = resumePoint(unfinished);

    setEvent(unfinished);
    setClientUuid(unfinished.client_uuid);
    setOwnerType(unfinished.owner_type === 'member' ? 'member' : 'nonMember');
    setFarmer(
      unfinished.owner_type === 'member'
        ? {
            kind: 'member',
            name: unfinished.owner_name,
            memberCode: unfinished.member_code,
          }
        : {
            kind: 'nonMember',
            name: unfinished.owner_name,
            nonMemberId: unfinished.non_member ?? 0,
          },
    );

    // Enough of the MPP and the animal for the steps a resume can land on. Neither screen
    // reads more than these — the full records are a round trip this flow does not need, and
    // the Mait is standing in a yard.
    setMpp({
      id: unfinished.mpp,
      mpp_code: unfinished.mpp_code,
      mpp_name: unfinished.mpp_name,
    } as MPP);
    setAnimal({
      id: unfinished.animal,
      animal_type: unfinished.animal_type,
      breed: unfinished.breed,
      ear_tag_no: unfinished.ear_tag_no,
    } as Animal);

    /**
     * A payment already confirmed has nothing left to ask for.
     *
     * `payment_pending` covers two different situations. Usually her code never came back,
     * and the resume below is right: the screen asks for it. But the same status also holds
     * the event whose payment *is* verified and whose completion never ran — a connection
     * that died at the last step, which is a common way for a round to end.
     *
     * Sending that one to the code screen was a dead end with no way out of it. Her OTP was
     * spent when it was verified, so no new one is coming; the screen's button stays disabled
     * until six digits are typed, and there are no six digits to type. A Mait could open that
     * record every day for a week and it would still say "Needs attention" afterwards.
     *
     * So it is closed here instead, which is all it ever needed: the completion is the only
     * call that has not been made.
     */
    if (whatIsMissing(unfinished) === 'notClosed') {
      setClosing(true);
      setCloseProblem(null);

      const outcome = await completeEvent(
        unfinished.id,
        unfinished.client_uuid,
        accessToken,
        {
          farmer: unfinished.owner_name,
          kind: unfinished.owner_type === 'member' ? 'member' : 'nonMember',
          amount: unfinished.amount_due,
          at: clockTime(),
          eventId: unfinished.id,
        },
        // The straw this record holds may already have gone — used by another event back when
        // the picker could hand the same one to two captures. The insemination happened and
        // that straw is spent, so the server may close this without taking a second one. It
        // deducts as normal wherever the straw is still there.
        { withoutStock: true },
      );
      setPending(outcome.remaining);
      setClosing(false);

      // Refused, not merely unsent: nothing is queued and no retry will help, so the Mait is
      // told why — in the server's own words, which name the actual obstacle — and left on
      // the record rather than shown a screen saying it was saved.
      if (!outcome.sent && !outcome.queued) {
        setCloseProblem(outcome.problem ?? t('aiEvent.couldNotClose'));
        return;
      }

      if (outcome.sent) {
        setLastSyncAt(clockTime());
        inventory.refetch();
      }
      // Either way the lists are out of date: completed on the server, or queued on the phone
      // and now belonging to the handset's own count rather than to the work still owed.
      eventsChanged();
      setEventView(null);
      setUnfinishedOpen(false);
      setStep('done');
      return;
    }

    // A payment already started is waiting on her code, so the screen has to ask for one.
    //
    // This used to clear `codeSentTo`, which is the state meaning "there was no signal to send
    // a code with" — so the screen offered to save without one, the completion behind it was
    // refused because the payment is not verified, and the capture stayed exactly where it
    // was. The Mait resumed it, tapped the only button on the screen, and watched nothing
    // happen for as many times as they cared to try.
    //
    // The mode is the one already recorded against the payment, not a guess: a farmer who
    // chose UPI must not be resumed into a cash record. An expired code is handled by the
    // screen's own "send again", which is why that link has to be there.
    if (point.step === 'recordPayment') {
      setPayMode(unfinished.payment?.mode === 'ONLINE' ? 'ONLINE' : 'COD');
      setCodeSentTo(t('payment.herNumber'));
      setPayCode('');
      setPayProblem(null);
    }

    setPayFailed(null);
    setUnfinishedOpen(false);
    setStep(point.step);
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
          captureLabel(mode ?? 'COD'),
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

    const outcome = await completeEvent(event.id, clientUuid, accessToken, captureLabel(mode));
    setPending(outcome.remaining);
    if (outcome.sent) {
      setLastSyncAt(clockTime());
      inventory.refetch();
      // The capture is closed on the server. Without this the list it was picked from goes on
      // offering it, which reads as the work not having been recorded at all.
      eventsChanged();
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
  const chooseNonMember = (selected: NonMember | NonMemberSummary) => {
    setFarmer({ kind: 'nonMember', name: selected.name, nonMemberId: selected.id });
    setStep('confirmFarmer');
  };

  /**
   * The tab bar rides along everywhere except the camera.
   *
   * It used to disappear from the straw scan onward, on the reasoning that a bar under a
   * half-captured insemination invites a Mait to strand one — an animal served, a straw
   * spent, nothing recorded. That reasoning depended on a stranded capture being
   * unrecoverable, which it no longer is: anything left half-done shows up in Unfinished and
   * resumes at the step it stopped on. Hiding the bar now buys nothing and costs a Mait the
   * ability to check their stock or answer a waiting record without abandoning the screen —
   * and on the payment steps, which are the ones they linger on, that mattered.
   *
   * The camera keeps no bar: it is a viewfinder, not a screen with furniture.
   */
  const withTabs = (screen: React.JSX.Element, active: Tab = 'home') => (
    <View style={styles.flex}>
      <RouteTransitionHost transition={transition}>{screen}</RouteTransitionHost>
      <Toast
        message={closeProblem}
        onDismiss={() => setCloseProblem(null)}
        testID="close-off-error"
      />
      <Toast message={scopeNotice} tone="info" onDismiss={scope.clear} testID="scope-changed" />
      <BottomNav
        // Lit as soon as the tap lands, while the screen behind is still the old one. That
        // is the point of the exit phase: something has to have answered the tap.
        active={pendingTab ?? active}
        pending={waiting}
        onChange={next => {
          // No "already there" guard here, unlike the tab bar below. This one only ever draws
          // under the capture flow, where `active` is the tab the flow was entered from and a
          // tap on it means "leave this and go back there" — guarding it would strand a Mait
          // in the flow with a bar that answers nothing.
          transition.go(next, () => {
            setStepDirect(null);
            // The waiting list is layered over the tabs like the capture flow is, so it has to be
            // closed here too. Without this a tab press left it open and every destination drew
            // the queue instead — the bar moved and the screen did not. The unfinished list and
            // the event being read are layered the same way and need the same closing.
            setQueueOpen(false);
            setUnfinishedOpen(false);
            setEventView(null);
            setTab(next);
          });
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
          // The fork answered at step 1 decides which roster this is. A non-member is not in
          // the SAP master, but she is very often in the one the Maits themselves have built
          // — she was registered on an earlier visit — so both branches open a list and both
          // keep registering somebody new as the way out of it.
          setStep(ownerType === 'member' ? 'selectFarmer' : 'selectNonMember');
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

  if (step === 'selectNonMember' && mpp) {
    return withTabs(
      <SelectNonMemberScreen
        mpp={mpp}
        onSelect={chooseNonMember}
        onAddNew={() => setStep('addNonMember')}
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
        // Back to whichever roster she was picked from. Never into the form that may have
        // made her — re-submitting it would try to register the same woman twice, which the
        // server now refuses outright.
        onSearchAgain={() => setStep(farmer.kind === 'member' ? 'selectFarmer' : 'selectNonMember')}
      />,
    );
  }

  if (step === 'addNonMember' && mpp) {
    return withTabs(
      <AddNonMemberScreen
        mpp={mpp}
        onCreated={chooseNonMember}
        // Back to whichever roster this was reached from — the members, if the Mait went
        // looking there first, or the non-members they were just picking through.
        onCancel={() => setStep(ownerType === 'member' ? 'selectFarmer' : 'selectNonMember')}
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
          const outcome = await attachPhoto(
            event.id,
            clientUuid,
            photo,
            accessToken,
            captureLabel(),
          );
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
    return withTabs(
      <MemberNothingToCollectScreen
        event={event}
        farmerName={farmer.name}
        animalLabel={animalLabel}
        busy={payBusy}
        failed={payFailed}
        onFinish={() => finishCapture()}
      />,
    );
  }

  if (step === 'collectPayment' && event && farmer) {
    return withTabs(
      <CollectPaymentScreen
        event={event}
        farmerName={farmer.name}
        online={online}
        busy={payBusy}
        failed={payFailed}
        onContinue={startCollection}
        onBack={() => setStep('capturePhoto')}
      />,
    );
  }

  if (step === 'recordPayment' && event && farmer) {
    return withTabs(
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
            } catch (err) {
              // Wrong, expired and out of attempts need three different things from a Mait
              // standing in a yard: read it again, send a new one, or stop asking. Collapsing
              // them into "that code is not right" sent a Mait back to a farmer to re-read a
              // number that could never work — the same distinction the farmer-verification
              // step has always made.
              switch (errorCodeOf(err)) {
                case ErrorCode.OTP_EXPIRED:
                  setPayProblem(t('aiFlow.otpExpired'));
                  setCodeSentTo(null);
                  break;
                case ErrorCode.OTP_ATTEMPTS_EXCEEDED:
                  setPayProblem(t('aiFlow.otpAttemptsExceeded'));
                  setCodeSentTo(null);
                  break;
                default:
                  setPayProblem(t('aiFlow.otpWrong'));
              }
              setPayBusy(false);
              return;
            }
            setPayBusy(false);
          }
          // The mode, not nothing. Without it the completion re-opened the payment with no
          // mode at all, which the server refuses for a non-member — "Say how she is paying"
          // — so a correct code was followed by a capture that would not close, and the next
          // tap reported the already-spent code as wrong.
          await finishCapture(payMode);
        }}
        onBack={() => setStep('collectPayment')}
      />,
    );
  }

  if (unfinishedOpen) {
    return withTabs(
      <UnfinishedScreen
        onResume={resumeCapture}
        onBack={() => {
          setUnfinishedOpen(false);
          setTab('home');
        }}
      />,
      // It counts against AI events, so that is the tab it belongs to.
      'history',
    );
  }

  if (queueOpen) {
    // The uuid on the wire is what tells one row's "Syncing" from the rest of the list's
    // "Waiting" — without it every row claimed to be moving at once.
    const captures = toCaptures(queueJobs, progress?.clientUuid);
    return withTabs(
      <SyncQueueScreen
        captures={captures}
        synced={[]}
        // The drain's own count, not a placeholder. It used to be pinned at `done: 0`, so a
        // long send read "Sending 0 of 3…" from start to finish — which is what being stuck
        // looks like.
        progress={draining && progress && progress.total > 0 ? progress : null}
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
        // Home, the same place the back gesture goes. The list is reached from Home's tile, and
        // the two ways out of a screen should not land in two different places.
        onBack={() => {
          setQueueOpen(false);
          setTab('home');
        }}
      />,
      // The count of what is waiting rides on AI events, so that is the tab this screen
      // belongs to — Home was lit while a different screen was open.
      'history',
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
      <RouteTransitionHost transition={transition}>
        {/* Keeps the bar, unlike the capture flow: asking for stock is a form a Mait can
            abandon by tapping another tab, not a sequence they can strand halfway. */}
        {requestingStock && <RequestStockScreen onDone={() => setRequestingStock(false)} />}

        {!requestingStock && tab === 'home' && indentView === null && (
          <HomeScreen
            onOpenStock={() => setTab('stock')}
            onStartCapture={startCapture}
            onOpenUnfinished={() => setUnfinishedOpen(true)}
            online={online}
            pending={pending}
            // Pull-to-refresh drains and stays put. It shared a prop with the tile below, so
            // tugging Home down to reload it opened the waiting list instead.
            onSync={sync}
            // The tile answers for itself: it opens the list of what is waiting, and pushes at
            // the same time. A number that only kicks an invisible drain leaves a Mait unable
            // to tell a bad network from a lost day's work.
            onOpenQueue={() => {
              setQueueOpen(true);
              refreshQueue();
              sync();
            }}
            lastSyncAt={lastSyncAt}
          />
        )}
        {/* The indents are layered over whichever tab opened them — Inventory, where stock is
            asked for, and Profile, where "where is my order" is asked. Back closes them onto
            the tab that was lit rather than moving the Mait somewhere they never chose. */}
        {!requestingStock && indentView === 0 && (
          <IndentsScreen
            onOpen={indent => transition.go('indentDetail', () => setIndentView(indent.id))}
            onBack={() => transition.back(() => setIndentView(null))}
          />
        )}
        {!requestingStock && !!indentView && (
          <IndentDetailScreen
            indentId={indentView}
            onBack={() => transition.back(() => setIndentView(0))}
          />
        )}
        {!requestingStock && tab === 'stock' && indentView === null && (
          <StockScreen
            onSync={sync}
            onRequestStock={() => {
              setIndentView(null);
              setRequestingStock(true);
            }}
          />
        )}
        {!requestingStock && tab === 'history' && indentView === null && eventView === null && (
          <AiEventsScreen
            onOpen={opened => transition.go('aiEventDetail', () => setEventView(opened.id))}
            onSync={sync}
          />
        )}
        {!requestingStock && tab === 'history' && indentView === null && eventView !== null && (
          <AiEventDetailScreen
            eventId={eventView}
            onBack={() => transition.back(() => setEventView(null))}
            // An unfinished event is picked up at the step it stopped on, by the same
            // function the Unfinished list uses — so what the detail screen's button promises
            // and where it lands cannot drift apart.
            onResume={resumeCapture}
            busy={closing}
          />
        )}
        {/* Pregnancy checks, layered over whichever tab opened them — Profile, where a Mait
            asks "what do I owe a visit". The three screens are one journey and share the
            record being worked on, so they live here rather than inside the list. */}
        {!requestingStock && pdView === 'list' && !pdCheck && !pdDone && (
          <PdListScreen
            onOpen={check => transition.go('pdRecord', () => setPdCheck(check))}
            onPlanRoute={() => transition.go('pdRoute', () => setPdView('route'))}
            onSync={sync}
          />
        )}
        {/* The round, and the choice of how to order it. Both read the one route response, so
            picking an order needs no network — which is the point of computing it once. */}
        {!requestingStock && pdView === 'route' && !pdCheck && !pdDone && !!pdRoute.data && (
          <PdRouteScreen
            option={pdRoute.data.options[pdOrder]}
            orderKey={pdOrder}
            fromHere={pdRoute.data.from_here}
            startPoint={pdFrom}
            withoutLocation={pdRoute.data.without_location}
            onBack={() => transition.back(() => setPdView('list'))}
            onReorder={() => transition.go('pdReorder', () => setPdView('reorder'))}
            onOpenStop={stop => transition.go('pdRecord', () => setPdCheck(stop))}
          />
        )}
        {!requestingStock && pdView === 'reorder' && !!pdRoute.data && (
          <PdReorderScreen
            route={pdRoute.data}
            current={pdOrder}
            onBack={() => transition.back(() => setPdView('route'))}
            onUse={order =>
              transition.back(() => {
                setPdOrder(order);
                setPdView('route');
              })
            }
          />
        )}

        {!requestingStock && !!pdCheck && (
          <PdRecordScreen
            check={pdCheck}
            photoUri={pdPhoto}
            busy={pdSaving}
            onBack={() => transition.back(() => setPdCheck(null))}
            onPhoto={setPdPhoto}
            onSave={(outcome, photoUri) => savePd(pdCheck, outcome, photoUri)}
          />
        )}
        {!requestingStock && !!pdDone && (
          <PdDoneScreen
            check={pdDone.check}
            outcome={pdDone.outcome}
            queued={pdDone.queued}
            next={nextPdAfter(pdDone.check)}
            onStartAi={() => {
              // She is not in calf, she is in heat, and the Mait is standing in the yard.
              // Sending them back to Home to start from scratch is how a second service
              // becomes a visit nobody makes.
              const from = pdDone.check;
              setPdDone(null);
              setPdView(null);
              startCaptureFor(from);
            }}
            onOpenNext={() => {
              const next = nextPdAfter(pdDone.check);
              transition.go('pdRecord', () => {
                setPdDone(null);
                setPdCheck(next);
              });
            }}
            onBackToList={() => transition.back(() => setPdDone(null))}
          />
        )}

        {!requestingStock && tab === 'settings' && indentView === null && pdView === null && (
          <SettingsScreen
            pending={pending}
            onSync={sync}
            online={online}
            lastSyncAt={lastSyncAt}
            onOpenIndents={() => transition.go('indents', () => setIndentView(0))}
            onOpenPd={() => transition.go('pd', () => setPdView('list'))}
          />
        )}
      </RouteTransitionHost>

      {/* A close-off the server refused. Anchored to the top of the app rather than put in
          the screen below, because it is about the request rather than about anything on the
          page — and the page is a record, which must not start looking like a form. */}
      <Toast
        message={closeProblem}
        onDismiss={() => setCloseProblem(null)}
        testID="close-off-error"
      />
      {/* Anchored to the app rather than to a screen: the office can reassign a Mait while
          they are anywhere, and the news does not belong to whichever page happens to be up. */}
      <Toast message={scopeNotice} tone="info" onDismiss={scope.clear} testID="scope-changed" />

      {/* Destinations only. Each screen's own action lives at the foot of that screen's
          content — "Start new AI" on Home, "Request stock" on Inventory — where it is next to
          the thing it acts on rather than in the furniture. */}
      <BottomNav
        active={pendingTab ?? tab}
        pending={waiting}
        onChange={next => {
          // A tab that is already lit is not a destination. Without this, tapping the tab you
          // are on announces a journey to where you already are.
          // Every layer that can sit *over* a tab has to be listed here. Tapping Profile
          // while the pregnancy checks are open is a real destination — they were opened
          // from Profile, so the tab underneath is already lit and the guard would otherwise
          // swallow the tap and strand the Mait on the list.
          if (
            next === tab &&
            indentView === null &&
            eventView === null &&
            pdView === null &&
            !requestingStock
          ) {
            return;
          }
          transition.go(next, () => {
            // Switching tabs leaves the form. Nothing is lost that was worth keeping — an
            // unsent indent is a decision not yet made.
            setRequestingStock(false);
            setIndentView(null);
            setEventView(null);
            setPdView(null);
            setPdCheck(null);
            setPdDone(null);
            setTab(next);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
