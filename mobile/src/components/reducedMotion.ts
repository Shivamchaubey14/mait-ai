/**
 * Whether the handset has been told to keep still.
 *
 * One copy, because two things now animate on a Mait's behalf — the route transition card and
 * the pull-to-refresh dots — and a setting that one of them honours and the other does not is
 * worse than neither honouring it.
 *
 * Read once and then watched: it is a setting somebody can change while the app is open, and
 * an animation that keeps playing after it was turned off is the one thing more annoying than
 * the animation itself.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    /**
     * Wrapped in `Promise.resolve` rather than chained directly.
     *
     * `isReduceMotionEnabled` is a native module call. Where the native side is absent — an
     * unsupported platform, and every test in this suite — it returns `undefined` rather than
     * a promise, and `.then` on that throws during render of whatever screen happened to
     * mount it. Optional-chaining the *call* does not help: the call succeeds and hands back
     * nothing.
     */
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then(value => {
        if (alive) {
          setReduced(!!value);
        }
      })
      // An unreadable setting is not a reason to fail; it is a reason to animate.
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value =>
      setReduced(!!value),
    );

    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
