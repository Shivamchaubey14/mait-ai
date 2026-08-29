/**
 * Step 6 — the proof photo, and where it came from (M9).
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
 *
 * And the pin comes first. Nothing that can produce a photograph exists on this screen until
 * the handset has a position — the viewfinder is not mounted, so there is no shutter to press
 * early and no chosen photo to fall back on a fix that has not arrived. The tests below check
 * the camera's *absence*, which is the only way to check a rule rather than a hint.
 */

import React from 'react';
import { Linking } from 'react-native';
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

const mockAskLocation = jest.fn();
const mockGetPosition = jest.fn();
const mockServicesEnabled = jest.fn();

jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockAskLocation(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetPosition(...args),
  hasServicesEnabledAsync: (...args: unknown[]) => mockServicesEnabled(...args),
  Accuracy: { Balanced: 3 },
}));

/** The yard, as the handset sees it: a fix a few metres out, in Uttar Pradesh. */
const FIX = { coords: { latitude: 26.85, longitude: 80.94, accuracy: 8 } };

function render(props: Partial<React.ComponentProps<typeof CapturePhotoScreen>> = {}) {
  const onCaptured = jest.fn();
  const view = renderWithStore(
    <CapturePhotoScreen onCaptured={onCaptured} onBack={jest.fn()} {...props} />,
  );
  return Object.assign(onCaptured, { view });
}

// At file scope rather than inside one describe: every group below starts from the same
// handset — camera allowed, location allowed and switched on, a fix a few metres out — and
// changes only the one thing it is about.
beforeEach(() => {
  mockRequestLibrary.mockResolvedValue({ granted: true });
  mockTakePicture.mockResolvedValue({ uri: 'file:///shot.jpg' });
  mockAskLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
  mockServicesEnabled.mockResolvedValue(true);
  mockGetPosition.mockResolvedValue(FIX);
});

afterEach(() => jest.clearAllMocks());

/** The photo the screen hands upward, after the review step is confirmed. */
async function confirm(onCaptured: jest.Mock): Promise<CapturedPhoto> {
  fireEvent.press(await screen.findByTestId('photo-continue'));
  return onCaptured.mock.calls[0][0] as CapturedPhoto;
}

describe('CapturePhotoScreen', () => {
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

describe('the pin comes before the camera', () => {
  /**
   * A proof photo with no coordinates cannot be tied to a village, which is most of what makes
   * it proof. The screen used to open the viewfinder immediately and look for a fix alongside
   * it — so the fastest Mait, the one who framed the animal and pressed the shutter straight
   * away, was the one most likely to produce a record with no pin on it.
   */
  it('does not mount the camera while the fix is still being looked for', async () => {
    // A look-up that never answers. The camera must not appear behind it.
    mockGetPosition.mockReturnValue(new Promise(() => undefined));
    render();

    await screen.findByTestId('pin-searching');
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByTestId('photo-shutter')).toBeNull();
    expect(screen.queryByTestId('photo-gallery')).toBeNull();
  });

  it('opens it as soon as there is one', async () => {
    render();

    await screen.findByTestId('photo-shutter');
    expect(screen.getByTestId('camera')).toBeTruthy();
  });

  it('shows the coordinates it is about to stamp, rather than hedging', async () => {
    render();

    await screen.findByText('26.8500, 80.9400');
  });

  it('keeps the camera shut when location was refused, and offers to ask again', async () => {
    mockAskLocation.mockResolvedValue({ status: 'denied', canAskAgain: true });
    render();

    await screen.findByText(/has not allowed location/);
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(mockGetPosition).not.toHaveBeenCalled();

    // "Look again" is the whole remedy: it re-runs the request, and the dialog comes back.
    mockAskLocation.mockResolvedValue({ status: 'granted', canAskAgain: true });
    fireEvent.press(screen.getByTestId('pin-retry'));

    await screen.findByTestId('photo-shutter');
  });

  it('sends them to Settings when the dialog will not come back', async () => {
    // Refused for good. Offering "allow location" here is a button that visibly does nothing,
    // and a Mait concludes the app is broken rather than that the setting is.
    mockAskLocation.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    render();

    fireEvent.press(await screen.findByTestId('pin-retry'));

    expect(openSettings).toHaveBeenCalled();
    expect(screen.queryByTestId('camera')).toBeNull();
    openSettings.mockRestore();
  });

  it('says so when location is switched off for the whole handset', async () => {
    // Its own answer and its own remedy. Asking for a position here would simply throw, and
    // "try again" is not the advice.
    mockServicesEnabled.mockResolvedValue(false);
    render();

    await screen.findByText(/Location is switched off/);
    expect(mockGetPosition).not.toHaveBeenCalled();
    expect(screen.queryByTestId('camera')).toBeNull();
  });

  it('offers a way forward when no fix comes back at all', async () => {
    mockGetPosition.mockRejectedValue(new Error('no fix'));
    render();

    await screen.findByText(/No position yet/);
    expect(screen.queryByTestId('camera')).toBeNull();

    mockGetPosition.mockResolvedValue(FIX);
    fireEvent.press(screen.getByTestId('pin-retry'));

    await screen.findByTestId('photo-shutter');
  });

  it('carries on where the handset cannot say whether location is switched on', async () => {
    // `hasServicesEnabledAsync` is a native module call, and an unreadable setting is not a
    // reason to refuse a Mait their camera — it is a reason to go and ask for a position.
    mockServicesEnabled.mockResolvedValue(undefined);
    render();

    await screen.findByTestId('photo-shutter');
  });
});

describe('the wait after Continue', () => {
  /**
   * Step 6 hands the photo up and the flow sends it, which on one bar of signal takes long
   * enough that a greyed-out button is indistinguishable from an app that has stopped. So the
   * button says what it is waiting on, and how far it has got where that can be counted.
   */
  async function reviewing(props: Partial<React.ComponentProps<typeof CapturePhotoScreen>>) {
    const onCaptured = render(props);
    fireEvent.press(await screen.findByTestId('photo-shutter'));
    await screen.findByTestId('photo-continue');
    return onCaptured;
  }

  it('shows nothing extra while the button is simply waiting to be pressed', async () => {
    await reviewing({});

    expect(screen.queryByTestId('photo-continue-progress')).toBeNull();
  });

  it('says the photo is going, and how much of it has gone', async () => {
    await reviewing({ busy: true, progress: { stage: 'uploading', fraction: 0.4 } });

    await screen.findByTestId('photo-continue-progress');
    await screen.findByText('Sending the photo…');
    // A real figure, so it is drawn as one. The bar's own width is the assertion that the
    // number reached the screen rather than being rounded away in the label.
    expect(screen.getByTestId('photo-continue-progress-fill').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '40%' })]),
    );
  });

  it('counts the backlog going out behind it', async () => {
    await reviewing({ busy: true, progress: { stage: 'catchingUp', done: 2, total: 3 } });

    await screen.findByText('Catching up — 2 of 3…');
  });

  it('says it is being kept for later when there is no signal', async () => {
    await reviewing({ busy: true, progress: { stage: 'queueing' } });

    await screen.findByText('Saving it to send later…');
    // Nothing is being counted, so nothing pretends to be: no filled bar at all.
    expect(screen.queryByTestId('photo-continue-progress-fill')).toBeNull();
  });

  it('draws no bar for a backlog of none', async () => {
    // The drain reports "0 of 0" when nothing was waiting. A bar that announced a queue of
    // none would be the app talking about itself.
    await reviewing({ busy: true, progress: { stage: 'catchingUp', done: 0, total: 0 } });

    await screen.findByText('Sending the photo…');
  });
});
