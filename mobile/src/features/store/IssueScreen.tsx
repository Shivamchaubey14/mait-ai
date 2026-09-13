/**
 * Issue — hand one indent over the counter.
 *
 * The keeper arrives from the queue with a Mait standing in front of them. Everything on the
 * screen is about the one number they are about to commit to: how many of this leave the
 * store now. It opens at the most the store can hand over — what is owed, or what the shelf can
 * still promise if that is less — because that is the right answer nearly every time, and a
 * keeper should only have to touch the stepper to hand over *less*.
 *
 * **Short is not a refusal.** A store holding 18 against an approval of 25 hands over the 18,
 * and the card says in words that the other 7 stay open on the same indent: the Mait does not
 * raise it again, and the next batch into the store is issued against it. Saying so matters,
 * because the alternative a keeper would otherwise reach for is sending the Mait away with
 * nothing until all 25 are in.
 *
 * Straws wait for the flask. A flask that has warmed has already killed what is in it, and
 * the check is the keeper's to make before straws leave the building — so the button stays
 * inert, and says why, until the switch is on. The server refuses without it too.
 *
 * Nothing moves when the button is pressed but a promise. The stock is set aside and the next
 * screen gives the keeper a code to read out; the Mait's count, and the store's, change only
 * when the Mait types it in.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { newClientUuid } from '@api/client';
import { useGetStoreIndentQuery, useIssueFromStoreMutation } from '@api/endpoints';
import type { StoreHandover, StoreIndent } from '@api/types';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { Toast } from '@/components/toast';
import { FlowNotice } from '@/features/aiFlow/components';
import { shortDate } from '@/features/stock/IndentsScreen';
import { colors, radius, spacing, typography, yolk } from '@theme/tokens';

import { clock, itemLabel, StoreAction, StoreHero, storeStyles, Stepper, Toggle } from './parts';

/** The most that can go over the counter now: what is owed, capped by what can be promised. */
export function mostThatCanGo(indent: Pick<StoreIndent, 'qty_open' | 'in_store'>): number {
  return Math.max(0, Math.min(indent.qty_open, indent.in_store));
}

function approvedLine(indent: StoreIndent, t: TFunction): string {
  if (!indent.approved_at) {
    return t('store.approvedOnPortal');
  }
  const date = shortDate(indent.approved_at);
  if (!indent.approved_by_name) {
    return t('store.approvedPlain', { date });
  }
  return indent.approved_by_zone
    ? t('store.approvedByZone', {
        date,
        name: indent.approved_by_name,
        zone: indent.approved_by_zone,
      })
    : t('store.approvedBy', { date, name: indent.approved_by_name });
}

export default function IssueScreen({
  indentId,
  onBack,
  onIssued,
  onOpenHandover,
}: {
  indentId: number;
  onBack: () => void;
  onIssued: (handover: StoreHandover) => void;
  /** Reopen a batch already issued against this indent, to read its code out again. */
  onOpenHandover: (handoverId: number) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const query = useGetStoreIndentQuery(indentId);
  const [issue, issuing] = useIssueFromStoreMutation();
  const indent = query.data;

  /**
   * One key per visit to this screen, minted when it opens.
   *
   * A tap that is repeated because the first one seemed to do nothing — on a store's one bar
   * of signal, that is most taps — must hand over once. The server answers the second request
   * with the first handover, code and all, and the keeper never learns there were two.
   */
  const clientUuid = useMemo(newClientUuid, []);

  const most = indent ? mostThatCanGo(indent) : 0;
  const [qty, setQty] = useState(0);
  const [flask, setFlask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Opened at the most that can go, once the indent has loaded — and pulled back into range if
  // a refresh finds the shelf has less than it had.
  useEffect(() => {
    setQty(current => (current === 0 || current > most ? most : current));
  }, [most]);

  const heroTop = (
    <StoreHero
      eyebrow={t('store.issueEyebrow')}
      onBack={onBack}
      title={indent ? t('store.issueTitle', { id: indent.id, mait: indent.mait_name }) : '—'}
      subtitle={indent ? approvedLine(indent, t) : undefined}
      testID="issue-hero"
    />
  );

  if (!indent) {
    return (
      <View style={storeStyles.root}>
        {heroTop}
        <ScrollView contentContainerStyle={storeStyles.body}>
          {query.isError ? (
            <Problem
              kind={online ? 'server' : 'offline'}
              onRetry={() => query.refetch()}
              busy={query.isFetching}
              testID="issue-error"
            />
          ) : (
            <SkeletonList rows={3} />
          )}
        </ScrollView>
      </View>
    );
  }

  const item = itemLabel(indent, i18n.language);
  const isStraw = indent.product_type === 'straw';
  const nothing = most === 0;
  const short = !nothing && indent.in_store < indent.qty_open;
  const rest = indent.qty_open - qty;
  const partBefore = indent.qty_issued > 0;

  const submit = async () => {
    setProblem(null);
    try {
      const handover = await issue({
        id: indent.id,
        qty,
        flaskChecked: flask,
        clientUuid,
      }).unwrap();
      onIssued(handover);
    } catch (err) {
      // The server knows why — the shelf changed under the keeper, the flask, the indent is no
      // longer theirs — and says it in a sentence. A generic line here would leave the keeper
      // pressing a button that will never work.
      const detail = (err as { data?: { detail?: string } })?.data?.detail;
      setProblem(detail || t('store.issueFailed'));
      query.refetch();
    }
  };

  const ctaLabel = nothing
    ? t('store.ctaNothing')
    : isStraw && !flask
      ? t('store.ctaFlask')
      : t('store.cta', { qty, item });

  return (
    <View style={storeStyles.root}>
      <Toast message={problem} onDismiss={() => setProblem(null)} testID="issue-problem" />
      {heroTop}

      <ScrollView
        contentContainerStyle={storeStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={query.refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Anything already handed over against this indent and still waiting on the Mait's
            code. A Mait who lost it is standing here asking; this is where the keeper looks. */}
        {(indent.waiting_handovers ?? []).map(waiting => (
          <Pressable
            key={waiting.id}
            accessibilityRole="button"
            onPress={() => onOpenHandover(waiting.id)}
            style={({ pressed }) => [styles.earlier, pressed && styles.earlierPressed]}
            testID={`issue-waiting-${waiting.id}`}
          >
            <View style={styles.itemText}>
              <Text style={styles.earlierTitle}>
                {t('store.earlierTitle', {
                  qty: waiting.qty,
                  item,
                  time: clock(waiting.issued_at),
                })}
              </Text>
              <Text style={storeStyles.cardMeta}>
                {waiting.locked
                  ? t('store.earlierLocked')
                  : t('store.earlierBody', { mait: indent.mait_name })}
              </Text>
            </View>
            {!waiting.locked && (
              <View style={styles.earlierCode}>
                <Text style={styles.earlierCodeLabel}>{waiting.collection_code}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}

        {nothing ? (
          <FlowNotice
            tone="error"
            title={t('store.noneTitle')}
            body={t('store.noneBody')}
            testID="issue-none"
          />
        ) : (
          // Yolk when the shelf is short, white when it covers the lot. The card is the one
          // decision on the screen, so it is the one thing that changes colour.
          <View style={[styles.itemCard, short && styles.itemCardShort]} testID="issue-item">
            <View style={styles.itemTop}>
              <View style={styles.itemText}>
                <Text style={storeStyles.cardTitle}>{item}</Text>
                <Text style={storeStyles.cardMeta}>
                  {partBefore
                    ? t('store.itemMetaPart', {
                        open: indent.qty_open,
                        approved: indent.qty_requested,
                        inStore: indent.in_store,
                      })
                    : t('store.itemMeta', {
                        approved: indent.qty_requested,
                        inStore: indent.in_store,
                      })}
                </Text>
              </View>
              <Stepper value={qty} min={1} max={most} onChange={setQty} testID="issue-qty" />
            </View>

            {rest > 0 && (
              <Text style={styles.itemNote} testID="issue-rest">
                {short && qty === most
                  ? t('store.restOpen', { inStore: indent.in_store, rest, id: indent.id })
                  : t('store.restOpenChosen', { rest, id: indent.id })}
              </Text>
            )}
          </View>
        )}

        {isStraw && !nothing && (
          <View style={[storeStyles.card, styles.flask]} testID="issue-flask">
            <View style={styles.itemText}>
              <Text style={styles.flaskTitle}>{t('store.flaskTitle')}</Text>
              <Text style={storeStyles.cardMeta}>{t('store.flaskBody')}</Text>
            </View>
            <Toggle
              value={flask}
              onChange={setFlask}
              label={t('store.flaskTitle')}
              testID="issue-flask-switch"
            />
          </View>
        )}

        {!nothing && (
          <View style={styles.after} testID="issue-after">
            <Text style={styles.afterTitle}>{t('store.afterTitle')}</Text>
            <View style={styles.afterRow}>
              <View style={styles.afterCell}>
                <Text style={styles.afterLabel}>{t('store.storeHolding')}</Text>
                <Text style={styles.afterValue} testID="issue-after-holding">
                  {`${indent.in_store} → ${indent.in_store - qty}`}
                </Text>
              </View>
              <View style={styles.afterCell}>
                <Text style={styles.afterLabel}>{t('store.openOn', { id: indent.id })}</Text>
                <Text style={styles.afterValue} testID="issue-after-open">
                  {rest}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={storeStyles.footer}>
        <StoreAction
          label={ctaLabel}
          icon={nothing || (isStraw && !flask) ? undefined : 'arrow-forward'}
          onPress={submit}
          disabled={nothing || qty < 1 || (isStraw && !flask)}
          busy={issuing.isLoading}
          testID="issue-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  earlier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  earlierPressed: { opacity: 0.8 },
  earlierTitle: { ...typography.bodyStrong, color: colors.ink },
  earlierCode: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.info,
  },
  earlierCodeLabel: { ...typography.h2, letterSpacing: 3, color: colors.ink },

  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  itemCardShort: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  itemText: { flex: 1 },
  itemNote: {
    ...typography.caption,
    color: yolk[900],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: 'rgba(37,61,78,0.08)',
  },

  flask: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flaskTitle: { ...typography.bodyStrong, color: colors.ink },

  // Grey, not white: this is a consequence to read, not a thing to change.
  after: {
    backgroundColor: colors.ink + '0D',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
  },
  afterTitle: { ...typography.bodyStrong, color: colors.ink, marginBottom: spacing[2] },
  afterRow: { flexDirection: 'row', gap: spacing[4] },
  afterCell: { flex: 1 },
  afterLabel: { ...typography.caption, color: colors.textMuted },
  afterValue: { ...typography.h2, color: colors.ink, marginTop: 2 },
});
