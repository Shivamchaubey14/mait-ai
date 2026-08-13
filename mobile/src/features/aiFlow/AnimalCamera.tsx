/**
 * A camera for the animal's portrait.
 *
 * Not the proof-photo screen. That one burns in a GPS pin and a timestamp because it is
 * evidence of an insemination at a place and a time; this is a picture of a cow so the Mait
 * recognises her in six months. No pin, no clock, no permission dance if it can be helped —
 * the Mait is standing in front of the animal with the farmer waiting.
 *
 * Camera only, no gallery picker, for the same reason as everywhere else in the flow: a photo
 * chosen from a roll is a photo of an animal somewhere, once.
 */

import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

export default function AnimalCamera({
  onCaptured,
  onCancel,
}: {
  onCaptured: (uri: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [shot, setShot] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);

  const take = async () => {
    if (!camera.current || taking) {
      return;
    }
    setTaking(true);
    try {
      const photo = await camera.current.takePictureAsync({
        // Enough to recognise her, small enough to send on one bar of signal.
        quality: 0.6,
        skipProcessing: true,
      });
      if (photo) {
        setShot(photo.uri);
      }
    } finally {
      setTaking(false);
    }
  };

  // -- permission --------------------------------------------------------------------------
  if (!permission?.granted) {
    return (
      <View style={[styles.root, styles.gate, { paddingTop: insets.top + spacing[5] }]}>
        <Text style={styles.gateTitle}>{t('aiFlow.cameraNeededTitle')}</Text>
        <Text style={styles.gateBody}>{t('aiFlow.animalPhotoBody')}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={requestPermission}
          style={styles.primary}
          testID="animal-camera-allow"
        >
          <Text style={styles.primaryLabel}>{t('aiFlow.allowCamera')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.link}
          testID="animal-camera-skip"
        >
          <Text style={styles.linkLabel}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    );
  }

  // -- review ------------------------------------------------------------------------------
  if (shot) {
    return (
      <View style={styles.root}>
        <Image source={{ uri: shot }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[5] }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShot(null)}
            style={styles.secondary}
            testID="animal-camera-retake"
          >
            <Text style={styles.secondaryLabel}>{t('aiFlow.retake')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onCaptured(shot)}
            style={styles.primary}
            testID="animal-camera-use"
          >
            <Text style={styles.primaryLabel}>{t('aiFlow.usePhoto')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // -- viewfinder --------------------------------------------------------------------------
  return (
    <View style={styles.root}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        testID="animal-camera"
      />

      <View style={[styles.top, { paddingTop: insets.top + spacing[3] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onCancel}
          style={styles.close}
          testID="animal-camera-close"
        >
          <Ionicons name="close" size={20} color={colors.surface} />
        </Pressable>
        <Text style={styles.instruction}>{t('aiFlow.frameTheAnimal')}</Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[5] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('aiFlow.take')}
          onPress={take}
          disabled={taking}
          style={styles.shutter}
          testID="animal-camera-shutter"
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.ink },
  gate: { padding: spacing[5], justifyContent: 'center' },
  gateTitle: { ...typography.h2, color: colors.surface, textAlign: 'center' },
  gateBody: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    textAlign: 'center',
    marginTop: spacing[2],
    marginBottom: spacing[5],
  },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  instruction: { ...typography.label, color: colors.surface },

  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.surface },

  primary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  primaryLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  secondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  secondaryLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.surface },
  link: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  linkLabel: { ...typography.bodyStrong, color: colors.surface },
});
