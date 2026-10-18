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
import Glyph, { GlyphName, STRAW_GLYPH } from '@/components/glyph';
import Problem, { useOnline } from '@/components/problem';
import { SkeletonList } from '@/components/states';
import { whatIsMissing } from '@/features/aiFlow/resume';
import { mediaUrl } from '@/config/env';
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
 *
 * Always in a colour — green settled, yolk waiting, red missing, blue a fact, slate nothing to
 * say — with its glyph on a solid chip, so the four read before a word of them is.
 */
type Tone = 'good' | 'warn' | 'bad' | 'info' | 'slate';

const SOLID: Record<Tone, string> = {
  good: colors.primary,
  warn: yolk[500],
  bad: colors.error,
  info: colors.info,
  slate: ink[400],
};

/** A word on a wash: green and yolk read darker than their solids. */
const WORD: Record<Tone, string> = {
  good: colors.primaryDark,
  warn: yolk[800],
  bad: colors.error,
  info: colors.info,
  slate: ink[500],
};

function onSolid(tone: Tone): string {
  return tone === 'warn' ? colors.ink : colors.surface;
}

function Tile({
  icon,
  label,
  value,
  note,
  tone,
  testID,
}: {
  icon: GlyphName;
  label: string;
  value: string;
  note?: string;
  tone: Tone;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.tile, styles[`tone_${tone}`]]} testID={testID}>
      <View style={styles.tileHead}>
        <View style={[styles.chip, { backgroundColor: SOLID[tone] }]}>
          <Glyph name={icon} size={15} color={onSolid(tone)} />
        </View>
        <Text style={[styles.tileLabel, { color: WORD[tone] }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {!!note && (
        <Text style={[styles.tileNote, { color: WORD[tone] }]} numberOfLines={2}>
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
  n,
  note,
  meta,
  last,
}: {
  n: number;
  note: string;
  meta: string;
  last: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        {/* Numbered, and the latest in green: where the capture has got to. */}
        <View style={[styles.stepDot, last && styles.stepDotLast]}>
          <Text style={styles.stepDotLabel}>{n}</Text>
        </View>
        {!last && <View style={styles.stepLine} />}
      </View>
      <View style={[styles.stepBody, last && styles.stepBodyLast]}>
        <Text style={styles.stepNote}>{note}</Text>
        <View style={styles.stepMetaLine}>
          <Ionicons name="time-outline" size={12} color={ink[500]} />
          <Text style={styles.stepMeta}>{meta}</Text>
        </View>
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
            <Ionicons
              name={
                standing === 'completed'
                  ? 'checkmark-circle'
                  : standing === 'waiting'
                    ? 'time'
                    : 'close-circle'
              }
              size={14}
              color={standing === 'waiting' ? colors.ink : colors.surface}
            />
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
        <View style={styles.heroPills}>
          <View style={[styles.heroPill, styles.heroPillSlate]}>
            <Ionicons name="document-text" size={12} color={colors.surface} />
            <Text style={styles.heroPillLabel}>{t('aiEvent.eventNo', { id: event.id })}</Text>
          </View>
          <View
            style={[styles.heroPill, member ? styles.heroPillInfo : styles.heroPillWarm]}
            testID="ai-event-owner"
          >
            <Ionicons
              name={member ? 'people' : 'person'}
              size={12}
              color={member ? colors.surface : colors.ink}
            />
            <Text style={[styles.heroPillLabel, !member && { color: colors.ink }]}>
              {member ? event.member_code : t('aiEvent.nonMember')}
            </Text>
          </View>
          {!!event.mpp_name && (
            <View style={[styles.heroPill, styles.heroPillSlate]}>
              <Ionicons name="home" size={12} color={colors.surface} />
              <Text style={styles.heroPillLabel} numberOfLines={1}>
                {event.mpp_name}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.heroFacts}>
          <Ionicons name="calendar" size={13} color={colors.surface} />
          <Text style={styles.heroLine}>{stamp(event.performed_at ?? event.created_at)}</Text>
          <Ionicons name="paw" size={13} color={colors.surface} />
          <Text style={[styles.heroLine, styles.heroLineShrink]} numberOfLines={1}>
            {animal}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* What is missing, before anything else on the screen. A Mait who opened this row
            opened it because of this sentence. */}
        {waiting && (
          <View style={styles.alert} testID="ai-event-alert">
            <View style={[styles.chipLarge, { backgroundColor: colors.error }]}>
              <Ionicons name="alert" size={20} color={colors.surface} />
            </View>
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
            icon={STRAW_GLYPH}
            tone="info"
            label={t('aiEvent.breed')}
            value={breedName(event.semen_breed || event.breed)}
            note={t('aiEvent.doseCount', {
              count: event.doses ?? 1,
              type: t(`aiFlow.animalType.${event.animal_type}`),
            })}
            testID="tile-breed"
          />
          <Tile
            icon="cash"
            label={t('aiEvent.payment')}
            value={chargeLabel}
            note={paymentNote}
            // A member's deduction is settled the moment it is recorded — the dairy takes it
            // from her milk — so only a non-member's unconfirmed cash waits.
            tone={!event.payment ? 'bad' : member || event.payment.is_verified ? 'good' : 'warn'}
            testID="tile-payment"
          />
          <Tile
            icon="location"
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
            tone={located ? 'info' : 'slate'}
            testID="tile-location"
          />
          <Tile
            icon={event.completed_at ? 'cloud-done' : 'phone-portrait'}
            label={t('aiEvent.recorded')}
            value={event.completed_at ? clock(event.completed_at) : t('aiEvent.notYet')}
            note={event.completed_at ? t('aiEvent.onTheServer') : t('aiEvent.stillOnThisPhone')}
            tone={event.completed_at ? 'good' : 'warn'}
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
              <View style={[styles.chip, { backgroundColor: colors.primary }]}>
                <Ionicons name="flask" size={15} color={colors.surface} />
              </View>
              <Text style={styles.usedTitle}>{t('aiEvent.used')}</Text>
              <View style={styles.usedCount}>
                <Text style={styles.usedCountLabel}>{event.consumables.length}</Text>
              </View>
            </View>

            {event.consumables.map(line => (
              <View key={line.code} style={styles.usedRow}>
                <View style={styles.usedBody}>
                  <Text style={styles.usedName} numberOfLines={1}>
                    {line.name}
                  </Text>
                  <Text style={styles.usedMeta}>{line.code}</Text>
                </View>
                <View style={styles.usedQty}>
                  <Text style={styles.usedQtyLabel}>
                    {t('aiEvent.usedQty', { count: line.qty, unit: line.unit })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* The photo, at the size it is worth showing. Never a thumbnail: it is the evidence
            the whole record hangs on, and a farmer has to be able to recognise her own animal
            in it from arm's length. */}
        <View style={[styles.photoCard, chosen ? styles.tone_warn : styles.tone_info]}>
          <View style={styles.photoHead}>
            <View style={[styles.chip, { backgroundColor: chosen ? yolk[500] : colors.info }]}>
              <Ionicons
                name={chosen ? 'images' : 'camera'}
                size={15}
                color={chosen ? colors.ink : colors.surface}
              />
            </View>
            <Text style={[styles.photoTitle, { color: chosen ? yolk[800] : colors.info }]}>
              {t('aiEvent.proofPhoto')}
            </Text>
          </View>
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
          <View style={styles.photoCaptionLine}>
            <Ionicons
              name={chosen ? 'warning' : photo ? 'time' : 'hourglass'}
              size={13}
              color={chosen ? yolk[800] : colors.info}
            />
            <Text style={[styles.photoCaption, chosen && styles.photoCaptionChosen]}>
              {photoCaption}
            </Text>
          </View>
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
            <View style={[styles.chip, { backgroundColor: ink[500] }]}>
              <Ionicons name="git-commit" size={15} color={colors.surface} />
            </View>
            <Text style={styles.trailToggleLabel}>{t('aiEvent.seeTheTrail')}</Text>
            <Ionicons name="chevron-down" size={16} color={ink[500]} />
          </Pressable>
        ) : (
          <View style={styles.trail} testID="ai-event-trail">
            <View style={styles.trailHead}>
              <View style={[styles.chip, { backgroundColor: ink[500] }]}>
                <Ionicons name="git-commit" size={15} color={colors.surface} />
              </View>
              <Text style={styles.trailTitle}>{t('aiEvent.auditTrail')}</Text>
              {trailRows.length > 0 && (
                <View style={styles.trailCount}>
                  <Text style={styles.trailCountLabel}>{trailRows.length}</Text>
                </View>
              )}
            </View>

            {trail.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : trailRows.length === 0 ? (
              <Text style={styles.trailEmpty}>{t('aiEvent.trailUnavailable')}</Text>
            ) : (
              trailRows.map((entry, index) => (
                <TrailStep
                  key={entry.id}
                  n={index + 1}
                  note={entry.note || entry.to_status}
                  meta={`${clock(entry.created_at)} · ${entry.actor_name || t('aiEvent.handset')}`}
                  last={index === trailRows.length - 1}
                />
              ))
            )}
          </View>
        )}

        {showTrail && (
          <View style={styles.footnote}>
            <Ionicons name="lock-closed" size={13} color={ink[500]} />
            <Text style={styles.footnoteLabel}>{t('aiEvent.trailFootnote')}</Text>
          </View>
        )}
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
  heroLine: { ...typography.caption, color: colors.surface, opacity: 0.85 },
  heroLineShrink: { flexShrink: 1 },
  heroFacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  heroPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  heroPillSlate: { backgroundColor: 'rgba(255,255,255,0.16)' },
  heroPillInfo: { backgroundColor: colors.info },
  heroPillWarm: { backgroundColor: yolk[500] },
  heroPillLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
    flexShrink: 1,
  },

  // -- standing --------------------------------------------------------------------------
  standing: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    alignItems: 'center',
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
    padding: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  tone_good: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  tone_warn: { backgroundColor: colors.secondaryWash, borderColor: yolk[300] },
  tone_bad: { backgroundColor: colors.errorWash, borderColor: colors.error },
  tone_info: { backgroundColor: colors.infoWash, borderColor: colors.info },
  tone_slate: { backgroundColor: ink[50], borderColor: ink[100] },
  chip: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLarge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  tileLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    flexShrink: 1,
  },
  tileValue: { ...typography.h3, color: colors.ink, marginTop: spacing[2] },
  tileNote: { ...typography.caption, marginTop: 2 },

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
    backgroundColor: colors.primaryWash,
    borderWidth: 1,
    borderColor: green[300],
  },
  usedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  usedTitle: { ...typography.label, color: colors.primaryDark, flex: 1 },
  usedCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  usedCountLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  usedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    marginTop: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: green[300],
    backgroundColor: colors.surface,
  },
  usedBody: { flex: 1 },
  usedName: { ...typography.bodyStrong, color: colors.ink },
  usedMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  usedQty: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  usedQtyLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },

  // -- photo -----------------------------------------------------------------------------
  photoCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing[3],
    borderWidth: 1,
  },
  photoHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
  },
  photoTitle: { ...typography.label },
  photoCaptionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
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
  photoCaption: {
    ...typography.caption,
    color: colors.info,
    paddingVertical: spacing[3],
    flexShrink: 1,
  },
  // Not red — a chosen photo is allowed, not an error. Amber is this product's "read this
  // before you rely on it", which is exactly what the line is for.
  photoCaptionChosen: { color: yolk[800] },

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
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + 8,
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  trailTogglePressed: { opacity: 0.8 },
  trailToggleLabel: { ...typography.bodyStrong, color: ink[600], flex: 1 },

  // Slate, the colour of a trail: a record of what happened, neither done nor waiting.
  trail: {
    padding: spacing[4],
    borderRadius: radius.lg,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  trailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  trailTitle: { ...typography.label, color: ink[600], flex: 1 },
  trailCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ink[500],
  },
  trailCountLabel: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  trailEmpty: { ...typography.caption, color: ink[500] },

  step: { flexDirection: 'row', gap: spacing[3] },
  stepRail: { alignItems: 'center', width: 24 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ink[400],
  },
  stepDotLast: { backgroundColor: colors.primary },
  stepDotLabel: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.label.fontFamily,
    color: colors.surface,
  },
  stepLine: { flex: 1, width: 2, backgroundColor: ink[200] },
  stepBody: {
    flex: 1,
    padding: spacing[3],
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ink[100],
    backgroundColor: colors.surface,
  },
  stepBodyLast: { backgroundColor: colors.primaryWash, borderColor: green[300] },
  stepNote: { ...typography.bodyStrong, color: colors.ink },
  stepMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  stepMeta: { ...typography.caption, color: ink[500] },

  footnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: ink[50],
    borderWidth: 1,
    borderColor: ink[100],
  },
  footnoteLabel: { ...typography.caption, color: ink[600], flex: 1 },

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
