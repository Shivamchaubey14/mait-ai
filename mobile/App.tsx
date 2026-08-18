/**
 * Application shell.
 *
 * Wires the providers every screen depends on, holds on the splash until the design-system
 * fonts are ready, then hands off to the navigator, which decides between login and the
 * capture flow based on whether there is a session.
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { Quicksand_600SemiBold, Quicksand_700Bold, useFonts } from '@expo-google-fonts/quicksand';
import { NunitoSans_400Regular, NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans';

import '@/i18n';
import { maitaiApi } from '@api/endpoints';
import { profileRefreshed, sessionRestored } from '@/features/auth/authSlice';
import { loadSession } from '@/features/auth/session';
import SplashScreen from '@/features/auth/SplashScreen';
import RootNavigator from '@/navigation';
import { store, useAppSelector } from '@/store';
import { colors } from '@theme/tokens';

/**
 * Holds the splash until both the fonts and the stored session are ready.
 *
 * Rendering the navigator first would show the login screen for a frame on every cold start,
 * which a Mait reads as having been signed out — the exact thing persistence exists to stop.
 */
function Shell({ fontsLoaded }: { fontsLoaded: boolean }): React.JSX.Element {
  const restored = useAppSelector(state => state.auth.restored);
  if (fontsLoaded && restored) {
    return <RootNavigator />;
  }

  // Two things are being waited on, so the bar can report which of them have landed rather
  // than sitting at a made-up fraction. It starts at a fifth so there is something to see on
  // the first frame — an empty track reads as a bar that is not working.
  const done = (fontsLoaded ? 1 : 0) + (restored ? 1 : 0);
  return <SplashScreen progress={0.2 + done * 0.4} />;
}

export default function App(): React.JSX.Element {
  // Quicksand for headings, Nunito Sans for body (docs/SCREEN_INVENTORY.md). Rendering
  // before they load would show the system font and then reflow — visible, and worse on the
  // low-end hardware this runs on.
  const [fontsLoaded] = useFonts({
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
  });

  // Read once at launch. A Mait stays signed in until they sign out — the access token
  // expires in fifteen minutes and refreshes itself, so the session lasts as long as the
  // refresh token does rather than as long as the app happens to stay in memory.
  useEffect(() => {
    loadSession().then(async session => {
      store.dispatch(
        sessionRestored(
          session
            ? {
                access: session.accessToken,
                refresh: session.refreshToken,
                user: session.user,
                assignedMppCodes: session.assignedMppCodes,
              }
            : null,
        ),
      );

      if (!session) {
        return;
      }

      /**
       * Then ask the server who this is.
       *
       * What comes off disk is whatever was written the day the Mait signed in, and the
       * refresh token keeps that alive for weeks — so a detail the app learned to store later
       * is absent on every older session, and reopening the app never brings it back. The
       * Sahayak code arrived exactly that way. Reassignment has the same shape: a Mait moved
       * to different MPPs goes on being shown the old ones until they happen to sign out.
       *
       * Deliberately not awaited before the app renders, and deliberately swallowed on
       * failure. The stored session is enough to work with — this app is built to run in a
       * village with no signal, and a launch that hung on a network call, or signed a Mait
       * out because one failed, would be a far worse bug than a stale name.
       */
      try {
        const me = await store
          .dispatch(maitaiApi.endpoints.getCurrentUser.initiate(session.accessToken))
          .unwrap();

        store.dispatch(
          profileRefreshed({
            user: {
              id: me.id,
              fullName: me.full_name,
              role: me.role,
              mobileNo: me.mobile_no,
              maitId: me.mait_id,
              sahayakVendorCode: me.sahayak_vendor_code,
            },
            assignedMppCodes: me.assigned_mpp_codes,
          }),
        );
      } catch {
        // Offline, or the server is down. The session on disk still signs every request.
      }
    });
  }, []);

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.primary} />
        {/* The splash renders in the system font for the moment before the real ones
            arrive. That is deliberate — a blank Ink field would look like a hang, and the
            wordmark is type either way. */}
        <Shell fontsLoaded={fontsLoaded} />
      </SafeAreaProvider>
    </Provider>
  );
}
