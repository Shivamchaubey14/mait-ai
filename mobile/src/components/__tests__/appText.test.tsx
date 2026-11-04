/**
 * Hindi text in a Hindi face.
 *
 * Decided by what the text says, not by the language setting: a Hindi screen still shows
 * "+91" and the Mait's own name, and those keep the designed face.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import AppText from '../AppText';
import { fonts } from '@theme/tokens';

/** The phone's font-size setting, as the window reports it. */
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 800, scale: 2, fontScale: mockFontScale }),
}));

function setFontScale(fontScale: number) {
  mockFontScale = fontScale;
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('AppText', () => {
  beforeEach(() => setFontScale(1));
  afterEach(() => jest.restoreAllMocks());

  it('draws Hindi in Tiro, a point larger, with room for the matras', () => {
    render(
      <AppText
        testID="t"
        style={{ fontFamily: fonts.bodyStrong, fontSize: 15, lineHeight: 22, letterSpacing: 1 }}
      >
        कोड भेजें
      </AppText>,
    );
    expect(styleOf('t')).toMatchObject({
      fontFamily: fonts.hindi,
      fontWeight: 'normal',
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0,
    });
  });

  it('keeps a taller line height the style already asked for', () => {
    render(
      <AppText testID="t" style={{ fontSize: 26, lineHeight: 50 }}>
        आपका मोबाइल नंबर क्या है?
      </AppText>,
    );
    expect(styleOf('t')).toMatchObject({ fontSize: 27, lineHeight: 50 });
  });

  it('leaves English and numbers in the designed face', () => {
    render(
      <AppText testID="t" style={{ fontFamily: fonts.heading, fontSize: 17 }}>
        +91
      </AppText>,
    );
    expect(styleOf('t')).toEqual({ fontFamily: fonts.heading, fontSize: 17 });
  });

  it('applies the phone’s font size itself, capped, so Android measures what it draws', () => {
    setFontScale(2);
    render(
      <AppText testID="t" style={{ fontSize: 15, lineHeight: 22 }}>
        कोड भेजें
      </AppText>,
    );
    const text = screen.getByTestId('t');
    expect(text.props.allowFontScaling).toBe(false);
    expect(text.props.textBreakStrategy).toBe('simple');
    expect(styleOf('t')).toMatchObject({ fontSize: 20, lineHeight: 30 });
  });

  it('leaves English to the OS', () => {
    setFontScale(2);
    render(<AppText testID="t">+91</AppText>);
    expect(screen.getByTestId('t').props.allowFontScaling).toBeUndefined();
  });

  it('pads a Hindi label on Android so its last letter is not lost', () => {
    // "कम" in the low-stock badge came out as "क": measured a hair narrow, the last letter
    // broke onto a line the badge had no room for.
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<AppText testID="t">कम</AppText>);
    expect(screen.getByTestId('t').props.children).toEqual(['कम', ' ']);
  });

  it('shrinks a Hindi line held to a count rather than ending it in an ellipsis', () => {
    render(
      <AppText testID="t" numberOfLines={1}>
        आपके पास सीमेन
      </AppText>,
    );
    const text = screen.getByTestId('t');
    expect(text.props.adjustsFontSizeToFit).toBe(true);
    expect(text.props.minimumFontScale).toBe(0.7);
  });

  it('leaves an English line held to a count as the caller set it', () => {
    render(
      <AppText testID="t" numberOfLines={1}>
        Straws with you
      </AppText>,
    );
    expect(screen.getByTestId('t').props.adjustsFontSizeToFit).toBeUndefined();
  });
});
