/**
 * The field a Mait just tapped has to end up above the keyboard (SRS §7 Usability).
 *
 * The footer already rode up on its own — it is pinned to the bottom of a container that
 * shrinks when the keyboard opens. The body did not, so on a short handset the button was
 * visible and the box being typed into was behind the keyboard. On the step that asks for a
 * farmer's authorisation code that is close to unusable: a Mait typing a code they cannot see
 * cannot tell a mistyped digit from a wrong one, and the screen allows three attempts.
 *
 * These tests drive the real screens and assert on the scroll that results, because the bug
 * was never in any one field — it was in nobody owning the question of where the body should
 * be once the viewport had shrunk.
 */

import React from 'react';
import { Dimensions, Keyboard, StyleSheet } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import AddAnimalSheet from '../AddAnimalSheet';
import ConfirmFarmerScreen from '../ConfirmFarmerScreen';
import { jsonResponse, renderWithStore } from '@/test-utils';

/** Where a field is reported to sit inside the scrolling content. */
const FIELD_TOP = 420;

const mockScrollTo = jest.fn();

/**
 * A ScrollView that reports a content node and records what it was asked to scroll to.
 *
 * The real one measures nothing under Jest — there is no layout engine — so the assertion is
 * that the body was told to move to the field's offset, which is the decision the code makes.
 */
jest.mock('react-native/Libraries/Components/ScrollView/ScrollView', () => {
  const ReactActual = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');

  const Mock = ReactActual.forwardRef(
    (
      {
        children,
        innerViewRef,
        ...props
      }: {
        children?: React.ReactNode;
        testID?: string;
        // The real ScrollView hands its content view out through this. `measureLayout` needs
        // a ref to a native component, so the reveal cannot work without it — which is the
        // whole point of the prop and worth reproducing here rather than stubbing past.
        innerViewRef?: React.RefObject<unknown>;
      },
      ref: React.Ref<unknown>,
    ) => {
      ReactActual.useImperativeHandle(ref, () => ({
        getInnerViewNode: () => 'inner-node',
        scrollTo: mockScrollTo,
        scrollToEnd: jest.fn(),
      }));
      // Tagged so a test can ask what the scroll was given and what sits inside it — the real
      // component's type is gone once the module is mocked. The children hang off an inner
      // View carrying `innerViewRef`, exactly as the real one arranges them.
      return ReactActual.createElement(
        View,
        { ...props, testID: props.testID ?? 'mock-scroll' },
        ReactActual.createElement(View, { ref: innerViewRef }, children),
      );
    },
  );

  // Both shapes: this RN reaches the module through `.default`, and the bare export is what
  // anything still requiring it the old way would pick up.
  Mock.__esModule = true;
  Mock.default = Mock;
  return Mock;
});

/**
 * Every keyboard listener the components registered, by event name.
 *
 * All of them, not the last one: a screen with a sheet over it has two things watching the
 * keyboard — the body that scrolls and the sheet that rises — and keeping only the most
 * recent registration meant firing the event moved one of them and quietly ignored the other.
 * The real `Keyboard` notifies every subscriber, so the mock does too.
 */
const listeners = new Map<string, ((event: unknown) => void)[]>();

function captureKeyboardListeners() {
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    handler: (payload: unknown) => void,
  ) => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    return { remove: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
}

/** Raise the keyboard the way the OS does, so the reveal's second pass runs. */
/**
 * Raise the keyboard the way the platform would.
 *
 * Both spellings, because the components listen for `keyboardWillShow` on iOS and
 * `keyboardDidShow` on Android — and under Jest the platform is iOS, so a helper firing only
 * the Android event raised nothing at all. Every test here still passed, because the reveal
 * also fires on focus; what went untested was the part that reads how much of the screen the
 * keyboard actually covers.
 *
 * The top edge is measured off the window the components measure against, rather than a
 * hardcoded 800: a keyboard reported below the bottom of the window covers nothing, which is
 * exactly what anything reading the overlap correctly concludes.
 */
function raiseKeyboard(height = 300) {
  const screenY = Dimensions.get('window').height - height;
  act(() => {
    ['keyboardWillShow', 'keyboardDidShow'].forEach(event =>
      listeners
        .get(event)
        ?.forEach(handler =>
          handler({ endCoordinates: { screenY, height, width: 400, screenX: 0 } }),
        ),
    );
  });
}

function dropKeyboard() {
  act(() => {
    ['keyboardWillHide', 'keyboardDidHide'].forEach(event =>
      listeners.get(event)?.forEach(handler => handler({})),
    );
  });
}

const MEMBER = {
  member_code: 'MEM00000412',
  member_name: 'Kavita Devi',
  father_husband_name: 'Ram',
  mobile_no: '9876543210',
  mpp_name: 'Baroli',
  mpp_code: '001303',
  can_receive_otp: true,
  animals: [],
};

function sheet() {
  return renderWithStore(
    <AddAnimalSheet
      visible
      owner={{ name: 'Kavita Devi' }}
      initialType="COW"
      saving={false}
      fieldErrors={{}}
      refusal={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
    />,
  );
}

describe('the sheet arrives and leaves', () => {
  // Borrowed from milkkart-mobile, which had this right: a sheet that simply appears reads as
  // the screen having been replaced rather than covered, and the Mait loses track of what they
  // were doing behind it — which is the whole reason a sheet was chosen over a screen.
  it('stays mounted through its exit, then renders nothing', async () => {
    const { rerender } = renderWithStore(
      <AddAnimalSheet
        visible
        owner={{ name: 'Kavita Devi' }}
        initialType="COW"
        saving={false}
        fieldErrors={{}}
        refusal={null}
        onSave={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId('add-animal-sheet')).toBeTruthy();

    rerender(
      <AddAnimalSheet
        visible={false}
        owner={{ name: 'Kavita Devi' }}
        initialType="COW"
        saving={false}
        fieldErrors={{}}
        refusal={null}
        onSave={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // Still there for the moment the exit is playing — torn out instantly it would vanish
    // rather than leave.
    expect(screen.queryByTestId('add-animal-sheet')).not.toBeNull();
    // A generous window on purpose. The exit is a 220ms timer, but the whole suite runs in
    // parallel and a starved runner has taken seconds to get back to it — what is asserted is
    // that the sheet goes, not how fast. It still fails outright if it never unmounts.
    await waitFor(() => expect(screen.queryByTestId('add-animal-sheet')).toBeNull(), {
      timeout: 15000,
    });
  });
});

describe('a focused field is brought above the keyboard', () => {
  beforeEach(() => {
    listeners.clear();
    mockScrollTo.mockClear();
    captureKeyboardListeners();

    // Measuring against the scroll's content is native; report a fixed offset so the reveal
    // has something to act on.
    jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        require('react-native').View.prototype as any,
        'measureLayout',
      )
      .mockImplementation(((_node: unknown, onSuccess: (left: number, top: number) => void) => {
        onSuccess(0, FIELD_TOP);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);

    global.fetch = jest.fn(async (input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/farmers/otp/send/')) {
        return jsonResponse({ mobile_no: '••••• 43210', expires_in_seconds: 300 });
      }
      if (url.includes('/config/breeds/')) {
        return jsonResponse([]);
      }
      return jsonResponse(MEMBER);
    }) as jest.Mock;
  });

  afterEach(() => jest.restoreAllMocks());

  it('lifts the code sheet clear of the keyboard on "Is this her?"', async () => {
    // The step this test was written for. The code box used to sit in the page under a
    // deliberately large identity card, which is exactly what put it behind the keyboard; it
    // is in a sheet now, and a sheet is anchored to the edge the keyboard comes up over — so
    // the whole sheet has to move rather than the body scrolling under it.
    renderWithStore(
      <ConfirmFarmerScreen
        farmer={{ kind: 'member', memberCode: MEMBER.member_code }}
        onConfirm={jest.fn()}
        onSearchAgain={jest.fn()}
      />,
    );

    fireEvent.press(await screen.findByTestId('farmer-verify'));
    fireEvent.press(await screen.findByTestId('farmer-send-code'));
    const field = await screen.findByTestId('farmer-otp-input');
    fireEvent(field, 'focus');
    raiseKeyboard();

    // The sheet carries the keyboard's own height as a margin, so the field and the button
    // under it are both above it. Nothing here relies on a scroll: the sheet is short enough
    // that moving it is the whole answer.
    const surface = screen.getByTestId('farmer-otp-surface');
    await waitFor(() =>
      expect(StyleSheet.flatten(surface.props.style)).toEqual(
        expect.objectContaining({ marginBottom: expect.any(Number) }),
      ),
    );
  });

  it('scrolls a field in the bottom sheet too, not only the flow screens', async () => {
    // The sheet had a hand-written `scrollToEnd` on the one field somebody noticed. It now
    // goes through the same machinery, so a field added later is covered without anyone
    // remembering to cover it.
    sheet();

    fireEvent(await screen.findByTestId('animal-ear-tag'), 'focus');
    raiseKeyboard();

    await waitFor(() => expect(mockScrollTo).toHaveBeenCalled());
  });

  it('leaves the sheet where it is, and keeps Save clear of the keypad', async () => {
    // The report: typing a tag number put the Save button up above the keypad with the field
    // being typed into nowhere in sight. Two causes, both fixed here. The sheet grew by the
    // keyboard's height on top of Android's own `adjustResize`, so it was shoved up by two
    // keyboards; and the button was pinned to the sheet's floor, so it rode up with it.
    //
    // `milkkart-mobile`'s sheets do it the other way round and are the reference: the sheet
    // stays put, the keyboard becomes scroll padding, and the action sits inside the form.
    sheet();

    const sheetPadding = () =>
      StyleSheet.flatten(screen.getByTestId('add-animal-sheet').props.style).paddingBottom;
    const resting = sheetPadding();

    fireEvent(await screen.findByTestId('animal-ear-tag'), 'focus');
    raiseKeyboard(300);
    await waitFor(() => expect(mockScrollTo).toHaveBeenCalled());

    // The sheet is exactly where it was. It used to grow by the keyboard's height on top of
    // Android's own `adjustResize`, which counts it twice and shoves the whole thing up by
    // two keyboards.
    expect(sheetPadding()).toBe(resting);

    // And Save is inside the scrolling form, so it is reached by finishing the form rather
    // than by hovering over the keypad.
    const scroll = screen.getByTestId('mock-scroll');
    let insideScroll = false;
    for (let node = screen.getByTestId('animal-save').parent; node; node = node.parent) {
      if (node === scroll) {
        insideScroll = true;
        break;
      }
    }
    expect(insideScroll).toBe(true);
  });

  it('stops chasing a field once the keyboard is down', async () => {
    sheet();

    fireEvent(await screen.findByTestId('animal-ear-tag'), 'focus');
    raiseKeyboard();
    await waitFor(() => expect(mockScrollTo).toHaveBeenCalled());

    dropKeyboard();
    mockScrollTo.mockClear();

    // A second keyboard, with nothing focused, must not yank the body back to whichever field
    // was last tapped.
    raiseKeyboard();
    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});
