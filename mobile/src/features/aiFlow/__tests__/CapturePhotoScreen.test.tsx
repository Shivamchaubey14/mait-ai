/**
 * Step 5 — the proof photo, and where it came from (M9).
 *
 * The camera is the way this step is meant to be answered and the gallery is the way out when
 * it cannot be. What matters is that the two never blur: a chosen photo has to travel marked
 * as chosen, or the record claims an insemination was witnessed when nobody witnessed
 * anything.
 *
 * The pin is the second half of the same problem. A photograph carrying its own coordinates is
 * pinned by those, because the handset may be in a different village by the time the record is
 * written up; one carrying none falls back to the handset, and the screen says so before the
 * Mait commits to it rather than leaving them to find out on the record.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import CapturePhotoScreen from '../CapturePhotoScreen';
import type { CapturedPhoto } from '../CapturePhotoScreen';
import { renderWithStore } from '@/test-utils';

const mockTakePicture = jest.fn();
const mockLaunchLibrary = jest.fn();
const mockRequestLibrary = jest.fn();

jest.mock('expo-camera', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    CameraView: ReactActual.forwardRef((props: object, ref: React.Ref<unknown>) => {
      ReactActual.useImperativeHandle(ref, () => ({
        takePictureAsync: (...args: unknown[]) => mockTakePicture(...args),
      }));
      return ReactActual.createElement(View, props);
    }),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestLibrary(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));

/** The yard, as the handset sees it: a fix a few metres out, in Uttar Pradesh. */
jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 26.85, longitude: 80.94, accuracy: 8 },
  }),
  Accuracy: { Balanced: 3 },
}));

function render() {
  const onCaptured = jest.fn();
  renderWithStore(<CapturePhotoScreen onCaptured={onCaptured} onBack={jest.fn()} />);
  return onCaptured;
}

/** The photo the screen hands upward, after the review step is confirmed. */
async function confirm(onCaptured: jest.Mock): Promise<CapturedPhoto> {
  fireEvent.press(await screen.findByTestId('photo-continue'));
  return onCaptured.mock.calls[0][0] as CapturedPhoto;
}

describe('CapturePhotoScreen', () => {
  beforeEach(() => {
    mockRequestLibrary.mockResolvedValue({ granted: true });
    mockTakePicture.mockResolvedValue({ uri: 'file:///shot.jpg' });
  });

  afterEach(() => jest.clearAllMocks());

  it('sends a photo taken here as taken here, pinned by the handset', async () => {
    const onCaptured = render();

    fireEvent.press(await screen.findByTestId('photo-shutter'));

    const photo = await waitFor(() => confirm(onCaptured));
    expect(photo.source).toBe('camera');
    expect(photo.gpsSource).toBe('device');
    expect(photo.gpsLat).toBeCloseTo(26.85);
  });

  it('takes the pin out of a chosen photograph rather than off the handset', async () => {
    // Written up later, from a photo taken in the village the animal is actually in. The
    // handset is somewhere else by now, and its own position would bill the wrong MPP.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///chosen.jpg',
          exif: {
            GPSLatitude: 26.7524,
            GPSLatitudeRef: 'N',
            GPSLongitude: 82.1408,
            GPSLongitudeRef: 'E',
          },
        },
      ],
    });
    const onCaptured = render();

    fireEvent.press(await screen.findByTestId('photo-gallery'));
    await screen.findByTestId('photo-from-gallery');

    const photo = await confirm(onCaptured);
    expect(photo.source).toBe('gallery');
    expect(photo.gpsSource).toBe('photo');
    expect(photo.gpsLat).toBeCloseTo(26.7524);
    expect(photo.gpsLng).toBeCloseTo(82.1408);
  });

  it('falls back to the handset when the photograph carries no pin, and says so', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///chosen.jpg', exif: { DateTimeOriginal: '2026:08:18 10:43:12' } }],
    });
    const onCaptured = render();

    fireEvent.press(await screen.findByTestId('photo-gallery'));

    // The warning is on the review screen, where "take it again" is one tap away — not on the
    // record, where it would be the first anybody heard of it.
    await screen.findByText(/not where the photo was taken/);

    const photo = await confirm(onCaptured);
    expect(photo.source).toBe('gallery');
    expect(photo.gpsSource).toBe('device');
    expect(photo.gpsLat).toBeCloseTo(26.85);
  });

  it("keeps the moment of recording, never the photograph's own date", async () => {
    // Backdating the event to whenever the file was made would move a day's work into a month
    // that has already been reported on.
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///old.jpg', exif: { DateTimeOriginal: '2020:01:01 08:00:00' } }],
    });
    const onCaptured = render();

    fireEvent.press(await screen.findByTestId('photo-gallery'));
    const photo = await waitFor(() => confirm(onCaptured));

    expect(new Date(photo.performedAt).getFullYear()).toBe(new Date().getFullYear());
  });

  it('does nothing at all when the picker is dismissed', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
    render();

    fireEvent.press(await screen.findByTestId('photo-gallery'));

    // Still on the viewfinder: a cancelled pick must not strand the Mait on a review screen
    // for a photo that does not exist.
    await waitFor(() => expect(screen.getByTestId('photo-shutter')).toBeTruthy());
    expect(screen.queryByTestId('photo-continue')).toBeNull();
  });

  it('says when the phone has not allowed access to photos', async () => {
    mockRequestLibrary.mockResolvedValue({ granted: false });
    render();

    fireEvent.press(await screen.findByTestId('photo-gallery'));

    await screen.findByText(/has not allowed access to photos/);
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });
});
