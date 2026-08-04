/**
 * Application shell (SRS §12 Phase 1, Day 3).
 *
 * Wires the providers every screen depends on. Navigation trees and screens are added per
 * feature from Phase 2 onward — see docs/ROADMAP.md.
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Provider } from 'react-redux';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import '@/i18n';
import { store } from '@/store';
import { colors, radius, spacing, typography } from '@/theme/tokens';

function Placeholder(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mait AI</Text>
      <Text style={styles.subtitle}>{t('common.loading')}</Text>
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
          <Placeholder />
        </NavigationContainer>
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing[5],
  },
  title: {
    ...typography.display,
    color: colors.primaryDark,
    marginBottom: spacing[2],
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
});
