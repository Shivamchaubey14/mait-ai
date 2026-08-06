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
import ScanStrawScreen from '@/features/aiFlow/ScanStrawScreen';
import SelectAnimalScreen from '@/features/aiFlow/SelectAnimalScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import HistoryScreen from '@/features/history/HistoryScreen';
import HomeScreen from '@/features/home/HomeScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import RequestStockScreen from '@/features/stock/RequestStockScreen';
import StockScreen from '@/features/stock/StockScreen';
import { useAppSelector } from '@/store';
import { colors, spacing, typography } from '@theme/tokens';

/** Where the capture flow has got to. `null` means it is not running. */
type CaptureStep =
  | 'selectMpp'
  | 'selectFarmer'
  | 'addNonMember'
  | 'selectAnimal'
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

  const [clientUuid, setClientUuid] = useState(newClientUuid);
  const [mpp, setMpp] = useState<MPP | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
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
    setClientUuid(newClientUuid());
    setStep('selectMpp');
  };

  const leaveCapture = () => {
    setStep(null);
    setTab('home');
  };

  const chooseMember = (selected: Member) => {
    setFarmer({ kind: 'member', name: selected.member_name, memberCode: selected.member_code });
    setStep('selectAnimal');
  };

  const chooseNonMember = (selected: NonMember) => {
    setFarmer({ kind: 'nonMember', name: selected.name, nonMemberId: selected.id });
    setStep('selectAnimal');
  };

  // Layered over the tabs like the capture flow, and for the same reason: it is one task
  // with one forward path.
  if (requestingStock) {
    return (
      <RequestStockScreen
        onDone={() => setRequestingStock(false)}
        onBack={() => setRequestingStock(false)}
      />
    );
  }

  // -- the capture flow, over the tabs ---------------------------------------------------
  if (step === 'selectMpp') {
    return (
      <SelectMppScreen
        // Back from step 1 leaves the flow. Without it the capture is a one-way door: the tab
        // bar is hidden here, so this arrow is the only way home.
        onBack={leaveCapture}
        onSelect={selected => {
          setMpp(selected);
          setStep('selectFarmer');
        }}
      />
    );
  }

  if (step === 'selectFarmer' && mpp) {
    return (
      <SelectFarmerScreen
        mpp={mpp}
        onSelectMember={chooseMember}
        onAddNonMember={() => setStep('addNonMember')}
        onBack={() => setStep('selectMpp')}
      />
    );
  }

  if (step === 'addNonMember' && mpp) {
    return (
      <AddNonMemberScreen
        mpp={mpp}
        onCreated={chooseNonMember}
        onCancel={() => setStep('selectFarmer')}
      />
    );
  }

  if (step === 'selectAnimal' && farmer) {
    return (
      <SelectAnimalScreen
        owner={{
          name: farmer.name,
          memberCode: farmer.kind === 'member' ? farmer.memberCode : undefined,
          nonMemberId: farmer.kind === 'nonMember' ? farmer.nonMemberId : undefined,
        }}
        animals={animals}
        onSelect={selected => {
          setAnimal(selected);
          setStep('scanStraw');
        }}
        onBack={() => setStep('selectFarmer')}
      />
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
        }}
        onCreated={created => {
          setEvent(created);
          setStep('capturePhoto');
        }}
        onBack={() => setStep('selectAnimal')}
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
        {tab === 'home' && (
          <HomeScreen
            onOpenStock={() => setTab('stock')}
            online={online}
            pending={pending}
            onSync={sync}
            lastSyncAt={lastSyncAt}
          />
        )}
        {tab === 'stock' && <StockScreen />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'settings' && <SettingsScreen pending={pending} onSync={sync} online={online} />}
      </View>

      {/* The action follows the screen: ask for stock from Stock, start a capture anywhere
          else. One control, always in the same place, saying what it will do. */}
      <BottomNav
        active={tab}
        pending={pending}
        onChange={setTab}
        action={
          tab === 'stock'
            ? {
                label: t('requestStock.action'),
                onPress: () => setRequestingStock(true),
                testID: 'bar-request-stock',
              }
            : { label: t('home.startNewAi'), onPress: startCapture, testID: 'bar-start-ai' }
        }
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
