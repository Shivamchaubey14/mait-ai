/**
 * The session gate: splash, then login or the app.
 *
 * Three states, and the order matters. Nothing renders until both the design-system fonts
 * and the stored session have landed — showing the navigator first flashes the login screen
 * for a frame on every cold start, which a Mait reads as having been signed out, and that is
 * the exact thing persistence exists to prevent.
 *
 * **Login and the navigator are siblings, never nested.** The navigator used to decide
 * between them itself, which meant signing out only changed what it returned: it stayed
 * mounted, holding every piece of state it had. Which tab is lit is one of those, so a Mait
 * who signed out from Profile and signed back in landed on Profile — somebody else's screen,
 * with nothing to say why.
 *
 * As siblings, signing out unmounts the navigator. A session gets a navigator; when the
 * session ends so does the navigator, and the next one starts on Home the way a first
 * sign-in does. That cannot rot the way a list of things-to-reset would — the twenty-sixth
 * piece of state somebody adds to the navigator is covered without them ever learning this
 * rule exists.
 */

import React from 'react';

import LoginScreen from '@/features/auth/LoginScreen';
import SplashScreen from '@/features/auth/SplashScreen';
import RootNavigator from '@/navigation';
import { useAppSelector } from '@/store';

export default function Shell({ fontsLoaded }: { fontsLoaded: boolean }): React.JSX.Element {
  const restored = useAppSelector(state => state.auth.restored);
  const signedIn = useAppSelector(state => !!state.auth.accessToken);

  if (fontsLoaded && restored) {
    return signedIn ? <RootNavigator /> : <LoginScreen />;
  }

  // Two things are being waited on, so the bar can report which of them have landed rather
  // than sitting at a made-up fraction. It starts at a fifth so there is something to see on
  // the first frame — an empty track reads as a bar that is not working.
  const done = (fontsLoaded ? 1 : 0) + (restored ? 1 : 0);
  return <SplashScreen progress={0.2 + done * 0.4} />;
}
