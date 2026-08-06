/**
 * Navigation shell (SRS §6.3, §10.3).
 *
 * The AI capture flow is a fixed six-step sequence, so a stack that always moves forward
 * fits it better than free navigation. Each screen carries its own header, step number and
 * progress bar (docs/DESIGN_SYSTEM.md — "Capture-flow screen pattern"), so there is no
 * chrome here wrapping them: a shared header would have to be told what every screen is
 * called, and would drift from the screen it describes.
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
import { pendingCount } from '@api/queue';
import { drainQueue } from '@api/sync';
import { useGetMemberQuery, useGetNonMemberQuery } from '@api/endpoints';
import type { AIEvent, Animal, Member, MPP, NonMember } from '@api/types';
import { Banner, Screen } from '@/components';
import AddNonMemberScreen from '@/features/aiFlow/AddNonMemberScreen';
import CapturePhotoScreen from '@/features/aiFlow/CapturePhotoScreen';
import ScanStrawScreen from '@/features/aiFlow/ScanStrawScreen';
import SelectAnimalScreen from '@/features/aiFlow/SelectAnimalScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import { useAppSelector } from '@/store';
import { colors, spacing, typography } from '@theme/tokens';

type FlowScreenName =
  | 'selectMpp'
  | 'selectFarmer'
  | 'addNonMember'
  | 'selectAnimal'
  | 'scanStraw'
  | 'capturePhoto'
  | 'notBuiltYet';

/** Who the capture is for. Exactly one of the two codes is ever set. */
type Farmer =
  | { kind: 'member'; name: string; memberCode: string }
  | { kind: 'nonMember'; name: string; nonMemberId: number };

export default function RootNavigator(): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const accessToken = useAppSelector(state => state.auth.accessToken);

  const [screen, setScreen] = useState<FlowScreenName>('selectMpp');
  const [clientUuid, setClientUuid] = useState(newClientUuid);
  const [mpp, setMpp] = useState<MPP | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [event, setEvent] = useState<AIEvent | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingJobs, setPendingJobs] = useState(0);

  // The farmer's animals ride along on their detail record, so step 3 costs no extra call.
  // Skipped entirely until there is a farmer to fetch.
  const memberDetail = useGetMemberQuery(farmer?.kind === 'member' ? farmer.memberCode : '', {
    skip: farmer?.kind !== 'member',
  });
  const nonMemberDetail = useGetNonMemberQuery(
    farmer?.kind === 'nonMember' ? farmer.nonMemberId : 0,
    { skip: farmer?.kind !== 'nonMember' },
  );

  const sync = useCallback(async () => {
    const result = await drainQueue(accessToken);
    setPendingJobs(result.remaining);
  }, [accessToken]);

  /**
   * Drain when the connection returns, and once on mount.
   *
   * A Mait finishes a round in a village with no signal and rides back through one. Waiting
   * for them to reopen the app would leave a day's events sitting on a handset that might be
   * dropped in a canal before anyone noticed.
   */
  useEffect(() => {
    pendingCount().then(setPendingJobs);

    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected) {
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

  const chooseMember = (selected: Member) => {
    setFarmer({ kind: 'member', name: selected.member_name, memberCode: selected.member_code });
    setScreen('selectAnimal');
  };

  const chooseNonMember = (selected: NonMember) => {
    setFarmer({ kind: 'nonMember', name: selected.name, nonMemberId: selected.id });
    setScreen('selectAnimal');
  };

  if (screen === 'selectMpp') {
    return (
      <SelectMppScreen
        onSelect={selected => {
          setMpp(selected);
          setScreen('selectFarmer');
        }}
      />
    );
  }

  if (screen === 'selectFarmer' && mpp) {
    return (
      <SelectFarmerScreen
        mpp={mpp}
        onSelectMember={chooseMember}
        onAddNonMember={() => setScreen('addNonMember')}
        onBack={() => setScreen('selectMpp')}
      />
    );
  }

  if (screen === 'addNonMember' && mpp) {
    return (
      <AddNonMemberScreen
        mpp={mpp}
        onCreated={chooseNonMember}
        onCancel={() => setScreen('selectFarmer')}
      />
    );
  }

  if (screen === 'selectAnimal' && farmer) {
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
          setScreen('scanStraw');
        }}
        onBack={() => setScreen('selectFarmer')}
      />
    );
  }

  if (screen === 'scanStraw' && mpp && farmer && animal) {
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
          setScreen('capturePhoto');
        }}
        onBack={() => setScreen('selectAnimal')}
      />
    );
  }

  if (screen === 'capturePhoto' && event) {
    return (
      <CapturePhotoScreen
        busy={uploading}
        onCaptured={async photo => {
          setUploading(true);
          const queued = await attachPhoto(event.id, clientUuid, photo, accessToken);
          setUploading(false);
          setPendingJobs(queued.remaining);
          // The next capture is a different event, so it needs a different identity —
          // reusing this one would make the server replay the one just finished.
          setClientUuid(newClientUuid());
          setScreen('notBuiltYet');
        }}
        onBack={() => setScreen('scanStraw')}
      />
    );
  }

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
        {/* What is still on the handset. Shown as a fact rather than an error: queued is the
            normal state of an event captured in a village, not a failure. */}
        {pendingJobs > 0 && (
          <Text style={styles.pending} testID="pending-queue">
            {t('aiFlow.savedOfflineBody', { count: pendingJobs })}
          </Text>
        )}
      </Screen>
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
});
