/**
 * Step 5 of the AI capture flow — the proof photo (SRS §6.3 step 5, M9).
 *
 * Camera only. There is deliberately no gallery picker: a photo chosen from the roll proves
 * nothing about this animal at this time, and the entire point of this step is that the
 * insemination can be shown to have happened.
 *
 * The GPS fix and the device clock are captured with the shot, not at upload. An event taken
 * in a yard with no signal may not reach the server for hours, and both facts have to describe
 * the moment the photo was taken rather than the moment it finally sent.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

import { FlowNotice, FlowScreen } from './components';

export interface CapturedPhoto {
  uri: string;
  gpsLat: number | null;
  gpsLng: number | null;
  accuracy: number | null;
  performedAt: string;
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
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

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
        });
      }
    } finally {
      setTaking(false);
    }
  };

  // -- permission gate -------------------------------------------------------------------
  if (!permission) {
    return (
      <FlowScreen step={4} title={t('aiFlow.takePhoto')} onBack={onBack}>
        <ActivityIndicator color={colors.primary} />
      </FlowScreen>
    );
  }

  if (!permission.granted) {
    return (
      <FlowScreen
        step={4}
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
        step={4}
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
            {shot.gpsLat != null
              ? t('aiFlow.pinAt', {
                  lat: shot.gpsLat.toFixed(4),
                  lng: shot.gpsLng?.toFixed(4),
                  accuracy: Math.round(shot.accuracy ?? 0),
                })
              : t('aiFlow.noPin')}
          </Text>
        </View>

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
      <CameraView ref={camera} style={styles.camera} facing="back" testID="camera" />

      <View style={[styles.overlay, { paddingTop: insets.top + spacing[3] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          style={styles.back}
          testID="photo-back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.surface} />
        </Pressable>
        <Text style={styles.instruction}>{t('aiFlow.frameTheAnimal')}</Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[5] }]}>
        {/* Stated before the shot, so a Mait knows whether the pin will be on it. */}
        <Text style={styles.gpsState}>
          {locationDenied
            ? t('aiFlow.noPin')
            : fix
              ? t('aiFlow.pinReady', { accuracy: Math.round(fix.coords.accuracy ?? 0) })
              : t('aiFlow.findingPin')}
        </Text>

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

        {/* No gallery button, on purpose (SRS §6.3 step 5). */}
        <Text style={styles.cameraOnly}>{t('aiFlow.cameraOnly')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  camera: { ...StyleSheet.absoluteFillObject },

  overlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instruction: {
    ...typography.bodyStrong,
    color: colors.surface,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  controls: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: spacing[3],
  },
  gpsState: {
    ...typography.caption,
    color: colors.surface,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  shutterPressed: { backgroundColor: 'rgba(255,255,255,0.5)' },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
  },
  cameraOnly: { ...typography.caption, color: colors.surface, opacity: 0.75 },

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
