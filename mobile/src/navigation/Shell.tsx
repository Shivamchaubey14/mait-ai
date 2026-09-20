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
 *
 * There are three navigators now — a Mait's, a store keeper's and a zonal manager's — and all
 * three are siblings for the same reason. One sign-in screen leads to whichever the account
 * is for; none of them is a mode of another.
 */

import React from 'react';

import LoginScreen from '@/features/auth/LoginScreen';
import SplashScreen from '@/features/auth/SplashScreen';
import RootNavigator from '@/navigation';
import StoreNavigator from '@/navigation/store';
import ZonalNavigator from '@/navigation/zonal';
import { useAppSelector } from '@/store';

export default function Shell({ fontsLoaded }: { fontsLoaded: boolean }): React.JSX.Element {
  const restored = useAppSelector(state => state.auth.restored);
  const signedIn = useAppSelector(state => !!state.auth.accessToken);
  // A store keeper signs in on the same screen and gets a different app: the queue at their
  // counter rather than a round of villages. Siblings, like login and the Mait's navigator,
  // so nothing of one is ever mounted under the other.
  const keeper = useAppSelector(state => state.auth.user?.role === 'store');
  // And a zonal manager gets a third: the decisions waiting on them, and the zone behind
  // those. An office account with a zone is what a zonal manager *is* — there is no role for
  // it, deliberately (see the server's `User.is_zonal_manager`) — and sign-in admits no other
  // kind of admin to a handset, so reading it off the session here is reading the same rule.
  const manager = useAppSelector(
    state => state.auth.user?.role === 'admin' && (state.auth.user?.zones?.length ?? 0) > 0,
  );

  if (fontsLoaded && restored) {
    if (!signedIn) {
      return <LoginScreen />;
    }
    if (keeper) {
      return <StoreNavigator />;
    }
    return manager ? <ZonalNavigator /> : <RootNavigator />;
  }

  // Two things are being waited on, so the bar can report which of them have landed rather
  // than sitting at a made-up fraction. It starts at a fifth so there is something to see on
  // the first frame — an empty track reads as a bar that is not working.
  const done = (fontsLoaded ? 1 : 0) + (restored ? 1 : 0);
  return <SplashScreen progress={0.2 + done * 0.4} />;
}
