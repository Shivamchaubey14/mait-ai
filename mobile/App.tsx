/**
 * Application shell.
 *
 * Wires the providers every screen depends on, holds on the splash until the design-system
 * fonts are ready, then hands off to the navigator, which decides between login and the
 * capture flow based on whether there is a session.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { Quicksand_600SemiBold, Quicksand_700Bold, useFonts } from '@expo-google-fonts/quicksand';
import { NunitoSans_400Regular, NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans';

import '@/i18n';
import SplashScreen from '@/features/auth/SplashScreen';
import RootNavigator from '@/navigation';
import { store } from '@/store';
import { colors } from '@theme/tokens';

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

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.primary} />
        {/* The splash renders in the system font for the moment before the real ones
            arrive. That is deliberate — a blank green field would look like a hang, and the
            brand mark is a card of type either way. */}
        {fontsLoaded ? <RootNavigator /> : <SplashScreen />}
      </SafeAreaProvider>
    </Provider>
  );
}
