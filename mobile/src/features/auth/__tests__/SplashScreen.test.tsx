/**
 * Splash and brand tests.
 *
 * The one that matters is the brand mark staying in English. Everything else on the screen
 * translates; a product name that changes script between sessions stops being recognisable,
 * which is the single thing a mark has to do.
 */

import React from 'react';
import { screen } from '@testing-library/react-native';

import SplashScreen from '../SplashScreen';
import i18n from '@/i18n';
import { renderWithStore } from '@/test-utils';

describe('SplashScreen', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the brand mark and its tagline', () => {
    renderWithStore(<SplashScreen />);
    expect(screen.getByText('MAIT AI')).toBeTruthy();
    expect(screen.getByText('FIELD CAPTURE')).toBeTruthy();
  });

  it('states the three capabilities before sign-in', () => {
    // They answer the question a Mait actually has standing in a field with one bar of
    // signal: will this work out here.
    //
    // Resolved through i18n rather than hardcoded, so rewording the copy is a copy change
    // and not a broken test.
    renderWithStore(<SplashScreen />);
    expect(screen.getByText(i18n.t('capability.worksOffline'))).toBeTruthy();
    expect(screen.getByText(i18n.t('capability.cameraCapture'))).toBeTruthy();
    expect(screen.getByText(i18n.t('capability.strawStock'))).toBeTruthy();
  });

  it('keeps the product name in English in Hindi', async () => {
    await i18n.changeLanguage('hi');
    renderWithStore(<SplashScreen />);

    expect(screen.getByText('MAIT AI')).toBeTruthy();
    expect(screen.getByText('FIELD CAPTURE')).toBeTruthy();
    // The surrounding copy does translate.
    expect(screen.getByText(i18n.t('capability.worksOffline'))).toBeTruthy();
    expect(i18n.t('capability.worksOffline')).not.toBe('Works offline');
  });

  it('shows a version line', () => {
    renderWithStore(<SplashScreen />);
    expect(screen.getByText(/Shwetdhara/)).toBeTruthy();
  });
});
