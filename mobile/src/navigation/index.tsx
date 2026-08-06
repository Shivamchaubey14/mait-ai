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

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { newClientUuid } from '@api/client';
import { useGetMemberQuery, useGetNonMemberQuery } from '@api/endpoints';
import type { AIEvent, Animal, Member, MPP, NonMember } from '@api/types';
import { Banner, Screen } from '@/components';
import AddNonMemberScreen from '@/features/aiFlow/AddNonMemberScreen';
import ScanStrawScreen from '@/features/aiFlow/ScanStrawScreen';
import SelectAnimalScreen from '@/features/aiFlow/SelectAnimalScreen';
import SelectFarmerScreen from '@/features/aiFlow/SelectFarmerScreen';
import SelectMppScreen from '@/features/aiFlow/SelectMppScreen';
import LoginScreen from '@/features/auth/LoginScreen';
import { useAppSelector } from '@/store';
import { colors, spacing, typography } from '@theme/tokens';

type FlowScreenName =
  'selectMpp' | 'selectFarmer' | 'addNonMember' | 'selectAnimal' | 'scanStraw' | 'notBuiltYet';

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

  // The farmer's animals ride along on their detail record, so step 3 costs no extra call.
  // Skipped entirely until there is a farmer to fetch.
  const memberDetail = useGetMemberQuery(farmer?.kind === 'member' ? farmer.memberCode : '', {
    skip: farmer?.kind !== 'member',
  });
  const nonMemberDetail = useGetNonMemberQuery(
    farmer?.kind === 'nonMember' ? farmer.nonMemberId : 0,
    { skip: farmer?.kind !== 'nonMember' },
  );

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
          // The next capture is a different event, so it needs a different identity — reusing
          // this one would make the server replay the event that just finished.
          setClientUuid(newClientUuid());
          setScreen('notBuiltYet');
        }}
        onBack={() => setScreen('selectAnimal')}
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
});
