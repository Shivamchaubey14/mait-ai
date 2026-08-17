/**
 * How a sheet arrives and leaves.
 *
 * Borrowed from `milkkart-mobile`, which is the same product family and already had this
 * right: a spring up from below with the backdrop fading in behind it, and a shorter, flatter
 * timing on the way out. A sheet that simply appears reads as the screen having been replaced
 * rather than covered — a Mait loses track of what they were doing behind it, which is the
 * whole reason a sheet was chosen over a screen in the first place.
 *
 * The component stays mounted until the exit has finished. That is what the `mounted` flag is
 * for: rendered conditionally by its parent, a sheet is torn out of the tree the instant it is
 * closed and there is nothing left to animate. So the parent passes `visible` and the sheet
 * decides when it is actually gone.
 *
 * Both values drive `transform` and `opacity` only, so they run on the native driver and keep
 * moving while JavaScript is busy — which, on the screen that has just fired off a
 * registration, it is.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** Far enough below the fold that no handset shows the sheet at rest. */
const OFFSCREEN = 900;

/** How long the exit takes. The unmount is timed against this rather than hung off the
 *  animation's own callback: with `useNativeDriver` the callback is delivered by the native
 *  side, which does not exist under Jest and cannot be relied on to arrive at all. A sheet
 *  that never unmounts is a sheet still covering the screen, so the timing owns it. */
const EXIT_MS = 220;

export interface SheetMotion {
  /** False once the exit has played out — render nothing at all. */
  mounted: boolean;
  translateY: Animated.Value;
  backdropOpacity: Animated.Value;
}

export function useSheetMotion(visible: boolean): SheetMotion {
  const translateY = useRef(new Animated.Value(OFFSCREEN)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        // A spring rather than a timing: a sheet is a physical thing being pushed up, and the
        // small settle at the end is what makes it read as one. Damped hard enough not to
        // overshoot into a bounce, which on a form would look like a mistake.
        Animated.spring(translateY, {
          toValue: 0,
          damping: 20,
          stiffness: 160,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    // Leaving is quicker and has no spring. A sheet springing *away* draws the eye back to
    // something the Mait has already finished with.
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: OFFSCREEN, duration: EXIT_MS, useNativeDriver: true }),
    ]).start();

    // Cleared if the sheet is reopened before the exit finishes, so a sheet on its way back in
    // is never unmounted by the closing that preceded it.
    const gone = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(gone);
  }, [visible, translateY, backdropOpacity]);

  return { mounted, translateY, backdropOpacity };
}
