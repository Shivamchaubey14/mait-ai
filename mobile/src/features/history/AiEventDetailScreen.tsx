/**
 * One AI event, whole (M20).
 *
 * This is the screen a dispute is settled on. A farmer says she was charged twice, or that
 * nobody came, or that the animal served was not hers — and the Mait standing in front of her
 * has to answer from the phone, out loud, without a signal. So everything the record holds is
 * on one page: which straw, what was charged and where it goes, where the handset was, when
 * the server took it, the proof photo, and the step-by-step trail underneath.
 *
 * The trail is the part that settles arguments, and it is deliberately not editable. Every
 * line was written by the handset at the moment it happened; the screen says so under it,
 * because a record that can be corrected after the fact is not evidence of anything.
 *
 * Two shapes, one screen. A completed event is a statement — here is what happened. An
 * unfinished one is a job: it opens with what is missing, shows the trail already unrolled so
 * the Mait can see how far it got, and ends in the one button that picks the capture back up
 * at exactly the step it stopped on.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useGetAiEventQuery, useGetAiEventTimelineQuery, useListBreedsQuery } from '@api/endpoints';
import type { AIEvent } from '@api/types';
import { BrandMark } from '@/components/brand';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { whatIsMissing } from '@/features/aiFlow/resume';
import { mediaUrl } from '@/config/env';
import {
  colors,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "18 Aug 2026, 10:43" — the whole stamp, because this screen is read months later. */
function stamp(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clock(iso)}`;
}

/** "18 Aug 10:43" — the shorter one, for a caption under a photo. */
function shortStamp(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(iso)}`;
}

type Standing = 'completed' | 'cancelled' | 'waiting';

function standingOf(event: AIEvent): Standing {
  if (event.status === 'completed') {
    return 'completed';
  }
  return event.status === 'cancelled' ? 'cancelled' : 'waiting';
}

// --------------------------------------------------------------------------------------
// Pieces
// --------------------------------------------------------------------------------------
/**
 * One fact in a box: what it is, the figure, and the qualifier that stops the figure being
 * misread. "₹ 50" alone is a number a farmer can argue with; "₹ 50 / deducted from milk" is
 * an answer.
 */
function Tile({
  icon,
  label,
  value,
  note,
  tone = 'plain',
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  note?: string;
  tone?: 'plain' | 'good' | 'info' | 'warn';
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.tile, styles[`tile_${tone}`]]} testID={testID}>
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={13} color={colors.textMuted} />
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {!!note && (
        <Text style={styles.tileNote} numberOfLines={2}>
          {note}
        </Text>
      )}
    </View>
  );
}

/**
 * One line of the audit trail.
 *
 * The rail is drawn on the line rather than on the dot, so the steps read as one continuous
 * thing that happened in order — a column of loose dots reads as four unrelated notes.
 */
function TrailStep({
  note,
  meta,
  last,
}: {
  note: string;
  meta: string;
  last: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={styles.stepDot} />
        {!last && <View style={styles.stepLine} />}
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepNote}>{note}</Text>
        <Text style={styles.stepMeta}>{meta}</Text>
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------------------
export default function AiEventDetailScreen({
  eventId,
  onBack,
  onResume,
  busy = false,
}: {
  eventId: number;
  onBack: () => void;
  /** Picks the capture back up at the step it stopped on. Absent for a finished event. */
  onResume?: (event: AIEvent) => void;
  /**
   * A close-off in flight.
   *
   * Owned by the navigator rather than by this screen, because the work outlives the screen:
   * a capture that resumes leaves for the flow, and one that closes leaves for the recorded
   * screen. What is left here is the wait, and a button that does not say it is working is a
   * button a Mait taps four times.
   */
  busy?: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();

  const detail = useGetAiEventQuery(eventId);
  const online = useOnline();
  const trail = useGetAiEventTimelineQuery(eventId);
  const breeds = useListBreedsQuery();

  const event = detail.data;
  /** A finished event opens as a statement; an unfinished one opens with its own history. */
  const [trailOpen, setTrailOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  const hindi = i18n.language.startsWith('hi');
  const breedName = (code: string): string => {
    const config = (breeds.data ?? []).find(item => item.code === code);
    return (hindi && config?.name_hi) || config?.name || code;
  };

  if (detail.isLoading || !event) {
    return (
      <View style={styles.root}>
        <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
          <View style={styles.heroTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              onPress={onBack}
              style={styles.back}
              testID="ai-event-back"
            >
              <Ionicons name="arrow-back" size={20} color={colors.surface} />
            </Pressable>
            <BrandMark size="small" />
          </View>
        </View>
        <View style={styles.body}>
          {detail.isError ? (
            <Problem
              kind={online ? 'server' : 'offline'}
              onRetry={() => detail.refetch()}
              busy={detail.isFetching}
              testID="ai-event-error"
            />
          ) : (
            <SkeletonList rows={4} />
          )}
        </View>
      </View>
    );
  }

  const standing = standingOf(event);
  const waiting = standing === 'waiting';
  const member = event.owner_type === 'member';
  const showTrail = trailOpen || waiting;

  /**
   * What is missing, and what the button therefore offers.
   *
   * The photo step forks on who the farmer is — a member owes nothing in the yard and a
   * non-member pays on the spot — so that one key carries the owner as well.
   */
  const missing = whatIsMissing(event);
  const finishKey =
    missing === 'photo_captured' ? `photo_captured_${member ? 'member' : 'nonMember'}` : missing;

  const animal = event.ear_tag_no
    ? t('aiFlow.animalWithTag', {
        type: t(`aiFlow.animalType.${event.animal_type}`),
        tag: event.ear_tag_no,
      })
    : t('aiFlow.noEarTag', { type: t(`aiFlow.animalType.${event.animal_type}`) });

  /** What she is charged, which is not what she handed over. Members pay through the dairy. */
  const charge = event.payment?.amount ?? event.amount_due;
  const chargeLabel = charge ? `₹ ${Math.round(Number(charge))}` : t('payment.unpriced');

  const paymentNote = !event.payment
    ? t('aiEvent.paymentNotRecorded')
    : member
      ? t('aiEvent.deductedFromMilk')
      : event.payment.is_verified
        ? t('aiEvent.confirmedByHer')
        : t('aiEvent.notConfirmed');

  const located = !!event.gps_lat && !!event.gps_lng;
  const photo = mediaUrl(event.ai_photo_url);
  /**
   * A photo chosen from the gallery rather than taken here.
   *
   * Said on the record because it changes what the record is worth: a live capture shows this
   * animal was served at this place and time, and a chosen photograph shows an animal. The
   * app accepts both — a Mait whose camera will not open still has to finish the round — and
   * the difference is never left for a reader to guess at.
   */
  const chosen = event.photo_source === 'gallery';

  /** Said in both places the photo appears, so the two can never disagree about it. */
  const photoCaption = !photo
    ? t('aiEvent.photoPending')
    : t(chosen ? 'aiEvent.photoChosen' : 'aiEvent.photoCaption', {
        when: shortStamp(event.performed_at ?? event.created_at),
      });

  const trailRows = trail.data ?? [];

  return (
    <View style={styles.root}>
      {/* The mark sits between the way out and the standing, the way it does on every other
          screen a farmer might be shown. */}
      <View style={[styles.hero, { paddingTop: insets.top + spacing[4] }]}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="ai-event-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>

          <BrandMark size="small" />

          <View style={[styles.standing, styles[`standing_${standing}`]]} testID="ai-event-status">
            <Text style={[styles.standingLabel, styles[`standingLabel_${standing}`]]}>
              {t(`aiEvent.state_${standing}`)}
            </Text>
          </View>
        </View>

        <Text style={styles.heroTitle} numberOfLines={1}>
          {event.owner_name}
        </Text>
        {/* Two quiet lines rather than one long one: the first identifies the record for
            somebody on a phone call, the second identifies the animal for somebody in a yard.
            They are different questions asked by different people. */}
        <Text style={styles.heroLine}>
          {[
            t('aiEvent.eventNo', { id: event.id }),
            member ? event.member_code : t('aiEvent.nonMember'),
            event.mpp_name,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Text style={styles.heroLine}>
          {stamp(event.performed_at ?? event.created_at)} · {animal}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* What is missing, before anything else on the screen. A Mait who opened this row
            opened it because of this sentence. */}
        {waiting && (
          <View style={styles.alert} testID="ai-event-alert">
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <View style={styles.alertBody}>
              <Text style={styles.alertTitle}>{t(`aiEvent.missing_${missing}`)}</Text>
              <Text style={styles.alertText}>
                {/* The cash sentence only where cash was actually taken. A non-member at
                    `photo_captured` has handed over nothing yet, and telling a Mait that
                    money is unconfirmed when none was collected sends them looking for it. */}
                {missing === 'payment_pending' && !member && charge
                  ? t('aiEvent.missingBodyCash', { amount: `₹ ${Math.round(Number(charge))}` })
                  : t(`aiEvent.missingBody_${missing}`)}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.tiles}>
          <Tile
            icon="git-branch-outline"
            label={t('aiEvent.breed')}
            value={breedName(event.semen_breed || event.breed)}
            note={t('aiEvent.doseCount', {
              count: event.doses ?? 1,
              type: t(`aiFlow.animalType.${event.animal_type}`),
            })}
            testID="tile-breed"
          />
          <Tile
            icon="pricetag-outline"
            label={t('aiEvent.payment')}
            value={chargeLabel}
            note={paymentNote}
            tone={event.payment?.is_verified ? 'good' : event.payment ? 'warn' : 'plain'}
            testID="tile-payment"
          />
          <Tile
            icon="location-outline"
            label={t('aiEvent.location')}
            value={
              located
                ? `${Number(event.gps_lat).toFixed(4)}, ${Number(event.gps_lng).toFixed(4)}`
                : t('aiEvent.noLocation')
            }
            note={
              located
                ? event.gps_source === 'photo'
                  ? t('aiEvent.fromThePhoto')
                  : t('aiEvent.fromTheHandset')
                : undefined
            }
            tone={located ? 'info' : 'plain'}
            testID="tile-location"
          />
          <Tile
            icon="cloud-done-outline"
            label={t('aiEvent.recorded')}
            value={event.completed_at ? clock(event.completed_at) : t('aiEvent.notYet')}
            note={event.completed_at ? t('aiEvent.onTheServer') : t('aiEvent.stillOnThisPhone')}
            tone={event.completed_at ? 'good' : 'plain'}
            testID="tile-recorded"
          />
        </View>

        {/* What came off the Mait's stock for this event.

            The semen is on the tile above; this is the rest of it — the sheath, the gloves —
            which is what a month-end count actually goes missing on and what nobody could see
            anywhere until it was recorded. An event captured before the app asked for them has
            none, and the card stays off rather than claiming the visit used nothing. */}
        {event.consumables?.length > 0 && (
          <View style={styles.used} testID="ai-event-used">
            <View style={styles.usedHead}>
              <Ionicons name="cube-outline" size={16} color={colors.info} />
              <Text style={[styles.usedTitle, styles.usedTitleTone]}>{t('aiEvent.used')}</Text>
            </View>

            {event.consumables.map(line => (
              <View key={line.code} style={styles.usedRow}>
                <View style={styles.usedBody}>
                  <Text style={styles.usedName} numberOfLines={1}>
                    {line.name}
                  </Text>
                  <Text style={styles.usedMeta}>{line.code}</Text>
                </View>
                <Text style={styles.usedQty}>
                  {t('aiEvent.usedQty', { count: line.qty, unit: line.unit })}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* The photo, at the size it is worth showing. Never a thumbnail: it is the evidence
            the whole record hangs on, and a farmer has to be able to recognise her own animal
            in it from arm's length. */}
        <View style={styles.photoCard}>
          {/* Tapping it opens it whole. The card crops to a 180pt band so the page below it
              stays reachable, and a cropped photograph is exactly the wrong thing to settle
              an argument with — the ear tag a farmer is being asked to recognise is as often
              as not in the part the crop took. */}
          <Pressable
            accessibilityRole={photo ? 'imagebutton' : 'image'}
            accessibilityLabel={photo ? t('aiEvent.openPhoto') : t('aiEvent.noPhotoYet')}
            accessibilityState={{ disabled: !photo }}
            disabled={!photo}
            onPress={() => setPhotoOpen(true)}
            style={({ pressed }) => [styles.photoFrame, pressed && styles.photoFramePressed]}
            testID="ai-event-photo-open"
          >
            {photo ? (
              <>
                <Image
                  source={{ uri: photo }}
                  style={styles.photo}
                  resizeMode="cover"
                  accessibilityLabel={t('aiEvent.proofPhoto')}
                  testID="ai-event-photo"
                />
                {/* The one affordance saying the photo does something. Bottom right, where it
                    sits over the corner of a yard rather than over an animal. */}
                <View style={styles.expand}>
                  <Ionicons name="expand-outline" size={16} color={colors.surface} />
                </View>
              </>
            ) : (
              <View style={styles.photoEmpty} testID="ai-event-photo-empty">
                <Ionicons name="camera-outline" size={22} color={colors.surface} />
                <Text style={styles.photoEmptyLabel}>{t('aiEvent.noPhotoYet')}</Text>
              </View>
            )}
          </Pressable>
          <Text style={[styles.photoCaption, chosen && styles.photoCaptionChosen]}>
            {photoCaption}
          </Text>
        </View>

        {/* Closed by default on a finished event, because nothing about it is in question;
            open on an unfinished one, where how far it got is the first thing to check. */}
        {!showTrail ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setTrailOpen(true)}
            style={({ pressed }) => [styles.trailToggle, pressed && styles.trailTogglePressed]}
            testID="ai-event-trail-open"
          >
            <Ionicons name="reload-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.trailToggleLabel}>{t('aiEvent.seeTheTrail')}</Text>
          </Pressable>
        ) : (
          <View style={styles.trail} testID="ai-event-trail">
            <View style={styles.trailHead}>
              <Ionicons name="reload-outline" size={16} color={colors.textMuted} />
              <Text style={styles.trailTitle}>{t('aiEvent.auditTrail')}</Text>
            </View>

            {trail.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : trailRows.length === 0 ? (
              <Text style={styles.trailEmpty}>{t('aiEvent.trailUnavailable')}</Text>
            ) : (
              trailRows.map((entry, index) => (
                <TrailStep
                  key={entry.id}
                  note={entry.note || entry.to_status}
                  meta={`${clock(entry.created_at)} · ${entry.actor_name || t('aiEvent.handset')}`}
                  last={index === trailRows.length - 1}
                />
              ))
            )}
          </View>
        )}

        {showTrail && <Text style={styles.footnote}>{t('aiEvent.trailFootnote')}</Text>}
      </ScrollView>

      {/* The photo, whole.

          `contain` rather than `cover`, on black: this is evidence being examined, and a
          viewer that crops to fill the screen is the same crop the card already made. Black
          rather than the app's ink, because the surround should read as absence and let the
          photograph be the only thing lit.

          A plain Modal rather than a route: it is a look, not a place. Nothing about the
          record changes behind it, and the back gesture should return the Mait to the record
          rather than out of it — which `onRequestClose` gives on Android for free. */}
      <Modal
        visible={photoOpen && !!photo}
        transparent={false}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setPhotoOpen(false)}
        testID="ai-event-photo-viewer"
      >
        <View style={styles.viewer}>
          <Pressable
            style={styles.viewerCanvas}
            accessibilityLabel={t('common.close')}
            onPress={() => setPhotoOpen(false)}
          >
            <Image
              source={{ uri: photo }}
              style={styles.viewerPhoto}
              resizeMode="contain"
              accessibilityLabel={t('aiEvent.photoFull')}
              testID="ai-event-photo-full"
            />
          </Pressable>

          {/* A button as well as the tap-anywhere, because tap-to-dismiss is invisible and
              this is the one screen in the app with no visible way out of its own. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={() => setPhotoOpen(false)}
            style={({ pressed }) => [
              styles.viewerClose,
              { top: insets.top + spacing[3] },
              pressed && styles.photoFramePressed,
            ]}
            testID="ai-event-photo-close"
          >
            <Ionicons name="close" size={22} color={colors.surface} />
          </Pressable>

          {/* The same line the card carries, kept with the photograph it qualifies: whether
              this was taken here or chosen from the gallery is the first question asked of a
              photograph being used as proof. */}
          <Text
            style={[styles.viewerCaption, { paddingBottom: insets.bottom + spacing[4] }]}
            testID="ai-event-photo-viewer-caption"
          >
            {photoCaption}
          </Text>
        </View>
      </Modal>

      {/* The way back into the capture, and only where there is a capture to go back into. */}
      {waiting && !!onResume && (
        <View style={[styles.foot, { paddingBottom: spacing[3] + insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            onPress={() => onResume(event)}
            disabled={busy}
            style={({ pressed }) => [styles.cta, pressed && !busy && styles.ctaPressed]}
            testID="ai-event-resume"
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <>
                <Text style={styles.ctaLabel} numberOfLines={1}>
                  {t(`aiEvent.finish_${finishKey}`)}
                </Text>
                <Ionicons name="arrow-forward" size={18} color={colors.surface} />
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // -- hero ------------------------------------------------------------------------------
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroLine: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[1],
  },

  // -- standing --------------------------------------------------------------------------
  standing: {
    marginLeft: 'auto',
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  standing_completed: { backgroundColor: colors.primary },
  standing_waiting: { backgroundColor: colors.secondary },
  standing_cancelled: { backgroundColor: 'rgba(255,255,255,0.18)' },
  standingLabel: { ...typography.label },
  standingLabel_completed: { color: colors.surface },
  // Yolk carries dark text and never light — it fails contrast the other way round.
  standingLabel_waiting: { color: colors.ink },
  standingLabel_cancelled: { color: colors.surface },

  // -- body ------------------------------------------------------------------------------
  body: { padding: spacing[4], paddingBottom: spacing[6] },

  // -- alert -----------------------------------------------------------------------------
  alert: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.errorWash,
    borderWidth: 1,
    borderColor: colors.error,
  },
  alertBody: { flex: 1 },
  alertTitle: { ...typography.bodyStrong, color: colors.ink },
  alertText: { ...typography.caption, color: colors.error, marginTop: 2 },

  // -- tiles -----------------------------------------------------------------------------
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[3] },
  tile: {
    // Two to a row on every handset this ships to, with the gap taken out of the width.
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  tile_plain: {},
  tile_good: { backgroundColor: colors.primaryWash, borderColor: colors.primary },
  tile_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  tile_warn: { backgroundColor: colors.secondaryWash, borderColor: colors.secondary },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileValue: { ...typography.h3, color: colors.ink, marginTop: spacing[2] },
  tileNote: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // -- what was used -----------------------------------------------------------------------
  // Blue, the same pair the location tile on this screen already wears.
  //
  // White, this card sat between two others that were also white and read as a footnote to
  // them — and it is the half of the record a month-end stock count actually goes missing on.
  // Blue is this palette's colour for a fact about the situation, which is exactly what a
  // sheath and a pair of gloves are: not an action to take, not something waiting, and
  // certainly not something wrong. Green would claim it as an action and red as a fault.
  //
  // The wash carries the colour and the border states it; the text stays Ink. That is the
  // rule the token is written to — "pale enough to carry Ink text at full contrast; the
  // status colour is the dot and the border, never the text" — and it is what keeps the card
  // legible on a cheap screen in sunlight.
  used: {
    padding: spacing[4],
    marginBottom: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.infoWash,
    borderWidth: 1,
    borderColor: colors.info,
    ...shadows.card,
  },
  usedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  usedTitle: { ...typography.label, color: colors.textMuted, letterSpacing: 1 },
  usedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  usedTitleTone: { color: colors.info },
  usedBody: { flex: 1 },
  usedName: { ...typography.bodyStrong, color: colors.ink },
  usedMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  usedQty: { ...typography.bodyStrong, color: colors.ink },

  // -- photo -----------------------------------------------------------------------------
  photoCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoFrame: { height: 180, backgroundColor: colors.ink },
  photoFramePressed: { opacity: 0.85 },
  photo: { width: '100%', height: '100%' },
  // Over the photograph, so it needs its own ground: a bare glyph disappears against a light
  // patch of yard.
  expand: {
    position: 'absolute',
    right: spacing[3],
    bottom: spacing[3],
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  photoEmptyLabel: { ...typography.caption, color: colors.surface, opacity: 0.8 },
  photoCaption: { ...typography.caption, color: colors.textMuted, padding: spacing[3] },
  // Not red — a chosen photo is allowed, not an error. Amber is this product's "read this
  // before you rely on it", which is exactly what the line is for.
  photoCaptionChosen: { color: yolk[800], backgroundColor: colors.secondaryWash },

  // -- the photo, whole ------------------------------------------------------------------
  viewer: { flex: 1, backgroundColor: '#000000' },
  viewerCanvas: { flex: 1 },
  viewerPhoto: { width: '100%', height: '100%' },
  viewerClose: {
    position: 'absolute',
    right: spacing[4],
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  viewerCaption: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.8,
    textAlign: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
  },

  // -- trail -----------------------------------------------------------------------------
  trailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  trailTogglePressed: { backgroundColor: colors.primaryWash },
  trailToggleLabel: { ...typography.bodyStrong, color: colors.primaryDark },

  trail: {
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  trailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  trailTitle: { ...typography.label, color: colors.textMuted, letterSpacing: 1 },
  trailEmpty: { ...typography.caption, color: colors.textMuted },

  step: { flexDirection: 'row', gap: spacing[3] },
  stepRail: { alignItems: 'center', width: 12 },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.primaryWash },
  stepBody: { flex: 1, paddingBottom: spacing[4] },
  stepNote: { ...typography.bodyStrong, color: colors.ink },
  stepMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing[3],
    paddingHorizontal: spacing[1],
  },

  // -- foot ------------------------------------------------------------------------------
  // Opaque: the body scrolls behind it, and a transparent foot would show rows sliding
  // through the one button on the screen.
  foot: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    backgroundColor: colors.background,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    paddingHorizontal: spacing[5],
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface, flexShrink: 1 },
});
