/**
 * Step 5 of the AI capture flow â€” the proof photo (SRS Â§6.3 step 5, M9).
 *
 * The camera is the way this step is meant to be answered, and it is what the screen opens
 * on: a photo taken here, now, with the pin and the clock attached, is the only kind that
 * shows the insemination happened.
 *
 * A photo can also be chosen from the gallery, under the button rather than beside the
 * shutter. A camera that will not open, a handset that has run out of patience, a round
 * written up an hour later — those happen, and a Mait who cannot finish the record at all is
 * worse than a record that says how it was made. What the app never does is blur the two: a
 * chosen photo is sent as chosen, the event carries `photo_source`, the audit trail says so
 * in words, and the record screen repeats it.
 *
 * The pin follows the same rule. A live shot is pinned by the handset, which is standing in
 * the yard. A chosen one takes the pin the camera wrote into the file, because a photo taken
 * an hour ago in another village must not be filed against wherever the phone happens to be
 * now — and where the file carries none, the handset's own position is used and the record
 * says that is what happened.
 *
 * The GPS fix and the device clock are captured with the shot, not at upload. An event taken
 * in a yard with no signal may not reach the server for hours, and both facts have to describe
 * the moment the photo was taken rather than the moment it finally sent.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AI_FLOW_STEPS } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen } from './components';
import { exifCoords } from './exif';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `11 Aug · 10:42` — 24-hour, because a Mait reading a record wants the order, not am/pm. */
function stamp(when: Date): string {
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()]} · ${time}`;
}

export interface CapturedPhoto {
  uri: string;
  gpsLat: number | null;
  gpsLng: number | null;
  accuracy: number | null;
  performedAt: string;
  /** How the picture was got. Recorded on the event, never inferred by the server. */
  source: 'camera' | 'gallery';
  /** Whose pin this is — the handset's own, or the one inside the photograph. */
  gpsSource: 'device' | 'photo';
}

interface Props {
  onCaptured: (photo: CapturedPhoto) => void;
  onBack: () => void;
  busy?: boolean;
}

export default function CapturePhotoScreen({ onCaptured, onBack, busy = false }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<CapturedPhoto | null>(null);
  const [taking, setTaking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [galleryDenied, setGalleryDenied] = useState(false);
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // The clock on screen is the one that will be stamped on the record, so it has to be the
  // real time rather than the time the screen happened to open.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(tick);
  }, []);

  // Asked for as the screen opens, not at the shutter: a GPS fix can take several seconds in
  // a yard, and making the Mait wait after they have already framed the animal is the one
  // moment they will not wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!cancelled) {
          setLocationDenied(true);
        }
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!cancelled) {
        setFix(position);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const takePhoto = async () => {
    if (!camera.current || taking) {
      return;
    }
    setTaking(true);
    try {
      const photo = await camera.current.takePictureAsync({
        quality: 0.6, // enough to identify the animal, small enough to send on one bar
        skipProcessing: true,
      });
      if (photo) {
        setShot({
          uri: photo.uri,
          gpsLat: fix?.coords.latitude ?? null,
          gpsLng: fix?.coords.longitude ?? null,
          accuracy: fix?.coords.accuracy ?? null,
          performedAt: new Date().toISOString(),
          source: 'camera',
          gpsSource: 'device',
        });
      }
    } finally {
      setTaking(false);
    }
  };

  /**
   * Take the photo from the gallery instead.
   *
   * `performedAt` stays the moment the record is being made, never the photograph's own date.
   * The event is when the insemination is being recorded; backdating it to whenever the file
   * was created would move a day's work into a month that has already been reported on.
   *
   * The pin is the other way round: the photograph's own is preferred, because that is where
   * the picture was taken and the handset may be somewhere else entirely by now.
   */
  const pickFromGallery = async () => {
    if (picking) {
      return;
    }
    setPicking(true);
    try {
      const allowed = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!allowed.granted) {
        setGalleryDenied(true);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        exif: true,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) {
        return;
      }

      const written = exifCoords(asset.exif as Record<string, unknown> | null);
      setShot({
        uri: asset.uri,
        gpsLat: written?.lat ?? fix?.coords.latitude ?? null,
        gpsLng: written?.lng ?? fix?.coords.longitude ?? null,
        accuracy: written ? null : (fix?.coords.accuracy ?? null),
        performedAt: new Date().toISOString(),
        source: 'gallery',
        gpsSource: written ? 'photo' : 'device',
      });
    } finally {
      setPicking(false);
    }
  };

  // -- permission gate -------------------------------------------------------------------
  if (!permission) {
    return (
      <FlowScreen step={5} title={t('aiFlow.takePhoto')} onBack={onBack}>
        <ActivityIndicator color={colors.primary} />
      </FlowScreen>
    );
  }

  if (!permission.granted) {
    return (
      <FlowScreen
        step={5}
        title={t('aiFlow.takePhoto')}
        subtitle={t('aiFlow.cameraNeededSubtitle')}
        onBack={onBack}
        cta={{
          label: t('aiFlow.allowCamera'),
          onPress: requestPermission,
          testID: 'allow-camera',
        }}
      >
        <FlowNotice
          tone="info"
          title={t('aiFlow.cameraNeededTitle')}
          body={t('aiFlow.cameraNeededBody')}
        />
      </FlowScreen>
    );
  }

  // -- review ----------------------------------------------------------------------------
  if (shot) {
    return (
      <FlowScreen
        step={5}
        title={t('aiFlow.photoTaken')}
        subtitle={t('aiFlow.photoTakenSubtitle')}
        onBack={() => setShot(null)}
        cta={{
          label: t('common.continue'),
          onPress: () => onCaptured(shot),
          busy,
          testID: 'photo-continue',
        }}
        link={{
          label: t('aiFlow.retake'),
          onPress: () => setShot(null),
          testID: 'photo-retake',
        }}
      >
        <Image source={{ uri: shot.uri }} style={styles.preview} resizeMode="cover" />

        <View style={styles.stamp}>
          <Ionicons name="location-outline" size={16} color={colors.textMuted} />
          <Text style={styles.stampText}>
            {shot.gpsLat == null
              ? t('aiFlow.noPin')
              : shot.gpsSource === 'photo'
                ? // No accuracy figure: it is the photograph's pin, not a fix this handset
                  // took, and quoting a ±metres it never measured would be inventing one.
                  t('aiFlow.pinFromPhoto', {
                    lat: shot.gpsLat.toFixed(4),
                    lng: shot.gpsLng?.toFixed(4),
                  })
                : t('aiFlow.pinAt', {
                    lat: shot.gpsLat.toFixed(4),
                    lng: shot.gpsLng?.toFixed(4),
                    accuracy: Math.round(shot.accuracy ?? 0),
                  })}
          </Text>
        </View>

        {/* Said before it is sent, not discovered on the record afterwards. A Mait who meant
            to take a photo and picked one by mistake finds out here, where retake is one tap
            away. */}
        {shot.source === 'gallery' && (
          <FlowNotice
            tone="info"
            title={t('aiFlow.chosenTitle')}
            body={shot.gpsSource === 'photo' ? t('aiFlow.chosenWithPin') : t('aiFlow.chosenNoPin')}
            testID="photo-from-gallery"
          />
        )}

        {shot.gpsLat == null && (
          <FlowNotice
            tone="accent"
            title={t('aiFlow.noPinTitle')}
            body={t('aiFlow.noPinBody')}
            testID="photo-no-gps"
          />
        )}
      </FlowScreen>
    );
  }

  // -- camera ----------------------------------------------------------------------------
  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor={colors.ink} />

      {/* The step and the question, on the page rather than in the flow's Ink card — the card
          is a frame for a body, and here the body is a live camera that wants the room. */}
      <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
        <View style={styles.headerTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
            testID="photo-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
          <Text style={styles.stepLabel}>
            {t('aiFlow.stepOf', { current: AI_FLOW_STEPS.length, total: AI_FLOW_STEPS.length })}
          </Text>
        </View>
        <Text style={styles.title}>{t('aiFlow.takePhoto')}</Text>
      </View>

      {/* A dashed frame around the preview: it reads as a space to be filled, which is what
          the Mait is being asked to do — put two things inside it. */}
      <View style={styles.frame}>
        <View style={styles.cameraWrap}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing={facing}
            enableTorch={torch}
            testID="camera"
          />
        </View>

        {/* What has to be in shot, said at the top rather than across the middle: the middle
            is where the animal goes. */}
        <Text style={styles.frameHint}>{t('aiFlow.animalAndMaitInFrame')}</Text>
      </View>

      {/* The two facts that will be stamped on the record, shown before the shutter so a Mait
          knows what they are about to capture rather than discovering it afterwards. */}
      <View style={styles.stampRow}>
        <View style={styles.stampLeft}>
          <Ionicons
            name="location-outline"
            size={16}
            color={fix ? colors.surface : 'rgba(255,255,255,0.55)'}
          />
          <Text style={styles.stampValue} numberOfLines={1}>
            {locationDenied
              ? t('aiFlow.noPin')
              : fix
                ? `${fix.coords.latitude.toFixed(4)}, ${fix.coords.longitude.toFixed(4)}`
                : t('aiFlow.findingPin')}
          </Text>
        </View>
        <Text style={styles.stampValue}>{stamp(now)}</Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[4] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('aiFlow.flipCamera')}
          onPress={() => setFacing(current => (current === 'back' ? 'front' : 'back'))}
          style={({ pressed }) => [styles.sideButton, pressed && styles.sideButtonPressed]}
          testID="photo-flip"
        >
          <Ionicons name="camera-reverse-outline" size={22} color={colors.surface} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('aiFlow.takePhoto')}
          onPress={takePhoto}
          disabled={taking}
          style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}
          testID="photo-shutter"
        >
          {taking ? <ActivityIndicator color={colors.ink} /> : <View style={styles.shutterInner} />}
        </Pressable>

        {/* A torch, not a flash: sheds are dark at the hours a Mait works, and a light that
            stays on lets them frame the shot before taking it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: torch }}
          accessibilityLabel={t('aiFlow.light')}
          onPress={() => setTorch(on => !on)}
          style={({ pressed }) => [
            styles.sideButton,
            torch && styles.sideButtonOn,
            pressed && styles.sideButtonPressed,
          ]}
          testID="photo-torch"
        >
          <Ionicons
            name={torch ? 'flashlight' : 'flashlight-outline'}
            size={22}
            color={torch ? colors.ink : colors.surface}
          />
        </Pressable>
      </View>

      {/* Under the shutter rather than beside it, and in words rather than as a third round
          button: taking the photo is what this step is for, and the two are not equal
          choices. */}
      <View style={[styles.gallery, { paddingBottom: insets.bottom + spacing[2] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: picking }}
          onPress={pickFromGallery}
          disabled={picking}
          style={({ pressed }) => [styles.galleryButton, pressed && styles.galleryButtonPressed]}
          testID="photo-gallery"
        >
          {picking ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <>
              <Ionicons name="images-outline" size={16} color={colors.surface} />
              <Text style={styles.galleryLabel}>{t('aiFlow.chooseFromGallery')}</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.cameraOnly}>
          {galleryDenied ? t('aiFlow.galleryDenied') : t('aiFlow.chosenIsMarked')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },

  gallery: { alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[5] },
  galleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[5],
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  galleryButtonPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  galleryLabel: { ...typography.bodyStrong, color: colors.surface },

  header: { paddingHorizontal: spacing[5], paddingBottom: spacing[4] },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },
  stepLabel: { ...typography.label, color: colors.surface, opacity: 0.72 },
  title: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },

  // Dashed, because it is a space waiting to be filled rather than a picture already taken.
  frame: {
    flex: 1,
    marginHorizontal: spacing[4],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: radius.lg,
    padding: spacing[1],
  },
  // The rounding lives here rather than on the frame: clipping a camera surface to a corner
  // radius is the sort of thing Android does badly, and this keeps the dashes off it.
  cameraWrap: { flex: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#0B1219' },
  frameHint: {
    position: 'absolute',
    top: spacing[3],
    alignSelf: 'center',
    ...typography.caption,
    color: colors.surface,
    backgroundColor: 'rgba(12,21,27,0.6)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  stampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
  },
  stampLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexShrink: 1 },
  // On the dark capture screen. The review screen's version of this line is on white, and is
  // `stampText` below.
  stampValue: { ...typography.label, color: colors.surface },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[6],
    paddingHorizontal: spacing[5],
  },
  sideButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sideButtonPressed: { backgroundColor: 'rgba(255,255,255,0.24)' },
  sideButtonOn: { backgroundColor: colors.surface },
  // Ringed in green: the one control on a dark screen that must be found without looking.
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  shutterPressed: { backgroundColor: colors.background },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.surface,
  },
  cameraOnly: {
    ...typography.caption,
    color: colors.surface,
    opacity: 0.6,
    textAlign: 'center',
  },

  preview: {
    width: '100%',
    height: 260,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET - 12,
    marginTop: spacing[3],
  },
  stampText: { ...typography.caption, color: colors.textMuted },
});
