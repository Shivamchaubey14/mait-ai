/**
 * Issued — the code, and the wait for the Mait to type it.
 *
 * The handover is not finished when the keeper presses the button; it is finished when the
 * Mait types the four digits into *Confirm collection* on their own phone. So this screen is
 * built around the code — large, spaced, readable across a counter — and around the one fact
 * that is still open: whether they have typed it yet. It asks the server every few seconds
 * while they have not, and turns green when they have, so the keeper knows the moment the
 * straws are off their count.
 *
 * If the Mait walks off without confirming, nothing is lost and nothing is double-counted:
 * the handover stays open, the stock stays on the store's count and set aside, and the keeper
 * can find it again under *Not collected*. If they really have gone for good, *put it back*
 * releases the stock and reopens the quantity on the indent.
 *
 * Too many wrong codes lock the handover. A fresh code is the keeper's to read out, and only
 * the keeper can ask for one — which is what keeps the code worth anything: getting past the
 * lock means being at the counter.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  useCancelStoreHandoverMutation,
  useGetStoreHandoverQuery,
  useNewHandoverCodeMutation,
} from '@api/endpoints';
import type { StoreHandover } from '@api/types';
import { SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { FlowNotice } from '@/features/aiFlow/components';
import { colors, radius, spacing, typography } from '@theme/tokens';

import { clock, itemLabel, StoreAction, StoreHero, storeStyles } from './parts';

/** How often to ask whether the Mait has typed the code, while they have not. */
export const COLLECTION_POLL_MS = 5_000;

export default function IssuedScreen({
  handoverId,
  initial,
  storeName,
  onNext,
}: {
  handoverId: number;
  /**
   * What the issue call came back with, so the code is on screen before any refetch.
   *
   * Absent when the keeper reopens a handover to read its code out again — from the top of
   * the queue, or from the indent — and then the screen reads it from the server.
   */
  initial?: StoreHandover;
  storeName: string;
  onNext: () => void;
}): React.JSX.Element {
  const [waiting, setWaiting] = useState((initial?.state ?? 'waiting') === 'waiting');
  const query = useGetStoreHandoverQuery(handoverId, {
    // Only while it is still open. A collected or cancelled handover never changes again, and
    // a poll left running behind it is a request every five seconds for nothing.
    pollingInterval: waiting ? COLLECTION_POLL_MS : 0,
  });
  const handover = query.data ?? initial;
  useEffect(() => {
    if (query.data && query.data.state !== 'waiting') {
      setWaiting(false);
    }
  }, [query.data]);

  if (!handover) {
    return (
      <View style={storeStyles.root}>
        <View style={storeStyles.body}>
          <SkeletonList rows={3} />
        </View>
      </View>
    );
  }
  return <Issued handover={handover} storeName={storeName} onNext={onNext} />;
}

function Issued({
  handover,
  storeName,
  onNext,
}: {
  handover: StoreHandover;
  storeName: string;
  onNext: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();

  const [cancel, cancelling] = useCancelStoreHandoverMutation();
  const [newCode, renewing] = useNewHandoverCodeMutation();
  const [notice, setNotice] = useState<string | null>(null);

  const item = itemLabel(handover, i18n.language);
  const digits = handover.collection_code.split('').join(' ');

  const putBack = () => {
    Alert.alert(
      t('store.putBackTitle'),
      t('store.putBackBody', {
        qty: handover.qty,
        mait: handover.mait_name,
        id: handover.indent_id,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('store.putBackConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await cancel(handover.id).unwrap();
              setNotice(t('store.putBackDone', { qty: handover.qty, id: handover.indent_id }));
            } catch (err) {
              const detail = (err as { data?: { detail?: string } })?.data?.detail;
              setNotice(detail || t('errors.generic'));
            }
          },
        },
      ],
    );
  };

  /**
   * The slip, through whatever the handset can send it to.
   *
   * There is no print module in this build, and the depots that print use a Bluetooth thermal
   * printer through its own app — which takes shared text. The code is left off on purpose: a
   * slip is kept, passed around and photographed, and the code is only worth anything as
   * something read aloud to the one person standing at the counter.
   */
  const printSlip = () => {
    Share.share({
      message: t('store.slip', {
        store: storeName,
        id: handover.indent_id,
        mait: handover.mait_name,
        qty: handover.qty,
        item,
        time: clock(handover.issued_at),
      }),
    }).catch(() => undefined);
  };

  const renew = async () => {
    try {
      await newCode(handover.id).unwrap();
    } catch (err) {
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      setNotice(detail || t('errors.generic'));
    }
  };

  const collected = handover.state === 'collected';
  const cancelled = handover.state === 'cancelled';

  return (
    <View style={storeStyles.root}>
      <Toast
        message={notice}
        tone="info"
        onDismiss={() => setNotice(null)}
        testID="issued-notice"
      />
      <StoreHero
        done
        title={t('store.issuedTitle', { qty: handover.qty, item })}
        subtitle={t('store.issuedSubtitle', {
          id: handover.indent_id,
          mait: handover.mait_name,
          time: clock(handover.issued_at),
        })}
        testID="issued-hero"
      />

      <ScrollView contentContainerStyle={storeStyles.body}>
        {cancelled ? (
          <FlowNotice
            tone="info"
            title={t('store.cancelledTitle')}
            body={t('store.cancelledBody')}
            testID="issued-cancelled"
          />
        ) : (
          <View style={[styles.codeCard, collected && styles.codeCardSpent]} testID="issued-code">
            <Text style={styles.codeLabel}>{t('store.readThis')}</Text>
            <Text
              style={[styles.code, collected && styles.codeSpent]}
              accessibilityLabel={handover.collection_code}
              testID="issued-code-digits"
            >
              {digits}
            </Text>
            <Text style={styles.codeBody}>{t('store.readThisBody')}</Text>
          </View>
        )}

        {collected && (
          <FlowNotice
            tone="good"
            title={t('store.collectedTitle', { time: clock(handover.collected_at) })}
            body={t('store.collectedBody', { mait: handover.mait_name })}
            testID="issued-collected"
          />
        )}

        {handover.state === 'waiting' &&
          (handover.locked ? (
            <View>
              <FlowNotice
                tone="error"
                title={t('store.lockedTitle')}
                body={t('store.lockedBody')}
                testID="issued-locked"
              />
              <StoreAction
                label={t('store.newCode')}
                icon="refresh"
                tone="outline"
                onPress={renew}
                busy={renewing.isLoading}
                testID="issued-new-code"
              />
            </View>
          ) : (
            <FlowNotice
              tone="info"
              body={t('store.waitingConfirm')}
              icon="sync"
              testID="issued-waiting"
            />
          ))}

        {handover.qty_open > 0 && !cancelled && (
          <FlowNotice
            tone="accent"
            title={t('store.stillOpenTitle', { qty: handover.qty_open, item })}
            body={t('store.stillOpenBody')}
            pill={t('store.partIssued')}
            icon="time-outline"
            testID="issued-still-open"
          />
        )}

        {handover.state === 'waiting' && (
          <Pressable
            accessibilityRole="button"
            onPress={putBack}
            disabled={cancelling.isLoading}
            style={styles.link}
            testID="issued-put-back"
          >
            <Text style={styles.linkLabel}>{t('store.putBack')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[storeStyles.footer, styles.footerRow]}>
        <View style={styles.footerMain}>
          <StoreAction label={t('store.nextIndent')} onPress={onNext} testID="issued-next" />
        </View>
        <StoreAction
          label={t('store.printSlip')}
          tone="outline"
          onPress={printSlip}
          testID="issued-print"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  // Once typed the code is spent, and drawing it at full weight invites reading it out again.
  codeCardSpent: { backgroundColor: colors.background },
  codeLabel: { ...typography.label, color: colors.textMuted },
  code: {
    ...typography.display,
    fontSize: 44,
    lineHeight: 56,
    letterSpacing: 6,
    color: colors.ink,
    marginVertical: spacing[2],
  },
  codeSpent: { color: colors.textDisabled, textDecorationLine: 'line-through' },
  codeBody: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  link: { alignSelf: 'center', paddingVertical: spacing[3], paddingHorizontal: spacing[4] },
  linkLabel: { ...typography.label, color: colors.error },

  footerRow: { flexDirection: 'row', gap: spacing[3] },
  footerMain: { flex: 1 },
});
