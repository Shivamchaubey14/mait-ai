/**
 * Non-members, for an admin — the portal's Non-members screen (`non-members.html`) and the
 * record behind each row (`non-member.html`) on a handset (W10b, W10c).
 *
 * The sibling of Members, and deliberately not the same screen. Members arrive from SAP already
 * checked; these were typed by a Mait standing in a yard, on the one path in the product that
 * ends with cash changing hands. So this is a review queue: browsed newest first, and every card
 * carries what a row is judged on without opening it — her card and her consent above all.
 *
 * - **The list** counts the rows nobody can check (card missing, no consent) in tiles that only
 *   wear the alarm colours when there is something to chase, and tints each card the same way:
 *   red with no consent, yellow with a face of the card missing.
 * - **The record** shows both faces of the Aadhaar card — the only identity document this app
 *   renders as a picture — beside the masked number they are checked against. Opening a record
 *   with a card on file is logged against the operator's account, and the screen says so.
 * - **Payments** carry their evidence: the UTR and the screenshot for an online payment, and a
 *   plain "code only" for cash, where there was never anything else to keep.
 * - **Export Excel** takes the filtered roster away as a workbook (full numbers, audit-logged).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import AppText from '@/components/AppText';
import { EmptyState } from '@/components';
import { SkeletonRecord, SkeletonRows } from '@/components/skeleton';
import { initials } from '@/components/frame';
import { downloadAndShare } from '@api/files';
import { useAdminGetNonMemberQuery, useAdminListNonMembersQuery } from '@api/endpoints';
import type { AdminNonMember, AdminNonMemberDetail, NonMemberPayment } from '@api/types';
import { mediaUrl } from '@/config/env';
import { store } from '@/store';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography, yolk } from '@theme/tokens';

import { MppSheet } from './AdminEventsScreen';
import { Disc, FilterChip, Notice, Pill, TONE, type ToneName } from './AdminMaitsScreen';
import { spaced } from './AdminMembersScreen';
import { useDebounced } from './common';

const LIMIT = 25;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function num(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}

function money(amount: string | number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function dateOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const months = t('calendar.months', { returnObjects: true }) as string[];
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) {
    return `${Number(bare[3])} ${months[Number(bare[2]) - 1] ?? ''} ${bare[1]}`;
  }
  const d = new Date(iso);
  return `${d.getDate()} ${months[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

function dateTimeOf(t: TFunction, iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dateOf(t, iso)}, ${hh}:${mm}`;
}

/**
 * Whose name that is, spelled out. "Sunita w/o Ram" and "Sunita d/o Ram" are two different
 * women in a village where the names repeat; rows registered before the app asked say so.
 */
function household(t: TFunction, row: AdminNonMember): string {
  if (!row.father_husband_name) {
    return '';
  }
  const relation = row.relation_display || t('admin.nonMembers.fatherHusband');
  return `${relation}: ${row.father_husband_name}`;
}

type CardState = 'onFile' | 'frontOnly' | 'backOnly' | 'missing';

/** The card, named by its gap: a registration to redo is not a photograph to chase. */
function cardStateOf(row: AdminNonMember): CardState {
  if (row.aadhar_front_captured && row.aadhar_back_captured) {
    return 'onFile';
  }
  if (row.aadhar_front_captured) {
    return 'frontOnly';
  }
  if (row.aadhar_back_captured) {
    return 'backOnly';
  }
  return 'missing';
}

const CARD_TONE: Record<CardState, ToneName> = {
  onFile: 'green',
  frontOnly: 'yolk',
  backOnly: 'yolk',
  missing: 'red',
};

/** The row's own colour: red when she never agreed to be on file, yellow when a face is missing. */
function rowTone(row: AdminNonMember): ToneName {
  if (!row.consent_captured_at) {
    return 'red';
  }
  return cardStateOf(row) === 'onFile' ? 'green' : 'yolk';
}

function BackTo({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      testID="admin-nonmember-back"
    >
      <Ionicons name="arrow-back" size={16} color={colors.surface} />
      <AppText style={styles.backLabel}>{label}</AppText>
    </Pressable>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
  pill,
  pillTone,
  foot,
  testID,
}: {
  tone: ToneName;
  icon: string;
  label: string;
  value?: string;
  pill?: string;
  pillTone?: ToneName;
  foot: string;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.tile, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={13} color={look.onSolid} />
        </View>
        <AppText style={[styles.tileLabel, { color: look.text }]}>{label}</AppText>
      </View>
      {pill ? (
        <View style={styles.tilePill}>
          <Pill label={pill} tone={pillTone ?? tone} />
        </View>
      ) : (
        <AppText style={styles.tileValue} testID={testID ? `${testID}-value` : undefined}>
          {value}
        </AppText>
      )}
      <AppText style={styles.tileFoot}>{foot}</AppText>
    </View>
  );
}

function Panel({
  tone,
  icon,
  title,
  aside,
  children,
  testID,
}: {
  tone: ToneName;
  icon: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const look = TONE[tone];
  return (
    <View
      style={[styles.panel, { backgroundColor: look.wash, borderColor: look.border }]}
      testID={testID}
    >
      <View style={styles.panelHead}>
        <View style={[styles.chip, { backgroundColor: look.solid }]}>
          <Ionicons name={icon as never} size={14} color={look.onSolid} />
        </View>
        <AppText style={[styles.panelTitle, { color: look.text }]}>{title}</AppText>
        {aside}
      </View>
      {children}
    </View>
  );
}

function Fact({
  label,
  value,
  sub,
  absent,
  last,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string | null;
  absent?: boolean;
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.fact, !last && styles.rule]}>
      <AppText style={styles.factLabel}>{label}</AppText>
      <View style={styles.factBody}>
        {typeof value === 'string' ? (
          <AppText style={[styles.factValue, absent && styles.muted]}>{value}</AppText>
        ) : (
          value
        )}
        {!!sub && <AppText style={styles.factSub}>{sub}</AppText>}
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// The photograph viewer
// --------------------------------------------------------------------------------------

interface Shot {
  key: string;
  uri: string;
  caption: string;
}

/**
 * Over the record, not on a blank page: checking a number off a card means the card and the
 * digits together. Holds the whole set — both faces, or every payment screenshot — so the card
 * can be turned over without closing it. Pinch zooms where the platform offers it.
 */
function Viewer({
  shots,
  start,
  onClose,
}: {
  shots: Shot[];
  start: number;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [index, setIndex] = useState(start);
  const shot = shots[index];
  const many = shots.length > 1;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.viewer} testID="admin-nonmember-viewer">
        <View style={styles.viewerTop}>
          <AppText style={styles.viewerCaption} testID="admin-nonmember-viewer-caption">
            {shot?.caption ?? ''}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={10}
            style={styles.viewerClose}
            testID="admin-nonmember-viewer-close"
          >
            <Ionicons name="close" size={22} color={colors.surface} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.viewerStage}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
        >
          {!!shot && (
            <Image source={{ uri: shot.uri }} style={styles.viewerPhoto} resizeMode="contain" />
          )}
        </ScrollView>
        {many && (
          <View style={styles.viewerFoot}>
            <Pressable
              accessibilityRole="button"
              disabled={index === 0}
              onPress={() => setIndex(i => Math.max(0, i - 1))}
              style={[styles.viewerStep, index === 0 && styles.off]}
              testID="admin-nonmember-viewer-prev"
            >
              <Ionicons name="chevron-back" size={18} color={colors.ink} />
            </Pressable>
            <AppText style={styles.viewerCount}>
              {t('admin.nonMembers.viewerOf', { n: index + 1, total: shots.length })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={index === shots.length - 1}
              onPress={() => setIndex(i => Math.min(shots.length - 1, i + 1))}
              style={[styles.viewerStep, index === shots.length - 1 && styles.off]}
              testID="admin-nonmember-viewer-next"
            >
              <Ionicons name="chevron-forward" size={18} color={colors.ink} />
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

// --------------------------------------------------------------------------------------
// The record
// --------------------------------------------------------------------------------------

function CardFace({
  label,
  empty,
  uri,
  onOpen,
  testID,
}: {
  label: string;
  empty: string;
  uri?: string;
  onOpen: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <View style={styles.face}>
      {uri ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onOpen}
          style={({ pressed }) => [styles.faceFrame, pressed && styles.pressed]}
          testID={testID}
        >
          <Image source={{ uri }} style={styles.faceImage} resizeMode="cover" />
          <View style={styles.zoom}>
            <Ionicons name="expand" size={12} color={colors.surface} />
          </View>
        </Pressable>
      ) : (
        <View style={[styles.faceFrame, styles.faceEmpty]} testID={`${testID}-empty`}>
          <Ionicons name="camera-outline" size={22} color={colors.error} />
          <AppText style={styles.faceEmptyText}>{empty}</AppText>
        </View>
      )}
      <AppText style={styles.faceCaption}>{label}</AppText>
    </View>
  );
}

function PaymentCard({
  payment,
  onProof,
}: {
  payment: NonMemberPayment;
  onProof: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const online = payment.mode === 'ONLINE';
  const tone: ToneName = payment.is_verified ? 'green' : 'yolk';

  return (
    <View style={styles.payment} testID={`admin-nonmember-payment-${payment.ai_event}`}>
      <View style={styles.paymentTop}>
        <View style={styles.flex}>
          <AppText style={styles.paymentAmount}>{money(payment.amount)}</AppText>
          <AppText style={styles.sub}>
            {`${dateTimeOf(t, payment.created_at)} · ${t('admin.nonMembers.aiEvent', {
              id: payment.ai_event,
            })}`}
          </AppText>
        </View>
        <Pill
          label={
            payment.status_display ||
            t(payment.is_verified ? 'admin.nonMembers.verified' : 'admin.nonMembers.pending')
          }
          tone={tone}
        />
      </View>
      <View style={styles.paymentFacts}>
        <View style={styles.paymentFact}>
          <AppText style={styles.paymentFactLabel}>{t('admin.nonMembers.how')}</AppText>
          <View style={styles.modeRow}>
            <Ionicons
              name={online ? 'phone-portrait-outline' : 'cash-outline'}
              size={13}
              color={online ? colors.info : colors.primaryDark}
            />
            <AppText style={styles.factValue}>{payment.mode_display || payment.mode}</AppText>
          </View>
        </View>
        <View style={styles.paymentFact}>
          <AppText style={styles.paymentFactLabel}>{t('admin.nonMembers.reference')}</AppText>
          {online ? (
            payment.utr_number ? (
              <AppText style={styles.code} testID={`admin-nonmember-utr-${payment.ai_event}`}>
                {payment.utr_number}
              </AppText>
            ) : (
              <Pill label={t('admin.nonMembers.notOnFile')} tone="red" />
            )
          ) : (
            <AppText style={styles.sub}>{t('admin.nonMembers.cashCodeOnly')}</AppText>
          )}
        </View>
        <View style={styles.paymentFact}>
          <AppText style={styles.paymentFactLabel}>{t('admin.nonMembers.proof')}</AppText>
          {!online ? (
            <AppText style={styles.sub}>{t('admin.nonMembers.nothingToShow')}</AppText>
          ) : payment.payment_screenshot_url ? (
            <Pressable
              accessibilityRole="button"
              onPress={onProof}
              style={({ pressed }) => [styles.proof, pressed && styles.pressed]}
              testID={`admin-nonmember-proof-${payment.ai_event}`}
            >
              <Ionicons name="image-outline" size={14} color={colors.info} />
              <AppText style={styles.proofLabel}>{t('admin.nonMembers.screenshot')}</AppText>
            </Pressable>
          ) : (
            <Pill label={t('admin.nonMembers.notOnFile')} tone="red" />
          )}
        </View>
      </View>
    </View>
  );
}

function RecordBody({ record }: { record: AdminNonMemberDetail }): React.JSX.Element {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<{ shots: Shot[]; start: number } | null>(null);
  const none = t('admin.nonMembers.notRecorded');

  const card = cardStateOf(record);
  const cardTone = CARD_TONE[card];
  const faces = (record.aadhar_front_captured ? 1 : 0) + (record.aadhar_back_captured ? 1 : 0);
  const consented = !!record.consent_captured_at;
  const cows = record.cattle_cows || 0;
  const buffaloes = record.cattle_buffaloes || 0;
  const herd = record.cattle_total || 0;
  const litres = Number(record.daily_yield_litres || 0);
  const asked = herd > 0 || litres > 0;
  const animals = record.animals ?? [];
  const payments = record.payments ?? [];
  const online = payments.filter(p => p.mode === 'ONLINE').length;
  const front = mediaUrl(record.aadhar_front_url);
  const back = mediaUrl(record.aadhar_back_url);

  // Built when opened, so a viewer opened from the front still offers the back.
  const cardShots: Shot[] = [
    { key: 'front', uri: front, caption: t('admin.nonMembers.frontOfCard') },
    { key: 'back', uri: back, caption: t('admin.nonMembers.backOfCard') },
  ].filter((s): s is Shot => !!s.uri);
  const proofShots: Shot[] = payments
    .filter(p => !!p.payment_screenshot_url)
    .map(p => ({
      key: String(p.ai_event),
      uri: mediaUrl(p.payment_screenshot_url) ?? '',
      caption: [
        money(p.amount),
        dateTimeOf(t, p.created_at),
        p.utr_number ? `UTR ${p.utr_number}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    }));

  const cardFoot =
    card === 'onFile'
      ? t('admin.nonMembers.bothFaces')
      : card === 'missing'
        ? t('admin.nonMembers.nothingToCheck')
        : t('admin.nonMembers.askMaitFor', {
            face: t(
              card === 'frontOnly' ? 'admin.nonMembers.theBack' : 'admin.nonMembers.theFront',
            ),
          });

  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Disc tone={cardTone} text={initials(record.name)} size={44} />
          <View style={styles.flex}>
            <AppText style={styles.heroTitle}>{record.name || '—'}</AppText>
            <AppText style={styles.heroMeta} testID="admin-nonmember-meta">
              {[
                t('admin.nonMembers.registeredOn', { when: dateTimeOf(t, record.created_at) }),
                record.registered_by
                  ? t('admin.nonMembers.byMait', { name: record.registered_by })
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              {record.mpp_name ? ` · ${record.mpp_name}` : ''}
            </AppText>
          </View>
        </View>
      </View>

      {/* The questions asked before anything else, two at a time. */}
      <View style={styles.tiles}>
        <Tile
          tone={cardTone}
          icon={card === 'onFile' ? 'checkmark' : card === 'missing' ? 'close' : 'alert'}
          label={t('admin.nonMembers.tileCard')}
          pill={t(`admin.nonMembers.card_${card}`)}
          foot={cardFoot}
          testID="admin-nonmember-tile-card"
        />
        <Tile
          tone={consented ? 'green' : 'yolk'}
          icon={consented ? 'checkmark' : 'alert'}
          label={t('admin.nonMembers.tileConsent')}
          pill={t(consented ? 'admin.nonMembers.given' : 'admin.nonMembers.notOnRecord')}
          foot={
            consented
              ? dateTimeOf(t, record.consent_captured_at)
              : t('admin.nonMembers.beforeConsent')
          }
          testID="admin-nonmember-tile-consent"
        />
      </View>
      <View style={styles.tiles}>
        <Tile
          tone="blue"
          icon="paw"
          label={t('admin.nonMembers.tileAnimals')}
          value={num(record.animal_count)}
          foot={t(
            record.animal_count ? 'admin.nonMembers.onHerRecord' : 'admin.nonMembers.noneYet',
          )}
          testID="admin-nonmember-tile-animals"
        />
        {/* What she reported keeping, beside what is on file: nine cattle against one
            registered animal is eight inseminations nobody has asked her about. */}
        <Tile
          tone={asked ? 'blue' : 'slate'}
          icon="layers-outline"
          label={t('admin.nonMembers.tileHerd')}
          value={asked ? num(herd) : undefined}
          pill={asked ? undefined : t('admin.nonMembers.notAsked')}
          pillTone="yolk"
          foot={
            asked
              ? t('admin.nonMembers.herdSplit', { cows: num(cows), buffaloes: num(buffaloes) })
              : t('admin.nonMembers.beforeQuestion')
          }
          testID="admin-nonmember-tile-herd"
        />
      </View>
      <Tile
        tone="blue"
        icon="medkit"
        label={t('admin.nonMembers.tileEvents')}
        value={num(record.ai_event_count)}
        foot={t('admin.nonMembers.recordedAgainst')}
        testID="admin-nonmember-tile-events"
      />

      {/* The card first: it is why the record can be trusted at all, and it wears the state of
          the evidence — green with both faces, red with none. */}
      <Panel
        tone={cardTone}
        icon={card === 'onFile' ? 'shield-checkmark' : card === 'missing' ? 'close' : 'alert'}
        title={t('admin.nonMembers.tileCard')}
        aside={<Pill label={t('admin.nonMembers.facesOf', { n: faces })} tone={cardTone} />}
        testID="admin-nonmember-card-panel"
      >
        <View style={styles.faces}>
          <CardFace
            label={t('admin.nonMembers.front')}
            empty={t('admin.nonMembers.frontMissing')}
            uri={front}
            onOpen={() => setViewing({ shots: cardShots, start: 0 })}
            testID="admin-nonmember-front"
          />
          <CardFace
            label={t('admin.nonMembers.back')}
            empty={t('admin.nonMembers.backMissing')}
            uri={back}
            onOpen={() =>
              setViewing({ shots: cardShots, start: Math.max(0, cardShots.length - 1) })
            }
            testID="admin-nonmember-back-face"
          />
        </View>
        <View style={styles.cardNote}>
          <Ionicons name="eye-outline" size={14} color={TONE[cardTone].text} />
          <AppText style={styles.cardNoteText}>
            {faces > 0 ? `${t('admin.nonMembers.openHint')} ` : ''}
            {t('admin.nonMembers.checkAgainst')}{' '}
            <AppText style={styles.masked} testID="admin-nonmember-masked">
              {record.masked_aadhar || '—'}
            </AppText>
            {`. ${t('admin.nonMembers.loggedNote')}`}
          </AppText>
        </View>
      </Panel>

      <Panel
        tone="green"
        icon="paw"
        title={t('admin.nonMembers.tileAnimals')}
        aside={
          animals.length ? (
            <Pill
              label={t('admin.nonMembers.animalCount', { count: animals.length })}
              tone="green"
            />
          ) : undefined
        }
      >
        {animals.length ? (
          animals.map(animal => (
            <View
              key={animal.id}
              style={styles.animal}
              testID={`admin-nonmember-animal-${animal.id}`}
            >
              <View style={styles.animalTop}>
                <AppText style={styles.animalName}>
                  {animal.animal_type_display || animal.animal_type}
                </AppText>
                <AppText style={styles.sub}>
                  {t('admin.nonMembers.animalId', { id: animal.id })}
                </AppText>
                <View style={styles.flex} />
                <View style={styles.aiBubble}>
                  <AppText style={styles.aiBubbleLabel}>
                    {`${t('admin.nonMembers.ai')} ${num(animal.ai_event_count)}`}
                  </AppText>
                </View>
              </View>
              <AppText style={styles.sub}>
                {[
                  animal.breed || none,
                  animal.ear_tag_no || t('admin.nonMembers.noTag'),
                  animal.last_ai_at
                    ? `${t('admin.nonMembers.lastServed')} ${dateOf(t, animal.last_ai_at)}`
                    : t('admin.nonMembers.neverServed'),
                ].join(' · ')}
              </AppText>
            </View>
          ))
        ) : (
          <AppText style={styles.hint}>{t('admin.nonMembers.noAnimals')}</AppText>
        )}
      </Panel>

      {/* What she paid, and what proves it — hidden until there is a payment, since a farmer
          not yet charged is an ordinary state, not a record with something missing. */}
      {payments.length > 0 && (
        <Panel
          tone="yolk"
          icon="card-outline"
          title={t('admin.nonMembers.payments')}
          aside={
            <Pill
              label={
                online
                  ? t('admin.nonMembers.paymentsOnline', { n: payments.length, online })
                  : num(payments.length)
              }
              tone="yolk"
            />
          }
          testID="admin-nonmember-payments"
        >
          {payments.map(payment => (
            <PaymentCard
              key={`${payment.ai_event}-${payment.created_at}`}
              payment={payment}
              onProof={() =>
                setViewing({
                  shots: proofShots,
                  start: Math.max(
                    0,
                    proofShots.findIndex(s => s.key === String(payment.ai_event)),
                  ),
                })
              }
            />
          ))}
        </Panel>
      )}

      {/* Who she is, as a column of facts: what an operator reads back down the phone. */}
      <Panel tone="blue" icon="id-card-outline" title={t('admin.nonMembers.herRecord')}>
        <View style={styles.inset}>
          <Fact
            label={t('admin.nonMembers.household')}
            value={household(t, record) || none}
            absent={!record.father_husband_name}
          />
          <Fact
            label={t('admin.nonMembers.mobile')}
            value={
              record.mobile_no ? (
                spaced(record.mobile_no)
              ) : (
                <Pill label={t('admin.nonMembers.noNumber')} tone="red" />
              )
            }
          />
          <Fact
            label={t('admin.nonMembers.address')}
            value={record.address || none}
            absent={!record.address}
          />
          <Fact
            label={t('admin.nonMembers.aadhaar')}
            value={<AppText style={styles.masked}>{record.masked_aadhar || '—'}</AppText>}
          />
          <Fact
            label={t('admin.nonMembers.mpp')}
            value={record.mpp_name || '—'}
            sub={record.mpp_code}
          />
          <Fact
            label={t('admin.nonMembers.registeredBy')}
            value={record.registered_by || '—'}
            sub={record.registered_by_code}
          />
          <Fact
            label={t('admin.nonMembers.milkADay')}
            value={litres > 0 ? t('admin.nonMembers.litres', { n: num(litres) }) : none}
            sub={litres > 0 ? t('admin.nonMembers.asReported') : null}
            absent={!(litres > 0)}
          />
          <Fact label={t('admin.nonMembers.registered')} value={dateTimeOf(t, record.created_at)} />
          <Fact
            label={t('admin.nonMembers.consentGiven')}
            value={
              consented ? (
                dateTimeOf(t, record.consent_captured_at)
              ) : (
                <Pill label={t('admin.nonMembers.notOnRecord')} tone="yolk" />
              )
            }
            last
          />
        </View>
      </Panel>

      {!!viewing && (
        <Viewer shots={viewing.shots} start={viewing.start} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

function Record({ id, onBack }: { id: number; onBack: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const detail = useAdminGetNonMemberQuery(id);
  const status = (detail.error as { status?: number } | undefined)?.status;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={detail.isFetching && !detail.isLoading}
          onRefresh={() => detail.refetch()}
        />
      }
      testID="admin-nonmember-record"
    >
      <BackTo label={t('admin.nonMembers.allNonMembers')} onPress={onBack} />
      {detail.isLoading ? (
        <SkeletonRecord />
      ) : !detail.data ? (
        <EmptyState
          message={t(status === 404 ? 'admin.nonMembers.gone' : 'admin.nonMembers.recordMissing')}
        />
      ) : (
        <RecordBody record={detail.data} />
      )}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------------------
// The list
// --------------------------------------------------------------------------------------

function NonMemberCard({
  row,
  onOpen,
}: {
  row: AdminNonMember;
  onOpen: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const tone = rowTone(row);
  const look = TONE[tone];
  const card = cardStateOf(row);
  const home = household(t, row);
  const herd = row.cattle_total || 0;
  const litres = Number(row.daily_yield_litres || 0);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: look.wash, borderColor: look.border },
        pressed && styles.pressed,
      ]}
      testID={`admin-nonmember-${row.id}`}
    >
      <View style={styles.cardTop}>
        <Disc tone={tone} text={initials(row.name)} />
        <View style={styles.flex}>
          <AppText style={styles.cardName}>{row.name || '—'}</AppText>
          <AppText style={[styles.sub, !home && styles.italic]}>
            {home || t('admin.nonMembers.householdMissing')}
          </AppText>
        </View>
        <View style={styles.pills}>
          <Pill label={t(`admin.nonMembers.card_${card}`)} tone={CARD_TONE[card]} />
          {!row.consent_captured_at && <Pill label={t('admin.nonMembers.noConsent')} tone="red" />}
        </View>
      </View>

      {/* White is paper, only inside a tinted card. */}
      <View style={styles.inset}>
        <View style={[styles.row, styles.rule]}>
          <Ionicons
            name="phone-portrait-outline"
            size={14}
            color={row.mobile_no ? colors.primaryDark : colors.error}
          />
          <AppText style={styles.rowLabel}>{t('admin.nonMembers.mobile')}</AppText>
          <AppText
            style={[styles.factValue, styles.flex, !row.mobile_no && styles.bad]}
            testID={`admin-nonmember-mobile-${row.id}`}
          >
            {row.mobile_no ? spaced(row.mobile_no) : t('admin.nonMembers.noNumber')}
          </AppText>
        </View>
        <View style={[styles.row, styles.rule]}>
          <Ionicons name="location-outline" size={14} color={colors.info} />
          <AppText style={styles.rowLabel}>{t('admin.nonMembers.mpp')}</AppText>
          <AppText style={[styles.factValue, styles.flex]} numberOfLines={2}>
            {row.mpp_name || '—'}
            {!!row.mpp_code && <AppText style={styles.sub}>{`  ${row.mpp_code}`}</AppText>}
          </AppText>
        </View>
        <View style={[styles.row, styles.rule]}>
          <Ionicons name="person-outline" size={14} color={yolk[800]} />
          <AppText style={styles.rowLabel}>{t('admin.nonMembers.by')}</AppText>
          <AppText style={[styles.factValue, styles.flex]} numberOfLines={2}>
            {row.registered_by || '—'}
            {!!row.registered_by_code && (
              <AppText style={styles.sub}>{`  ${row.registered_by_code}`}</AppText>
            )}
          </AppText>
        </View>
        <View style={[styles.row, styles.rule]}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <AppText style={styles.rowLabel}>{t('admin.nonMembers.registered')}</AppText>
          <AppText style={[styles.factValue, styles.flex]}>{dateTimeOf(t, row.created_at)}</AppText>
        </View>
        {/* The figures a scan down the list compares. Zero milk means "never asked", not a
            farmer with no milk, so it reads as a dash. */}
        <View style={styles.figures}>
          <View style={styles.figure}>
            <AppText style={styles.figureValue} testID={`admin-nonmember-herd-${row.id}`}>
              {herd ? num(herd) : '—'}
            </AppText>
            <AppText style={styles.figureLabel}>{t('admin.nonMembers.herd')}</AppText>
            {!!herd && (
              <AppText style={styles.figureSub}>
                {t('admin.nonMembers.herdShort', {
                  cows: num(row.cattle_cows),
                  buffaloes: num(row.cattle_buffaloes),
                })}
              </AppText>
            )}
          </View>
          <View style={styles.figure}>
            <AppText style={styles.figureValue}>{litres > 0 ? `${num(litres)} L` : '—'}</AppText>
            <AppText style={styles.figureLabel}>{t('admin.nonMembers.milkDay')}</AppText>
          </View>
          <View style={styles.figure}>
            <AppText style={styles.figureValue}>{num(row.animal_count)}</AppText>
            <AppText style={styles.figureLabel}>{t('admin.nonMembers.animals')}</AppText>
          </View>
          <View style={styles.figure}>
            <AppText style={styles.figureValue}>{num(row.ai_event_count)}</AppText>
            <AppText style={styles.figureLabel}>{t('admin.nonMembers.ai')}</AppText>
          </View>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <AppText style={[styles.openLabel, { color: look.text }]}>
          {t('admin.nonMembers.open')}
        </AppText>
        <Ionicons name="chevron-forward" size={15} color={look.text} />
      </View>
    </Pressable>
  );
}

export default function AdminNonMembersScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const [mpp, setMpp] = useState<{ code: string; name: string } | null>(null);
  const [noCard, setNoCard] = useState(false);
  const [offset, setOffset] = useState(0);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const filters = useMemo(() => ({ search, mpp: mpp?.code, noCard }), [search, mpp, noCard]);
  const list = useAdminListNonMembersQuery({ ...filters, offset });

  useEffect(() => {
    setOffset(0);
  }, [filters]);

  useEffect(() => {
    if (open === null) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  /**
   * The roster as a workbook — the same filters, without `limit` and `offset`, which are how
   * this list pages: passing them would hand back the 25 rows on screen as a file that looks
   * complete and is not. Dated, because these get mailed around and compared.
   */
  const exportWorkbook = async () => {
    const access = store.getState().auth.accessToken;
    if (!access || exporting) {
      return;
    }
    setProblem(null);
    setExporting(true);
    const params: Record<string, string> = {};
    if (filters.search) {
      params.search = filters.search;
    }
    if (filters.mpp) {
      params.mpp__mpp_code = filters.mpp;
    }
    if (filters.noCard) {
      params.no_card = 'true';
    }
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    try {
      await downloadAndShare(
        `/admin/non-members/export/${query ? `?${query}` : ''}`,
        `non-members-${new Date().toISOString().slice(0, 10)}.xlsx`,
        XLSX,
        access,
      );
    } catch {
      setProblem(t('admin.nonMembers.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  if (open !== null) {
    return (
      <View style={styles.root}>
        <Record id={open} onBack={() => setOpen(null)} />
      </View>
    );
  }

  const rows = list.data?.results ?? [];
  const count = list.data?.count ?? 0;
  // Counted from the page in hand, and labelled so — only `count` is a true total.
  const missingCard = rows.filter(r => !r.aadhar_front_captured || !r.aadhar_back_captured).length;
  const missingConsent = rows.filter(r => !r.consent_captured_at).length;
  const served = rows.reduce((sum, r) => sum + (r.ai_event_count || 0), 0);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isFetching && !list.isLoading}
            onRefresh={() => list.refetch()}
          />
        }
        testID="admin-nonmembers"
      >
        <View style={styles.top}>
          <AppText style={styles.count} testID="admin-nonmembers-count">
            {list.data ? t('admin.nonMembers.farmers', { count, n: num(count) }) : '—'}
          </AppText>
          {/* Ink, like the other exports: taking a copy away is not what this screen is for. */}
          <Pressable
            accessibilityRole="button"
            onPress={exportWorkbook}
            disabled={exporting}
            style={({ pressed }) => [styles.inkButton, pressed && styles.pressed]}
            testID="admin-nonmembers-export"
          >
            {exporting ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Ionicons name="download-outline" size={15} color={colors.surface} />
            )}
            <AppText style={styles.inkButtonLabel}>
              {t(exporting ? 'admin.nonMembers.preparing' : 'admin.nonMembers.export')}
            </AppText>
          </Pressable>
        </View>

        {!!problem && (
          <Notice
            tone="red"
            icon="alert"
            title={problem}
            body=""
            testID="admin-nonmembers-problem"
          />
        )}

        {/* Members arrive from SAP already checked; these did not — said here because it is
            why this screen exists at all. */}
        <Notice
          tone="yolk"
          icon="information"
          title={t('admin.nonMembers.noticeTitle')}
          body={t('admin.nonMembers.noticeBody')}
          testID="admin-nonmembers-notice"
        />

        <View style={styles.tiles}>
          <Tile
            tone="blue"
            icon="id-card-outline"
            label={t('admin.nonMembers.tileRegistered')}
            value={list.data ? num(count) : '—'}
            foot={t('admin.nonMembers.acrossEveryMpp')}
            testID="admin-nonmembers-tile-total"
          />
          {/* A clean page does not wear the alarm colours: yellow that is always on stops
              being read, and then it is not there on the day it means something. */}
          <Tile
            tone={missingCard ? 'red' : 'green'}
            icon={missingCard ? 'close' : 'checkmark'}
            label={t('admin.nonMembers.tileNoCard')}
            value={num(missingCard)}
            foot={t(missingCard ? 'admin.nonMembers.nothingToCheck' : 'admin.nonMembers.allCards')}
            testID="admin-nonmembers-tile-no-card"
          />
        </View>
        <View style={styles.tiles}>
          <Tile
            tone={missingConsent ? 'yolk' : 'green'}
            icon={missingConsent ? 'alert' : 'checkmark'}
            label={t('admin.nonMembers.tileNoConsent')}
            value={num(missingConsent)}
            foot={t(
              missingConsent ? 'admin.nonMembers.beforeConsent' : 'admin.nonMembers.allConsent',
            )}
            testID="admin-nonmembers-tile-no-consent"
          />
          <Tile
            tone="blue"
            icon="medkit"
            label={t('admin.nonMembers.tileEvents')}
            value={num(served)}
            foot={t('admin.nonMembers.servedOnPage')}
            testID="admin-nonmembers-tile-events"
          />
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.info} />
          <TextInput
            style={styles.searchInput}
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.nonMembers.searchPlaceholder')}
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            testID="admin-nonmembers-search"
          />
          {term.length > 0 && (
            <Pressable onPress={() => setTerm('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          <FilterChip
            label={mpp ? mpp.name : t('admin.nonMembers.mppAll')}
            icon="business-outline"
            tone="blue"
            active={!!mpp}
            onPress={() => setPicking(true)}
            testID="admin-nonmembers-filter-mpp"
          />
          <FilterChip
            label={t('admin.nonMembers.filterNoCard')}
            icon="card-outline"
            tone="red"
            active={noCard}
            onPress={() => setNoCard(on => !on)}
            testID="admin-nonmembers-filter-no-card"
          />
        </View>

        {list.isLoading ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState message={t('admin.nonMembers.error')} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={t(noCard ? 'admin.nonMembers.everyCard' : 'admin.nonMembers.noneMatch')}
          />
        ) : (
          rows.map(row => <NonMemberCard key={row.id} row={row} onOpen={() => setOpen(row.id)} />)
        )}

        {count > LIMIT && (
          <View style={styles.pager} testID="admin-nonmembers-pager">
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0 || list.isFetching}
              onPress={() => setOffset(o => Math.max(0, o - LIMIT))}
              style={[styles.pageStep, offset === 0 && styles.off]}
              testID="admin-nonmembers-prev"
            >
              <Ionicons name="chevron-back" size={16} color={colors.info} />
              <AppText style={styles.pageStepLabel}>{t('admin.nonMembers.prev')}</AppText>
            </Pressable>
            <AppText style={styles.pageOf}>
              {t('admin.nonMembers.pageOf', {
                from: num(offset + 1),
                to: num(Math.min(count, offset + rows.length)),
                total: num(count),
              })}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={offset + LIMIT >= count || list.isFetching}
              onPress={() => setOffset(o => o + LIMIT)}
              style={[styles.pageStep, offset + LIMIT >= count && styles.off]}
              testID="admin-nonmembers-next"
            >
              <AppText style={styles.pageStepLabel}>{t('admin.nonMembers.next')}</AppText>
              <Ionicons name="chevron-forward" size={16} color={colors.info} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      <MppSheet
        visible={picking}
        selected={mpp?.code ?? null}
        onSelect={setMpp}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[7] },
  pressed: { opacity: 0.85 },
  off: { opacity: 0.4 },
  muted: { color: colors.textMuted },
  italic: { fontStyle: 'italic' },
  bad: { color: colors.error },
  sub: { ...typography.caption, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },

  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[3] },
  count: { ...typography.h3, color: colors.ink, flex: 1, minWidth: 140 },
  inkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  inkButtonLabel: { ...typography.label, color: colors.surface },

  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.ink,
  },
  backLabel: { ...typography.label, color: colors.surface },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.info,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },

  tiles: { flexDirection: 'row', gap: spacing[2] },
  tile: { flex: 1, padding: spacing[3], gap: 4, borderRadius: radius.md, borderWidth: 1 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.caption, fontFamily: typography.label.fontFamily, flex: 1 },
  tileValue: { ...typography.h1, color: colors.ink },
  tilePill: { flexDirection: 'row', marginVertical: 4 },
  tileFoot: { ...typography.caption, color: colors.ink },

  card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  cardName: { ...typography.h3, color: colors.ink },
  pills: { alignItems: 'flex-end', gap: 4 },
  inset: {
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 8 },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowLabel: { ...typography.caption, color: colors.textMuted, width: 72 },
  figures: { flexDirection: 'row', paddingVertical: spacing[2] },
  figure: { flex: 1, alignItems: 'center' },
  figureValue: { ...typography.bodyStrong, color: colors.ink },
  figureLabel: { ...typography.caption, color: colors.textMuted },
  figureSub: { ...typography.caption, color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  openLabel: { ...typography.label },

  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  pageStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 38,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  pageStepLabel: { ...typography.label, color: colors.info },
  pageOf: { ...typography.caption, color: colors.textMuted, textAlign: 'center', flexShrink: 1 },

  hero: { padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.ink },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroTitle: { ...typography.h2, color: colors.surface },
  heroMeta: { ...typography.caption, color: yolk[300] },

  panel: { padding: spacing[3], gap: spacing[2], borderRadius: radius.lg, borderWidth: 1 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { ...typography.h3, flex: 1 },

  faces: { flexDirection: 'row', gap: spacing[2] },
  face: { flex: 1, gap: 4 },
  faceFrame: {
    aspectRatio: 1.58,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  faceImage: { width: '100%', height: '100%' },
  faceEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: spacing[2],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  faceEmptyText: { ...typography.caption, color: colors.error, textAlign: 'center' },
  faceCaption: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
    textAlign: 'center',
  },
  zoom: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    padding: 4,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cardNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  cardNoteText: { ...typography.caption, color: colors.ink, flex: 1 },
  masked: {
    ...typography.label,
    fontFamily: typography.h3.fontFamily,
    color: colors.ink,
    letterSpacing: 1,
  },

  animal: { gap: 3, padding: spacing[3], borderRadius: radius.md, backgroundColor: colors.surface },
  animalTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  animalName: { ...typography.bodyStrong, color: colors.ink },
  aiBubble: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.info,
  },
  aiBubbleLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  payment: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  paymentTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  paymentAmount: { ...typography.h3, color: colors.ink },
  paymentFacts: { flexDirection: 'row', gap: spacing[2] },
  paymentFact: { flex: 1, gap: 3, alignItems: 'flex-start' },
  paymentFactLabel: { ...typography.caption, color: colors.textMuted },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  code: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.ink,
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  proof: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 30,
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoWash,
  },
  proofLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.info,
  },

  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingVertical: 8 },
  factLabel: { ...typography.caption, color: colors.textMuted, width: 92 },
  factBody: { flex: 1, alignItems: 'flex-start' },
  factValue: { ...typography.label, color: colors.ink },
  factSub: { ...typography.caption, color: colors.textMuted },

  viewer: { flex: 1, backgroundColor: colors.ink },
  viewerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    paddingBottom: spacing[3],
  },
  viewerCaption: { ...typography.label, color: colors.surface, flex: 1 },
  viewerClose: { padding: 4 },
  viewerStage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  viewerPhoto: { width: '100%', height: '100%', minHeight: 320 },
  viewerFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  viewerStep: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: yolk[400],
  },
  viewerCount: { ...typography.label, color: colors.surface },
});
