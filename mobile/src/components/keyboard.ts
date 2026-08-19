/**
 * How much of the window the keyboard is covering, in points.
 *
 * `KeyboardAvoidingView` is no use to a sheet: it pads a view inside the layout, and a sheet
 * is positioned over the top of one, so there is nothing for the padding to push. This
 * measures the overlap directly — the window's bottom edge minus where the keyboard starts —
 * which is the one number that is right under both of Android's soft-input modes and under
 * iOS.
 *
 * Read fresh on each event rather than captured once: the window is a different height in
 * landscape, and a different height again with the keyboard up on a resizing Android window.
 *
 * It lives here, in the shared components, rather than in the capture flow that first needed
 * it. Two things now depend on it — the flow's screens and the bottom sheet — and a second
 * copy would be the copy that stops being maintained.
 */

import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      event => {
        const windowHeight = Dimensions.get('window').height;
        setOverlap(Math.max(0, windowHeight - event.endCoordinates.screenY));
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setOverlap(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return overlap;
}
