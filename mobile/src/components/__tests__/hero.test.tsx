/**
 * Hero title tests.
 *
 * The name in the Ink card is the one thing on Home that belongs to the Mait reading it. A
 * long one used to wrap, which both made the card taller on the handsets with the least room
 * and split a single person's name across two lines. What matters here is that it stays on
 * one line and that the size it lands on is still readable.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PageHero, { fitTitleSize } from '../hero';
// The brand mark inside the hero reads a label off i18n; without this it renders, but warns.
import '@/i18n';

// A fixed 390pt handset. Left to itself the test renderer reports a tablet-width window, on
// which every name fits at full size and the assertions below have nothing to measure.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

/** A 390pt handset, less the hero's 24pt gutters. */
const AVAILABLE = 390 - 48;

function renderHero(title: string) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <PageHero title={title} subtitle="MAIT 5500000054 · 3 MPPs" />
    </SafeAreaProvider>,
  );
}

describe('fitTitleSize', () => {
  it('leaves a short name at the full display size', () => {
    expect(fitTitleSize('ROHIT KUMAR', AVAILABLE)).toBe(26);
  });

  it('steps a long name down rather than wrapping it', () => {
    const long = fitTitleSize('SATYANARAYAN CHATURVEDI', AVAILABLE);
    expect(long).toBeLessThan(26);
    expect(long).toBeGreaterThanOrEqual(16);
  });

  it('never drops below the readable floor, however long the name', () => {
    expect(fitTitleSize('A'.repeat(80), AVAILABLE)).toBe(16);
  });

  it('is monotonic — a longer name is never set larger than a shorter one', () => {
    const sizes = ['RAM', 'RAM KUMAR', 'RAM KUMAR YADAV', 'RAM KUMAR YADAV CHAUDHARY'].map(name =>
      fitTitleSize(name, AVAILABLE),
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it('does not divide by zero on the empty name a session shows before it loads', () => {
    expect(fitTitleSize('', AVAILABLE)).toBe(26);
  });
});

describe('PageHero', () => {
  it('holds a long name to one line', () => {
    renderHero('SATYANARAYAN CHATURVEDI');
    const title = screen.getByText('SATYANARAYAN CHATURVEDI');
    expect(title.props.numberOfLines).toBe(1);
  });

  it('sets a long name smaller than a short one', () => {
    const sizeOf = (title: string): number => {
      renderHero(title);
      const style = screen.getByText(title).props.style;
      const flat = (Array.isArray(style) ? style : [style]).reduce(
        (acc, layer) => ({ ...acc, ...(layer ?? {}) }),
        {},
      );
      screen.unmount();
      return flat.fontSize;
    };

    expect(sizeOf('SATYANARAYAN CHATURVEDI')).toBeLessThan(sizeOf('ROHIT KUMAR'));
  });
});
