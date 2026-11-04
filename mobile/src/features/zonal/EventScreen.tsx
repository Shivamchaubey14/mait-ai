/**
 * One insemination, whole — the screen a dispute is settled on.
 *
 * The portal's AI event detail (W6), for a manager standing in the village it happened in
 * rather than at a desk: the straw and the doses, what was charged and whether it cleared,
 * where the handset was, the proof photo, the animal and her owner, everything the visit took
 * off the Mait's bag, whether it took, and the step-by-step trail.
 *
 * **Two columns become one.** The portal puts evidence left and facts right; a handset has
 * one column, so the order is the order somebody asks the questions in — the four figures
 * that settle most arguments, then the photograph, then where it was taken, then who and
 * what, and the trail last because it is read only when the rest is disputed.
 *
 * **The colour is the portal's, card for card**, and that is not decoration. A manager and an
 * admin looking at the same event should be looking at the same card:
 *
 * - blue for a *fact about the situation* — where the handset was, what came out of the bag.
 *   Not an action to take, not something waiting, and certainly not something wrong;
 * - green once the money is verified and the event is closed, yolk while either is still
 *   waiting on somebody, red for the one thing that needs acting on;
 * - the wash carries the colour and the border states it, and the text stays Ink. That is the
 *   rule every wash token in this palette is written to, and it is what keeps a card legible
 *   on a cheap screen in sunlight.
 *
 * A screen of identical white cards is the state this was in first, and the fault with it was
 * not plainness: it was that every card claimed the same weight, so the half of the record a
 * month-end stock count goes missing on sat between two others reading as a footnote to them.
 *
 * **The trail is not editable, and the screen says so.** Every line was written by the server
 * at the moment it happened. A record that can be corrected afterwards is not evidence of
 * anything, and a manager about to repeat one of these lines to a farmer should know which
 * kind they are holding.
 *
 * Read-only throughout. A manager can approve an indent from this app; nothing here changes
 * an AI event, and there is deliberately no control that looks as though it might.
 */

import React, { useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import AppText from '@/components/AppText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useGetZonalEventQuery } from '@api/endpoints';
import type { ZonalEvent } from '@api/types';
import { mediaUrl } from '@/config/env';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import {
  colors,
  green,
  ink,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

import { Pill, Tile, Tiles, ZonalAction, ZonalHero, zonalStyles } from './parts';
import { useLive } from './live';
import type { TileTone } from './parts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The tone each state wears, and it is the portal's table verbatim.
 *
 * *Waiting* is yolk rather than red: an event at step 5 has not gone wrong, it has not
 * finished. Only a cancelled one is red, and only a failed payment needs anybody to act.
 */
const STATUS_TONE: Record<string, TileTone> = {
  completed: 'good',
  payment_pending: 'waiting',
  photo_captured: 'info',
  straw_verified: 'info',
  draft: 'plain',
  cancelled: 'bad',
};

/** Pregnancy outcomes are not symmetrical and neither are their colours. */
const OUTCOME_TONE: Record<string, 'good' | 'bad' | 'waiting'> = {
  pregnant: 'good',
  not_pregnant: 'bad',
  unsure: 'waiting',
};

function clock(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "18 Aug 2026, 10:43" — the whole stamp, because this record is read months later. */
function stamp(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock(iso)}`;
}

/**
 * "19 Dec 2026" out of the server's "2026-12-19". Read off the parts rather than through
 * `new Date`, which takes a bare date as UTC midnight and can show the day before.
 */
function day(iso: string | null): string {
  const [year, month, date] = (iso ?? '').split('-').map(Number);
  if (!year || !month || !date) {
    return iso || '—';
  }
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** A labelled fact. Muted where nothing was recorded, so a blank never reads as a load error. */
function Fact({
  label,
  value,
  testID,
}: {
  label: string;
  value?: string | null;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const said = value && String(value).trim();
  return (
    <View style={styles.fact} testID={testID}>
      <AppText style={styles.factLabel}>{label}</AppText>
      <AppText style={[styles.factValue, !said && styles.factMissing]}>
        {said || t('zonal.notRecorded')}
      </AppText>
    </View>
  );
}

/**
 * A card with a glyph on a chip beside its heading.
 *
 * `tone` tints the whole card and its chip together — a wash with a matching border, never an
 * edge stripe, which against a near-white page reads as a stray shadow rather than as "this
 * is the one to read". On a washed card the chip goes white; on the one white card left (the
 * photograph, which has to stay the brightest thing on the screen) the chip carries the tint.
 *
 * - `info`, blue — a fact about the situation: where it was, what came out of the bag;
 * - `warm`, yolk — the people: the farmer, the Mait, the animal and whose it is;
 * - `green` — whether it took, the outcome everybody is waiting to hear;
 * - `slate`, Ink — the trail, the server's own record, set apart in the hero's colour.
 */
type CardTone = 'plain' | 'info' | 'warm' | 'green' | 'slate';

const CARD_ICON: Record<CardTone, string> = {
  plain: colors.textMuted,
  info: colors.info,
  warm: yolk[800],
  green: colors.primaryDark,
  slate: colors.surface,
};
function Card({
  title,
  icon,
  tone = 'plain',
  children,
  testID,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone?: CardTone;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.card, styles[`card_${tone}`]]} testID={testID}>
      <View style={styles.cardHead}>
        <View style={[styles.chip, styles[`chip_${tone}`]]}>
          <Ionicons name={icon} size={15} color={CARD_ICON[tone]} />
        </View>
        <AppText style={[styles.cardTitle, styles[`cardTitle_${tone}`]]}>{title}</AppText>
      </View>
      {children}
    </View>
  );
}

/**
 * One labelled fact on the hero — the collection point, the Mait — with its glyph on a chip
 * of its own colour, so the two read apart at a glance on the Ink.
 */
function HeroFact({
  icon,
  tone,
  label,
  value,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: 'info' | 'warm';
  label: string;
  value: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.heroFact} testID={testID}>
      <View style={[styles.heroFactChip, tone === 'info' ? styles.chipBlue : styles.chipYolk]}>
        <Ionicons name={icon} size={14} color={tone === 'info' ? colors.surface : colors.ink} />
      </View>
      <View style={styles.heroFactBody}>
        <AppText style={styles.heroFactLabel}>{label}</AppText>
        <AppText style={styles.heroFactValue}>{value}</AppText>
      </View>
    </View>
  );
}

/**
 * Reached from the zone's feed and from the list of every event, and left by the handset's
 * own back or the tab bar — there is no back arrow in the hero. The corner it sat in is the
 * zone's, and the number this record goes by is the thing on the left.
 */
export default function EventScreen({
  eventId,
  zoneName,
}: {
  eventId: number;
  zoneName: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const online = useOnline();
  // Live like the rest: a record opened at step 5 moves to Completed on screen when the
  // payment clears, rather than when somebody thinks to pull.
  const query = useGetZonalEventQuery(eventId, useLive());

  const event: ZonalEvent | undefined = query.data;

  if (query.isLoading) {
    return (
      <View style={zonalStyles.root}>
        <ZonalHero
          tag={t('zonal.eventEyebrow', { id: eventId })}
          pill={zoneName}
          title={t('common.loading')}
          testID="zonal-event-hero"
        />
        <View style={zonalStyles.body}>
          <SkeletonList rows={5} />
        </View>
      </View>
    );
  }

  if (query.isError || !event) {
    return (
      <View style={zonalStyles.root}>
        <ZonalHero
          tag={t('zonal.eventEyebrow', { id: eventId })}
          pill={zoneName}
          title={t('zonal.eventGoneTitle')}
          testID="zonal-event-hero"
        />
        <View style={zonalStyles.body}>
          <Problem
            kind={online ? 'server' : 'offline'}
            onRetry={query.refetch}
            busy={query.isFetching}
            testID="zonal-event-error"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={zonalStyles.root}>
      <ZonalHero
        tag={t('zonal.eventEyebrow', { id: event.id })}
        pill={zoneName}
        title={event.owner_name}
        testID="zonal-event-hero"
      >
        <EventHeroFacts event={event} />
      </ZonalHero>

      <ScrollView
        contentContainerStyle={zonalStyles.body}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={query.refetch}
            tintColor={colors.primary}
          />
        }
      >
        <EventRecordCards event={event} />
      </ScrollView>
    </View>
  );
}

/**
 * Whose animal, in a word and a colour, then where and by whom — each with the code a manager
 * reads back over the phone. Drawn on the Ink, under the record's title.
 */
export function EventHeroFacts({
  event,
  testIDPrefix = 'zonal-event',
}: {
  event: ZonalEvent;
  testIDPrefix?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const member = event.owner_type === 'member';
  return (
    <View style={styles.heroFacts}>
      <View
        style={[styles.kind, member ? styles.kindMember : styles.kindNonMember]}
        testID={`${testIDPrefix}-owner-kind`}
      >
        <Ionicons
          name={member ? 'ribbon' : 'person'}
          size={13}
          color={member ? colors.surface : colors.ink}
        />
        <AppText style={[styles.kindLabel, !member && styles.kindLabelNonMember]}>
          {t(member ? 'zonal.member' : 'zonal.nonMember')}
        </AppText>
      </View>
      <HeroFact
        icon="business"
        tone="info"
        label={t('zonal.mppLabel')}
        value={`${event.mpp_name} · ${event.mpp_code}`}
        testID={`${testIDPrefix}-hero-mpp`}
      />
      <HeroFact
        icon="person"
        tone="warm"
        label={t('zonal.theMait')}
        value={[event.mait_name, event.mait_code].filter(Boolean).join(' · ')}
        testID={`${testIDPrefix}-hero-mait`}
      />
    </View>
  );
}

/**
 * Everything under the hero: the four figures, the photographs, where, who and what, what the
 * visit took, whether it took, and the trail. Shared by the manager's record and the admin's,
 * so the same event is the same cards wherever it is opened.
 *
 * Where the detail carries them (the admin's does), the farmer's own particulars and the
 * animal's registration portrait are laid out too — the portal's Farmer & animal card.
 */
export function EventRecordCards({
  event,
  testIDPrefix = 'zonal-event',
}: {
  event: ZonalEvent;
  testIDPrefix?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [viewing, setViewing] = useState<string | null>(null);

  const photo = event.ai_photo_url ? mediaUrl(event.ai_photo_url) : '';
  const owner = event.owner_detail ?? null;
  const animal = event.animal_detail ?? null;
  const animalPhoto = animal?.photo_url ? mediaUrl(animal.photo_url) : '';
  const hasFix = !!(event.gps_lat && event.gps_lng);
  const settled = event.status === 'completed' || event.status === 'cancelled';
  const id = (name: string) => `${testIDPrefix}-${name}`;
  // Lists the record is drawn from, read defensively: the admin's trail arrives on a read of
  // its own, and a record from before consumables were captured carries none.
  const consumables = event.consumables ?? [];
  const checks = event.pregnancy_checks ?? [];
  const timeline = Array.isArray(event.timeline) ? event.timeline : [];

  /**
   * Hand the coordinates to whatever maps app is on the handset.
   *
   * Not an embedded map: the portal frames one because it has a browser and a desk, and a
   * map library here would be megabytes of JavaScript for a pin. Out in a village the useful
   * thing is not a picture of where it happened — it is directions to it, which the phone's
   * own maps app already does better than this app ever will.
   */
  const openInMaps = () => {
    if (!event.gps_lat || !event.gps_lng) {
      return;
    }
    const at = `${event.gps_lat},${event.gps_lng}`;
    Linking.openURL(`geo:${at}?q=${at}`).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${at}`).catch(() => {
        // Neither a maps app nor a browser. The coordinates are on the card either way, which
        // is what a dispute is actually settled with.
      });
    });
  };

  const payment = event.payment;
  const paymentTone: TileTone = !payment
    ? 'plain'
    : payment.status === 'failed'
      ? 'bad'
      : payment.is_verified
        ? 'good'
        : 'waiting';
  const statusTone = STATUS_TONE[event.status] ?? 'plain';
  const member = event.owner_type === 'member';
  const deducted = event.status === 'completed' && event.stock_deducted;

  return (
    <>
      {/* The four figures most arguments are settled with, two at a time — four across a
            handset would be four columns of nothing legible. Each carries the line of
            context that turns a number into an answer. */}
      <Tiles>
        {/* Leading with the doses rather than the number, because that is what the flask is
              short of: an insemination on a difficult animal takes two straws, and a tile
              reading one number said nothing about the second. */}
        {/* A line each for the breed and the straw's number, and whether the flask was
              debited as a pill of its own. Run together as one two-line note, the last of
              them was always the one cut off — "Dedu…" — and it is the one a stock count
              turns on. */}
        <Tile label={t('zonal.strawTile')} tone="info" testID={id('straw')}>
          <AppText style={styles.strawValue} numberOfLines={1} adjustsFontSizeToFit>
            {t('zonal.doses', { count: event.doses || 1 })}
          </AppText>
          {!!(event.semen_breed || event.breed) && (
            <AppText style={styles.strawBreed}>{event.semen_breed || event.breed}</AppText>
          )}
          <AppText style={styles.strawNumber}>
            {event.straw_unique_no || t('zonal.noStrawNumber')}
          </AppText>
          <View style={styles.statusPill}>
            <Pill
              label={
                event.status === 'completed'
                  ? event.stock_deducted
                    ? t('zonal.deducted')
                    : t('zonal.closedWithoutDeduction')
                  : t('zonal.heldNotDeducted')
              }
              tone={deducted ? 'good' : 'waiting'}
            />
          </View>
        </Tile>
        <Tile
          label={t('zonal.paymentTile')}
          value={payment ? `₹ ${payment.amount}` : t('zonal.noPaymentYet')}
          note={
            payment
              ? `${payment.mode_display} · ${payment.status_display}`
              : t('zonal.paymentAtStepSix')
          }
          tone={paymentTone}
          testID={id('payment')}
        />
      </Tiles>
      <Tiles>
        {/* Blue when there is a fix, yolk when there is not — a record with no position is
              not wrong, it is missing the one thing that ties it to a village. */}
        {/* Latitude over longitude, a line each in heading type: both on one line in display
              type ran off the tile as "26.79…". The full precision is on the map card below. */}
        <Tile
          label={t('zonal.locationTile')}
          note={
            hasFix
              ? t(event.gps_source === 'photo' ? 'zonal.gpsFromPhoto' : 'zonal.gpsFromDevice')
              : t('zonal.noGpsShort')
          }
          tone={hasFix ? 'info' : 'waiting'}
          testID={id('location')}
        >
          {hasFix ? (
            <View style={styles.coordsTile}>
              <AppText style={styles.coordsTileValue} numberOfLines={1} adjustsFontSizeToFit>
                {Number(event.gps_lat).toFixed(4)}
              </AppText>
              <AppText style={styles.coordsTileValue} numberOfLines={1} adjustsFontSizeToFit>
                {Number(event.gps_lng).toFixed(4)}
              </AppText>
            </View>
          ) : (
            <AppText style={styles.coordsTileNone}>—</AppText>
          )}
        </Tile>
        {/* The status states a state, and the product already has a component for that
              word. Set in display type it would read as a figure — so the pill sits on a
              white chip over the tile's own wash, exactly as the portal draws it. */}
        <Tile
          label={t('zonal.statusTile')}
          note={
            event.completed_at
              ? t('zonal.completedAt', { when: stamp(event.completed_at) })
              : t('zonal.startedAt', { when: stamp(event.created_at) })
          }
          tone={statusTone}
          testID={id('status')}
        >
          <View style={styles.statusPill}>
            <Pill
              label={event.status_display}
              tone={statusTone === 'info' ? 'plain' : statusTone}
            />
          </View>
        </Tile>
      </Tiles>

      {/* The photograph, in a dark well so it stays the brightest thing on the screen —
            which is how it gets judged. The well is inside a white card rather than being the
            card, because a column of black slabs reads as things that failed to load. */}
      <Card title={t('zonal.theProof')} icon="camera-outline" testID={id('photo-card')}>
        {photo ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={t('zonal.openPhoto')}
            onPress={() => setViewing(photo)}
            style={styles.well}
            testID={id('photo')}
          >
            <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
            {/* Says the picture opens. Faint and small, so the photograph stays the thing
                  being looked at — a permanent button over it is mostly button. */}
            <View style={styles.zoom}>
              <Ionicons name="expand-outline" size={14} color={colors.surface} />
            </View>
          </Pressable>
        ) : (
          // A light dashed frame, never a dark slab: a slab reads as an image that failed
          // to load, and this is a record with no photograph on it.
          <View style={styles.noPhoto} testID={id('no-photo')}>
            <Ionicons name="camera-outline" size={22} color={ink[200]} />
            <AppText style={styles.noPhotoText}>{t('zonal.noPhoto')}</AppText>
          </View>
        )}
        {photo ? (
          // A chosen photograph is a photograph; a live capture is evidence that this
          // animal was served at this place and time. Yolk says which, because somebody
          // settling a dispute six months later cannot tell them apart by looking.
          <View style={[styles.caption, event.photo_source !== 'camera' && styles.captionChosen]}>
            <Ionicons
              name={event.photo_source === 'camera' ? 'camera' : 'images-outline'}
              size={13}
              color={event.photo_source === 'camera' ? colors.textMuted : yolk[800]}
            />
            <AppText
              style={[
                styles.captionText,
                event.photo_source !== 'camera' && styles.captionTextChosen,
              ]}
            >
              {t('zonal.photoCaption', {
                source: t(
                  event.photo_source === 'camera' ? 'zonal.fromCamera' : 'zonal.fromGallery',
                ),
                when: stamp(event.performed_at ?? event.created_at),
              })}
            </AppText>
          </View>
        ) : (
          <AppText style={styles.plainCaption}>{t('zonal.noPhotoCaption')}</AppText>
        )}
      </Card>

      {/* The animal herself, as the Mait registered her in the yard — a different picture
            from the proof: that one is evidence of the act, this one is how she is recognised
            on the next visit. Only where the detail carries her registration record. */}
      {!!animal && (
        <Card
          title={t('zonal.theAnimal')}
          icon="paw-outline"
          tone="warm"
          testID={id('animal-card')}
        >
          {animalPhoto ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={t('zonal.openPhoto')}
              onPress={() => setViewing(animalPhoto)}
              style={styles.well}
              testID={id('animal-photo')}
            >
              <Image source={{ uri: animalPhoto }} style={styles.photo} resizeMode="cover" />
              <View style={styles.zoom}>
                <Ionicons name="expand-outline" size={14} color={colors.surface} />
              </View>
            </Pressable>
          ) : (
            <View style={[styles.noPhoto, styles.noPhotoWarm]} testID={id('no-animal-photo')}>
              <Ionicons name="paw-outline" size={22} color={yolk[400]} />
              <AppText style={styles.noPhotoText}>{t('zonal.noAnimalPhoto')}</AppText>
            </View>
          )}
          <AppText style={styles.plainCaption}>
            {[
              animal.animal_type_display,
              animal.breed,
              animal.ear_tag_no ? t('zonal.tagNo', { tag: animal.ear_tag_no }) : null,
              animal.registered_at
                ? t('zonal.registeredOn', { date: stamp(animal.registered_at) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </Card>
      )}

      {/* A light well, not a dark one: a map is a light thing, and with no fix this is a
            card waiting for a location rather than one that failed to draw a map. */}
      <Card
        title={t('zonal.whereItHappened')}
        icon="location-outline"
        tone={hasFix ? 'info' : 'plain'}
        testID={id('gps')}
      >
        <View style={[styles.mapWell, !hasFix && styles.mapWellEmpty]}>
          <View style={styles.pinChip}>
            <Ionicons name="location" size={15} color={colors.error} />
          </View>
          <View style={styles.mapBody}>
            {hasFix ? (
              <>
                <AppText style={styles.coords}>{`${event.gps_lat}, ${event.gps_lng}`}</AppText>
                <AppText style={styles.plainCaption}>
                  {t(event.gps_source === 'photo' ? 'zonal.gpsFromPhoto' : 'zonal.gpsFromDevice')}
                </AppText>
              </>
            ) : (
              <AppText style={styles.factMissing}>{t('zonal.noGps')}</AppText>
            )}
          </View>
        </View>
        {hasFix && (
          <View style={styles.mapAction}>
            <ZonalAction
              label={t('zonal.openInMaps')}
              icon="navigate-outline"
              tone="outline"
              onPress={openInMaps}
              testID={id('open-maps')}
            />
          </View>
        )}
      </Card>

      <Card title={t('zonal.whoAndWhat')} icon="person-outline" tone="warm" testID={id('who')}>
        <Fact label={t('zonal.farmer')} value={owner?.name || event.owner_name} />
        <View style={styles.fact}>
          <AppText style={styles.factLabel}>{t('zonal.farmerKind')}</AppText>
          <Pill
            label={t(member ? 'zonal.member' : 'zonal.nonMember')}
            tone={member ? 'good' : 'waiting'}
          />
        </View>
        {/* The particulars she is reached and recognised by. A non-member has no SAP record
              to fall back on, so for her these are the only way to settle who she is. The
              Aadhaar comes masked; the full number stays behind the read that logs it. */}
        {!!owner && (
          <>
            {member && (
              <Fact
                label={t('zonal.memberCode')}
                value={owner.code || event.member_code}
                testID={id('member-code')}
              />
            )}
            <Fact label={t('zonal.mobile')} value={owner.mobile_no} testID={id('mobile')} />
            {!!owner.father_husband_name && (
              <Fact
                label={t('zonal.fatherHusband')}
                value={[owner.father_husband_name, owner.relation].filter(Boolean).join(' · ')}
              />
            )}
            {!member && !!owner.address && (
              <Fact label={t('zonal.address')} value={owner.address} />
            )}
            <Fact
              label={t('zonal.aadhaar')}
              value={
                owner.has_aadhar
                  ? [
                      owner.aadhar_masked || '••••',
                      !member && owner.has_aadhar_image ? t('zonal.cardOnFile') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : null
              }
              testID={id('aadhaar')}
            />
          </>
        )}
        <Fact label={t('zonal.collectionPoint')} value={`${event.mpp_name} · ${event.mpp_code}`} />
        <Fact label={t('zonal.theMait')} value={`${event.mait_name} · ${event.mait_code}`} />
        <Fact label={t('zonal.animal')} value={`${event.animal_type} · ${event.breed}`} />
        <Fact label={t('zonal.earTag')} value={event.ear_tag_no} />
      </Card>

      {/* Blue, and the same blue the Mait's own app and the portal draw this card in. It is
            the half of the record a month-end stock count actually goes missing on, and white
            it sat between two other white cards reading as a footnote to them. */}
      <Card title={t('zonal.whatWasUsed')} icon="cube-outline" tone="info" testID={id('used')}>
        <View style={styles.used}>
          <View style={styles.usedBody}>
            <AppText style={styles.usedName}>
              {event.semen_breed || t('zonal.unknownBreed')}
            </AppText>
            <AppText style={styles.usedMeta}>{event.straw_unique_no}</AppText>
          </View>
          <AppText style={styles.usedQty}>{t('zonal.doses', { count: event.doses || 1 })}</AppText>
        </View>
        {consumables.length ? (
          consumables.map(item => (
            <View key={item.code} style={styles.used}>
              <View style={styles.usedBody}>
                <AppText style={styles.usedName}>{item.name}</AppText>
                <AppText style={styles.usedMeta}>{item.code}</AppText>
              </View>
              {/* Some consumables carry no unit in the catalogue, and "1 " with a trailing
                    space reads as a word that failed to load. */}
              <AppText style={styles.usedQty}>
                {[item.qty, item.unit].filter(Boolean).join(' ')}
              </AppText>
            </View>
          ))
        ) : (
          // Not an empty state to apologise for: every capture before consumables were
          // recorded said nothing about its sheaths.
          <AppText style={styles.factMissing}>{t('zonal.noConsumables')}</AppText>
        )}
      </Card>

      {/* Whether it took. An insemination is not finished when the straw is used — it is
            finished when somebody puts a hand on the animal ninety days later. */}
      <Card
        title={t('zonal.didItTake')}
        icon="heart-circle-outline"
        tone="green"
        testID={id('chain')}
      >
        {checks.length ? (
          checks.map((check, index) => {
            const recorded = !!check.outcome;
            const late = !recorded && check.days_until < 0;
            return (
              <View
                key={check.id}
                style={[
                  styles.check,
                  // An open check is the row that has not happened yet, so it is the one
                  // the eye should land on — held apart with a rule rather than a tint,
                  // which at this size would read as a selected row.
                  !recorded && index > 0 && styles.checkOpen,
                  late && index > 0 && styles.checkLate,
                ]}
                testID={id(`check-${check.id}`)}
              >
                <View style={styles.checkBody}>
                  <AppText style={styles.checkTitle}>
                    {t('zonal.checkDue', { date: day(check.due_on) })}
                  </AppText>
                  {!!check.note && <AppText style={styles.checkNote}>{check.note}</AppText>}
                </View>
                <Pill
                  label={
                    recorded
                      ? t(`zonal.outcome_${check.outcome}`, { defaultValue: check.outcome })
                      : late
                        ? t('zonal.checkOverdue', { days: Math.abs(check.days_until) })
                        : t('zonal.notCheckedYet')
                  }
                  tone={
                    recorded ? (OUTCOME_TONE[check.outcome] ?? 'plain') : late ? 'waiting' : 'plain'
                  }
                />
              </View>
            );
          })
        ) : (
          <AppText style={styles.factMissing}>{t('zonal.noChecks')}</AppText>
        )}
      </Card>

      <Card title={t('zonal.theTrail')} icon="time-outline" tone="slate" testID={id('trail')}>
        {timeline.length ? (
          <>
            {timeline.map((step, index) => (
              <View key={step.id} style={styles.step} testID={id(`step-${step.id}`)}>
                <View style={styles.rail}>
                  <View style={styles.bead} />
                  {(index < timeline.length - 1 || !settled) && <View style={styles.thread} />}
                </View>
                <View style={styles.stepBody}>
                  <AppText style={styles.stepTitle}>
                    {step.note || step.to_status.replace(/_/g, ' ')}
                  </AppText>
                  <AppText style={styles.stepMeta}>
                    {[stamp(step.created_at), step.actor_name].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
              </View>
            ))}

            {/* What the event is waiting on. A hollow bead rather than a filled one, so
                  "done" and "still happening" are told apart at a glance and not only by
                  position — nobody should have to work out whether a record is finished or
                  stuck. */}
            {!settled && (
              <View style={styles.step} testID={id('step-waiting')}>
                <View style={styles.rail}>
                  <View style={[styles.bead, styles.beadWaiting]} />
                </View>
                <View style={styles.stepBody}>
                  <AppText style={styles.stepTitle}>{t('zonal.waitingStep')}</AppText>
                  <AppText style={styles.stepMeta}>
                    {t(`zonal.next_${event.status}`, { defaultValue: t('zonal.next_none') })}
                  </AppText>
                </View>
              </View>
            )}
          </>
        ) : (
          <AppText style={styles.factMissing}>{t('zonal.noTrail')}</AppText>
        )}
        <AppText style={styles.plainCaption}>{t('zonal.trailIsFixed')}</AppText>
      </Card>

      {/* A plain modal rather than a route: it is a look, not a place. Black, because the
          photograph is being judged and anything else on screen is a reference point it
          would be judged against. */}
      <Modal
        visible={!!viewing}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        testID={id('photo-viewer')}
      >
        <View style={styles.viewer}>
          <Image source={{ uri: viewing ?? '' }} style={styles.viewerPhoto} resizeMode="contain" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={() => setViewing(null)}
            style={[styles.viewerClose, { top: insets.top + spacing[3] }]}
            testID={id('photo-close')}
          >
            <Ionicons name="close" size={22} color={colors.surface} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // -- the card ---------------------------------------------------------------------------
  card: {
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  card_plain: {},
  card_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  card_warm: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  card_green: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  card_slate: { backgroundColor: ink[50], borderColor: ink[200] },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  // The glyph on a chip, the way every tile and notice in this product carries one. On a
  // white card the chip is tinted; on a washed card it goes white, so it reads as a chip
  // rather than as a stray mark beside the heading.
  chip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ink[50],
  },
  chip_plain: {},
  chip_info: { backgroundColor: colors.surface },
  chip_warm: { backgroundColor: colors.surface },
  chip_green: { backgroundColor: colors.surface },
  // Filled Ink with a white glyph: the trail is the server's record, in the hero's colour.
  chip_slate: { backgroundColor: colors.ink },
  cardTitle: { ...typography.h3, color: colors.ink },
  cardTitle_plain: {},
  cardTitle_info: { color: colors.info },
  cardTitle_warm: { color: yolk[900] },
  cardTitle_green: { color: colors.primaryDark },
  cardTitle_slate: { color: colors.ink },

  statusPill: { alignItems: 'center', marginTop: spacing[2] },
  strawValue: { ...typography.h2, color: colors.ink, marginTop: 2 },
  strawBreed: { ...typography.label, color: colors.info, textAlign: 'center' },
  strawNumber: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
    color: colors.ink,
    textAlign: 'center',
  },

  // -- the hero's facts -------------------------------------------------------------------
  heroFacts: { gap: spacing[2], marginTop: spacing[3] },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  // Green for a member of the dairy, yolk for somebody who is not — the two are charged
  // differently, and which one this was is the first thing a dispute about money asks.
  kindMember: { backgroundColor: colors.primary },
  kindNonMember: { backgroundColor: yolk[400] },
  kindLabel: { ...typography.label, color: colors.surface },
  kindLabelNonMember: { color: colors.ink },
  heroFact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  heroFactChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipBlue: { backgroundColor: colors.info },
  chipYolk: { backgroundColor: yolk[500] },
  heroFactBody: { flex: 1 },
  heroFactLabel: { ...typography.caption, fontSize: 11, color: colors.surface, opacity: 0.7 },
  heroFactValue: { ...typography.bodyStrong, color: colors.surface },
  coordsTile: { alignItems: 'center', marginTop: 2 },
  coordsTileValue: { ...typography.h3, color: colors.ink },
  coordsTileNone: { ...typography.h1, color: colors.ink, marginTop: 2 },

  // -- facts ------------------------------------------------------------------------------
  fact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: yolk[200],
  },
  factLabel: { ...typography.caption, color: yolk[900], flexShrink: 0 },
  factValue: { ...typography.bodyStrong, color: colors.ink, flex: 1, textAlign: 'right' },
  // A fact nobody recorded says so in muted type rather than in the same weight as one that
  // was — the same distinction the portal's non-member detail draws.
  factMissing: { ...typography.body, color: colors.textMuted },

  // -- the photograph ----------------------------------------------------------------------
  well: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: ink[700] },
  photo: { width: '100%', aspectRatio: 4 / 3 },
  zoom: {
    position: 'absolute',
    right: spacing[2],
    bottom: spacing[2],
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  noPhoto: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: ink[50],
  },
  noPhotoWarm: { borderColor: yolk[300], backgroundColor: colors.surface },
  noPhotoText: { ...typography.label, color: colors.textMuted },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  captionChosen: { backgroundColor: colors.secondaryWash },
  captionText: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  captionTextChosen: { color: yolk[800] },
  plainCaption: { ...typography.caption, color: colors.textMuted, marginTop: spacing[2] },

  // -- where -------------------------------------------------------------------------------
  mapWell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  // Dashed and tinted is what an event with no position is left with — a card waiting for a
  // location rather than one that failed to draw a map.
  mapWellEmpty: {
    backgroundColor: ink[50],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  // The same white chip the tiles and notices carry their glyph in, in the red a map marker
  // is drawn in — so the card with no location reads as the same kind of thing as the card
  // with one.
  pinChip: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapBody: { flex: 1 },
  coords: {
    ...typography.label,
    fontFamily: typography.h3.fontFamily,
    fontSize: 15,
    color: colors.ink,
  },
  mapAction: { marginTop: spacing[3] },

  // -- what was used -----------------------------------------------------------------------
  used: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  usedBody: { flex: 1 },
  usedName: { ...typography.bodyStrong, color: colors.ink },
  usedMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  usedQty: { ...typography.bodyStrong, color: colors.ink },

  // -- did it take -------------------------------------------------------------------------
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  checkOpen: { borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border },
  checkLate: { borderTopColor: yolk[300] },
  checkBody: { flex: 1 },
  checkTitle: { ...typography.body, color: colors.ink },
  checkNote: { ...typography.caption, color: colors.textMuted, marginTop: 1 },

  // -- the trail ---------------------------------------------------------------------------
  step: { flexDirection: 'row', gap: spacing[3] },
  // The rail down the left, so the steps read as one chain rather than as a list of rows.
  rail: { alignItems: 'center', width: 12 },
  bead: {
    width: 11,
    height: 11,
    borderRadius: 6,
    marginTop: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  // Hollow, with the yolk edge: still happening, not done.
  beadWaiting: { backgroundColor: colors.surface, borderColor: colors.secondary },
  thread: { flex: 1, width: 2, backgroundColor: ink[200], marginVertical: 2 },
  stepBody: { flex: 1, paddingBottom: spacing[4] },
  stepTitle: { ...typography.bodyStrong, color: colors.ink, textTransform: 'capitalize' },
  stepMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1 },

  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerPhoto: { width: '100%', height: '100%' },
  viewerClose: {
    position: 'absolute',
    right: spacing[4],
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
