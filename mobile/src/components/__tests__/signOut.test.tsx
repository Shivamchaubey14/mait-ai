/**
 * The one Sign out button every profile shares.
 *
 * In Hindi it read "साइन" alone on Android: the label was measured in Nunito, which has no
 * Devanagari, and "आउट" wrapped out of sight. What a test can hold still is that the whole
 * label reaches the button and is laid across it rather than sized to itself.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SignOutButton } from '@/components';
import i18n from '@/i18n';

describe('SignOutButton', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('carries the whole Hindi label, laid across the button', async () => {
    await i18n.changeLanguage('hi');
    render(<SignOutButton label={i18n.t('settings.signOut')} onPress={jest.fn()} />);

    const label = screen.getByTestId('sign-out-label');
    expect(label).toHaveTextContent('साइन आउट');
    expect(label).toHaveStyle({ alignSelf: 'stretch', textAlign: 'center' });
    expect(label.props.textBreakStrategy).toBe('simple');
  });

  it('signs out when pressed', () => {
    const onPress = jest.fn();
    render(<SignOutButton label="Sign out" onPress={onPress} testID="sign-out" />);

    fireEvent.press(screen.getByTestId('sign-out'));
    expect(onPress).toHaveBeenCalled();
  });
});
