/**
 * Application shell.
 *
 * Wires the providers every screen depends on and hands off to the navigator, which decides
 * between the login screen and the capture flow based on whether there is a session.
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';

import '@/i18n';
import RootNavigator from '@/navigation';
import { store } from '@/store';
import { colors } from '@theme/tokens';

export default function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
        <RootNavigator />
      </SafeAreaProvider>
    </Provider>
  );
}
