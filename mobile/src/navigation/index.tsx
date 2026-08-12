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
import { StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { attachPhoto } from '@api/capture';
import { newClientUuid } from '@api/client';
import { useGetMemberQuery, useGetNonMemberQuery } from '@api/endpoints';
import { pendingCount } from '@api/queue';
import { drainQueue } from '@api/sync';
import type { AIEvent, Animal, Member, MPP, NonMember } from '@api/types';
import { Banner, Screen } from '@/components';
import BottomNav, { Tab } from '@/components/BottomNav';
import AddNonMemberScreen from '@/features/aiFlow/AddNonMemberScreen';
import CapturePhotoScreen from '@/features/aiFlow/CapturePhotoScreen';
import ConfirmMemberScreen from '@/features/aiFlow/ConfirmMemberScreen';
import ScanStrawScreen from '@/features/aiFlow/ScanStrawScreen';
import SelectAnimalScreen from '@/features/aiFlow/SelectAnimalScreen';
import SelectBreedScreen from '@/features/aiFlow/SelectBreedScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import OwnerTypeScreen, { OwnerType } from '@/features/aiFlow/OwnerTypeScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import HistoryScreen from '@/features/history/HistoryScreen';
import HomeScreen from '@/features/home/HomeScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import IndentDetailScreen from '@/features/stock/IndentDetailScreen';
import IndentsScreen from '@/features/stock/IndentsScreen';
import RequestStockScreen from '@/features/stock/RequestStockScreen';
import StockScreen from '@/features/stock/StockScreen';
import { useAppSelector } from '@/store';
import { colors, spacing, typography } from '@theme/tokens';

/** Where the capture flow has got to. `null` means it is not running. */
type CaptureStep =
  | 'ownerType'
  | 'selectMpp'
  | 'selectFarmer'
  | 'confirmMember'
  | 'addNonMember'
  | 'selectAnimal'
  | 'selectBreed'
  | 'scanStraw'
  | 'capturePhoto'
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
  const insets = useSafeAreaInsets();
  const accessToken = useAppSelector(state => state.auth.accessToken);

  const [tab, setTab] = useState<Tab>('home');
  const [step, setStep] = useState<CaptureStep | null>(null);
  const [requestingStock, setRequestingStock] = useState(false);
  /** null = not looking at indents, 0 = the list, n = that indent. */
  const [indentView, setIndentView] = useState<number | null>(null);

  const [clientUuid, setClientUuid] = useState(newClientUuid);
  /** Answered at step 1, and it decides where step 3 goes. */
  const [ownerType, setOwnerType] = useState<OwnerType>('member');
  const [mpp, setMpp] = useState<MPP | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
  /** The breed of straw the Mait said they would use, chosen before the number is entered. */
  const [semenBreed, setSemenBreed] = useState<string | null>(null);
  const [event, setEvent] = useState<AIEvent | null>(null);

  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const memberDetail = useGetMemberQuery(farmer?.kind === 'member' ? farmer.memberCode : '', {
    skip: farmer?.kind !== 'member',
  });
  const nonMemberDetail = useGetNonMemberQuery(
    farmer?.kind === 'nonMember' ? farmer.nonMemberId : 0,
    { skip: farmer?.kind !== 'nonMember' },
  );

  const sync = useCallback(async () => {
    const result = await drainQueue(accessToken);
    setPending(result.remaining);
    if (result.sent > 0) {
      setLastSyncAt(clockTime());
    }
  }, [accessToken]);

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
   * A member is chosen, then read back before the flow acts on it.
   *
   * The roster is searched by a sixteen-digit code as often as by name, and a wrong one does
   * not fail — it succeeds against somebody else. The confirmation screen is where that is
   * caught, so selection lands there rather than at the animal.
   */
  const chooseMember = (selected: Member) => {
    setFarmer({ kind: 'member', name: selected.member_name, memberCode: selected.member_code });
    setStep('confirmMember');
  };

  const chooseNonMember = (selected: NonMember) => {
    setFarmer({ kind: 'nonMember', name: selected.name, nonMemberId: selected.id });
    setStep('selectAnimal');
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

  if (step === 'confirmMember' && farmer?.kind === 'member') {
    return withTabs(
      <ConfirmMemberScreen
        memberCode={farmer.memberCode}
        onConfirm={() => setStep('selectAnimal')}
        onSearchAgain={() => setStep('selectFarmer')}
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
        onBack={() => setStep(ownerType === 'member' ? 'confirmMember' : 'selectMpp')}
      />,
    );
  }

  if (step === 'selectBreed' && animal) {
    return withTabs(
      <SelectBreedScreen
        animalType={animal.animal_type}
        onSelect={breed => {
          setSemenBreed(breed.code);
          setStep('scanStraw');
        }}
        onBack={() => setStep('selectAnimal')}
      />,
    );
  }

  if (step === 'scanStraw' && mpp && farmer && animal) {
    return (
      <ScanStrawScreen
        capture={{
          clientUuid,
          mppCode: mpp.mpp_code,
          memberCode: farmer.kind === 'member' ? farmer.memberCode : undefined,
          nonMemberId: farmer.kind === 'nonMember' ? farmer.nonMemberId : undefined,
          animalId: animal.id,
          // Chosen at the previous step, and sent with the check: it is what tells an
          // unnumbered straw apart when the Mait is carrying two breeds of them.
          semenBreed,
        }}
        onCreated={created => {
          setEvent(created);
          setStep('capturePhoto');
        }}
        onBack={() => setStep('selectBreed')}
      />
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
          setStep('done');
        }}
        onBack={() => setStep('scanStraw')}
      />
    );
  }

  if (step === 'done') {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <Screen>
          <Banner tone="info" message={t('aiFlow.comingNext')} testID="not-built-yet" />
          <Text style={styles.selected}>{farmer?.name}</Text>
          {!!event && (
            <Text style={styles.selected}>
              {t('aiFlow.strawVerified')} · {event.straw_unique_no}
            </Text>
          )}
          {pending > 0 && (
            <Text style={styles.pending} testID="pending-queue">
              {t('aiFlow.savedOfflineBody', { count: pending })}
            </Text>
          )}
          <Text style={styles.doneLink} onPress={leaveCapture} testID="capture-done">
            {t('home.backToHome')}
          </Text>
        </Screen>
      </View>
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
            onSync={sync}
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
  selected: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing[3],
  },
  pending: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing[4],
  },
  doneLink: {
    ...typography.bodyStrong,
    color: colors.primaryDark,
    textAlign: 'center',
    marginTop: spacing[5],
  },
});
