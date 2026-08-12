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
    // Resolved through i18n rather than hardcoded, so rewording the copy is a copy change
    // and not a broken test.
    renderWithStore(<SplashScreen />);
    expect(screen.getByText('MAIT AI')).toBeTruthy();
    expect(screen.getByText(i18n.t('splash.tagline'))).toBeTruthy();
  });

  it('keeps the product name in English in Hindi', async () => {
    await i18n.changeLanguage('hi');
    renderWithStore(<SplashScreen />);

    expect(screen.getByText('MAIT AI')).toBeTruthy();
    // The surrounding copy does translate.
    expect(screen.getByText(i18n.t('splash.tagline'))).toBeTruthy();
    expect(i18n.t('splash.tagline')).not.toBe('Record an insemination in six steps');
  });

  it('shows a version line', () => {
    renderWithStore(<SplashScreen />);
    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeTruthy();
  });

  it('reports its progress to the accessibility layer', () => {
    // The bar is the only moving thing on the screen, so it is the only thing a screen
    // reader can say about how much longer this hold lasts.
    renderWithStore(<SplashScreen progress={0.5} />);
    expect(screen.getByRole('progressbar').props.accessibilityValue).toMatchObject({ now: 50 });
  });
});
