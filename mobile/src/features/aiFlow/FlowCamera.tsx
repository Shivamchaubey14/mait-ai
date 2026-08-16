/**
 * The capture flow's full-screen camera, for the pictures that are not evidence.
 *
 * Not the proof-photo screen. That one burns in a GPS pin and a timestamp because it is
 * evidence of an insemination at a place and a time. These are pictures taken so a record can
 * be recognised later — a cow the Mait must know again in six months, an identity card behind
 * a number that was typed. No pin, no clock, and no permission dance if it can be helped: the
 * Mait is standing in front of the subject with the farmer waiting.
 *
 * Camera only, no gallery picker, for the same reason as everywhere else in the flow: a photo
 * chosen from a roll is a photo of something, somewhere, once.
 *
 * One component for both jobs because they differ only in what is said and what is drawn over
 * the viewfinder. Two copies would drift, and the half that drifts is always the permission
 * gate — the part that is hardest to reach in testing and worst to get wrong in a yard.
 */

import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '@theme/tokens';

interface Props {
  /** The line over the viewfinder — what to point the camera at. */
  instruction: string;
  /** Why the camera is being asked for, on the permission gate. */
  permissionBody: string;
  /**
   * A framing guide drawn over the viewfinder.
   *
   * `card` outlines an Aadhaar-shaped rectangle. A card photographed freehand comes out
   * skewed, cropped or too far away to read, and the Mait cannot tell until somebody in an
   * office tries to use it — by which time she has gone home.
   */
  guide?: 'card';
  /** Prefixes every testID, so two cameras on one screen stay addressable. */
  testIDPrefix: string;
  onCaptured: (uri: string) => void;
  onCancel: () => void;
}

export default function FlowCamera({
  instruction,
  permissionBody,
  guide,
  testIDPrefix,
  onCaptured,
  onCancel,
}: Props): React.JSX.Element {
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
        // A card carries twelve digits that have to survive being read in an office, so it
        // gets more than the portrait does — and still not so much that it cannot leave a
        // handset on one bar of signal.
        quality: guide === 'card' ? 0.8 : 0.6,
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
        <Text style={styles.gateBody}>{permissionBody}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={requestPermission}
          style={styles.primary}
          testID={`${testIDPrefix}-allow`}
        >
          <Text style={styles.primaryLabel}>{t('aiFlow.allowCamera')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.link}
          testID={`${testIDPrefix}-skip`}
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
        {/* `contain` for a card: cropping to fill is how a corner with the number on it goes
            missing between the shot and the review. */}
        <Image
          source={{ uri: shot }}
          style={StyleSheet.absoluteFill}
          resizeMode={guide === 'card' ? 'contain' : 'cover'}
        />
        <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[5] }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShot(null)}
            style={styles.secondary}
            testID={`${testIDPrefix}-retake`}
          >
            <Text style={styles.secondaryLabel}>{t('aiFlow.retake')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onCaptured(shot)}
            style={styles.primary}
            testID={`${testIDPrefix}-use`}
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
        testID={`${testIDPrefix}-view`}
      />

      {guide === 'card' && (
        <View style={styles.guideLayer} pointerEvents="none">
          <View style={styles.cardGuide} />
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + spacing[3] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onCancel}
          style={styles.close}
          testID={`${testIDPrefix}-close`}
        >
          <Ionicons name="close" size={20} color={colors.surface} />
        </Pressable>
        <Text style={styles.instruction}>{instruction}</Text>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing[5] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('aiFlow.take')}
          onPress={take}
          disabled={taking}
          style={styles.shutter}
          testID={`${testIDPrefix}-shutter`}
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

  // An outline, not a mask. A darkened surround would hide whether the Mait's thumb is over
  // a corner of the card, which is the commonest way one of these comes out unusable.
  guideLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  cardGuide: {
    width: '86%',
    // 1.586:1, the ID-1 card the Aadhaar is printed on.
    aspectRatio: 1.586,
    borderWidth: 2,
    borderColor: colors.surface,
    borderRadius: radius.md,
    opacity: 0.85,
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
  instruction: { ...typography.label, color: colors.surface, flex: 1 },

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
