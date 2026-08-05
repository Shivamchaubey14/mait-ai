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
import {
  Lexend_400Regular,
  Lexend_600SemiBold,
  Lexend_700Bold,
  useFonts as useLexend,
} from '@expo-google-fonts/lexend';
import {
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
} from '@expo-google-fonts/quicksand';

import '@/i18n';
import RootNavigator from '@/navigation';
import { store } from '@/store';
import { colors } from '@theme/tokens';

export default function App(): React.JSX.Element {
  // Lexend for headings, Quicksand for body (SRS §10.1). Rendering before they load would
  // show the system font and then reflow — visible, and worse on a slow device.
  const [fontsLoaded] = useLexend({
    Lexend_400Regular,
    Lexend_600SemiBold,
    Lexend_700Bold,
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
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
        <StatusBar style="light" backgroundColor={colors.primaryDark} />
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
    backgroundColor: colors.primaryDark,
  },
});
