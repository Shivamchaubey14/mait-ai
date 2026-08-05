/**
 * Application shell.
 *
 * Wires the providers every screen depends on, waits for the design-system fonts, then
 * hands off to the navigator, which decides between login and the capture flow based on
 * whether there is a session.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { Quicksand_600SemiBold, Quicksand_700Bold, useFonts } from '@expo-google-fonts/quicksand';
import { NunitoSans_400Regular, NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans';

import '@/i18n';
import RootNavigator from '@/navigation';
import { store } from '@/store';
import { colors } from '@theme/tokens';

export default function App(): React.JSX.Element {
  // Quicksand for headings, Nunito Sans for body (docs/SCREEN_INVENTORY.md). Rendering
  // before they load would show the system font and then reflow — visible, and worse on a
  // slow device.
  const [fontsLoaded] = useFonts({
    Quicksand_600SemiBold,
    Quicksand_700Bold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.surface} />
      </View>
    );
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={colors.ink} />
        <RootNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
});
