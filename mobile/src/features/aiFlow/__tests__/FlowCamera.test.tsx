/**
 * The capture flow's camera, and the one thing it does that is not obvious from the screen.
 *
 * A handset camera hands back its sensor's full resolution — 3072×4096, six megabytes — and
 * this app is used on one bar of signal in a village. Six megabytes is a minute of upload that
 * can fail at fifty seconds. So every photograph is scaled down before it leaves this screen,
 * and these are the cases that decide whether it survives being useful: a card has to stay
 * readable, a portrait only has to be recognisable, and a failed resize must never cost the
 * Mait the photograph they just took with the farmer standing there.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import FlowCamera from '../FlowCamera';
import { renderWithStore } from '@/test-utils';

const mockTakePicture = jest.fn();

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
    // Granted, so every test lands on the viewfinder rather than the permission gate.
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

/** The mocked manipulator from jest.setup, reachable so each test can shape it. */
const manipulator = jest.requireMock('expo-image-manipulator') as {
  ImageManipulator: { manipulate: jest.Mock };
};

function lastContext() {
  return manipulator.ImageManipulator.manipulate.mock.results.at(-1)?.value;
}

function render(props: Partial<React.ComponentProps<typeof FlowCamera>> = {}) {
  return renderWithStore(
    <FlowCamera
      instruction="Frame it"
      permissionBody="Why the camera is needed"
      testIDPrefix="cam"
      onCaptured={jest.fn()}
      onCancel={jest.fn()}
      {...props}
    />,
  );
}

describe('FlowCamera', () => {
  beforeEach(() => {
    mockTakePicture.mockResolvedValue({
      uri: 'file:///original.jpg',
      width: 3072,
      height: 4096,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('asks the camera for full quality, because the resize is what shrinks the file', async () => {
    // A low `quality` only lowers JPEG quality — the frame is still the sensor's full size, so
    // it saves a fraction of the bytes and none of the pixels.
    render();
    fireEvent.press(screen.getByTestId('cam-shutter'));

    await waitFor(() => expect(mockTakePicture).toHaveBeenCalled());
    expect(mockTakePicture.mock.calls[0][0]).toMatchObject({ quality: 1 });
  });

  it('scales a portrait photograph by its height, not its width', async () => {
    // The long edge of a 3072×4096 frame is the height. Constraining the width instead would
    // leave a picture taller than it started and barely smaller.
    render();
    fireEvent.press(screen.getByTestId('cam-shutter'));

    await waitFor(() => expect(lastContext()?.resize).toHaveBeenCalled());
    expect(lastContext().resize).toHaveBeenCalledWith({ height: 1200 });
  });

  it('gives a card a longer edge than a portrait, so twelve digits stay readable', async () => {
    render({ guide: 'card' });
    fireEvent.press(screen.getByTestId('cam-shutter'));

    await waitFor(() => expect(lastContext()?.resize).toHaveBeenCalled());
    expect(lastContext().resize).toHaveBeenCalledWith({ height: 1600 });
  });

  it('scales a landscape card by its width', async () => {
    // A card held the way the guide frame asks for comes back landscape.
    mockTakePicture.mockResolvedValue({
      uri: 'file:///card.jpg',
      width: 4096,
      height: 2580,
    });
    render({ guide: 'card' });
    fireEvent.press(screen.getByTestId('cam-shutter'));

    await waitFor(() => expect(lastContext()?.resize).toHaveBeenCalled());
    expect(lastContext().resize).toHaveBeenCalledWith({ width: 1600 });
  });

  it('does not upscale a photograph that is already small enough', async () => {
    mockTakePicture.mockResolvedValue({ uri: 'file:///small.jpg', width: 900, height: 600 });
    render({ guide: 'card' });
    fireEvent.press(screen.getByTestId('cam-shutter'));

    // Still re-encoded — the compression is worth having — but never stretched.
    await waitFor(() => expect(manipulator.ImageManipulator.manipulate).toHaveBeenCalled());
    expect(lastContext().resize).not.toHaveBeenCalled();
  });

  it('keeps the original when the resize fails, rather than losing the photograph', async () => {
    // An odd codec, a device out of scratch space. A large upload is a worse outcome than a
    // small one; it is a far better one than sending a Mait back to photograph a card again.
    manipulator.ImageManipulator.manipulate.mockImplementationOnce(() => {
      throw new Error('no scratch space');
    });

    const onCaptured = jest.fn();
    render({ onCaptured });
    fireEvent.press(screen.getByTestId('cam-shutter'));

    // The review screen is reached, so the shot survived; using it hands back the original.
    fireEvent.press(await screen.findByTestId('cam-use'));
    expect(onCaptured).toHaveBeenCalledWith('file:///original.jpg');
  });

  it('hands back the resized file, not the one the camera wrote', async () => {
    const onCaptured = jest.fn();
    render({ onCaptured });
    fireEvent.press(screen.getByTestId('cam-shutter'));

    fireEvent.press(await screen.findByTestId('cam-use'));
    expect(onCaptured).toHaveBeenCalledWith('file:///resized.jpg');
  });
});
