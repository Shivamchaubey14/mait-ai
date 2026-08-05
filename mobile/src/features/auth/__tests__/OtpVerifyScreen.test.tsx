/**
 * OTP verify screen tests (SRS §6.5.1).
 *
 * The three failures have to stay distinguishable. A Mait standing in a village does
 * something different for each one: type it again, fetch a new code, or stop and find the
 * IT department. Collapsing them into "something went wrong" is what makes an app useless in
 * the field.
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import OtpVerifyScreen from '../OtpVerifyScreen';
import i18n from '@/i18n';
import { renderWithStore } from '@/test-utils';

const baseProps = {
  mobileNo: '9876543210',
  otp: '',
  onChangeOtp: jest.fn(),
  onSubmit: jest.fn(),
  onResend: jest.fn(),
  onEditNumber: jest.fn(),
  resendIn: 0,
  attemptsUsed: 0,
  failure: null as null,
};

function render(overrides: Partial<React.ComponentProps<typeof OtpVerifyScreen>> = {}) {
  return renderWithStore(<OtpVerifyScreen {...baseProps} {...overrides} />);
}

afterEach(() => jest.clearAllMocks());

describe('OtpVerifyScreen', () => {
  it('shows the number the code went to', () => {
    render();
    // Grouped and prefixed, so it can be checked against the handset at a glance.
    expect(screen.getAllByText('+91 98765 43210').length).toBeGreaterThan(0);
  });

  it('is one input, not six', () => {
    // Six inputs break paste, backspace and screen readers. The circles are a display of a
    // single field laid invisibly over them.
    render();
    expect(screen.getByTestId('login-otp')).toBeTruthy();
  });

  it('sends typed digits up stripped of anything else', () => {
    const onChangeOtp = jest.fn();
    render({ onChangeOtp });

    fireEvent.changeText(screen.getByTestId('login-otp'), '4a9b2c');
    expect(onChangeOtp).toHaveBeenCalledWith('492');
  });

  it('will not submit a partial code', () => {
    const onSubmit = jest.fn();
    render({ otp: '4927', onSubmit });

    fireEvent.press(screen.getByTestId('login-verify'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a complete one', () => {
    const onSubmit = jest.fn();
    render({ otp: '492715', onSubmit });

    fireEvent.press(screen.getByTestId('login-verify'));
    expect(onSubmit).toHaveBeenCalled();
  });

  describe('wrong code', () => {
    it('says how many attempts remain', () => {
      // The count is what decides whether to try again or give up and resend.
      render({ otp: '492715', failure: 'wrong', attemptsUsed: 1 });

      expect(screen.getByTestId('otp-notice-wrong')).toBeTruthy();
      expect(screen.getByText(/That code is not right/i)).toBeTruthy();
      expect(screen.getByText(/2 attempts left/i)).toBeTruthy();
    });

    it('offers a retry rather than a resend', () => {
      const onSubmit = jest.fn();
      render({ otp: '492715', failure: 'wrong', attemptsUsed: 1, onSubmit });

      expect(screen.getByText(/Try again/i)).toBeTruthy();
      fireEvent.press(screen.getByTestId('login-verify'));
      expect(onSubmit).toHaveBeenCalled();
    });

    it('uses the singular on the last attempt', () => {
      render({ otp: '492715', failure: 'wrong', attemptsUsed: 2 });
      expect(screen.getByText(/One attempt left/i)).toBeTruthy();
    });
  });

  describe('expired code', () => {
    it('explains the five-minute lifetime', () => {
      render({ otp: '492715', failure: 'expired' });

      expect(screen.getByTestId('otp-notice-expired')).toBeTruthy();
      expect(screen.getByText(/five minutes/i)).toBeTruthy();
    });

    it('offers a new code, since retrying a dead one is a dead end', () => {
      const onResend = jest.fn();
      const onSubmit = jest.fn();
      render({ otp: '492715', failure: 'expired', onResend, onSubmit });

      fireEvent.press(screen.getByTestId('login-verify'));
      expect(onResend).toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('can send a new code even with the box empty', () => {
      const onResend = jest.fn();
      render({ otp: '', failure: 'expired', onResend });

      fireEvent.press(screen.getByTestId('login-verify'));
      expect(onResend).toHaveBeenCalled();
    });
  });

  describe('locked out', () => {
    it('says how long, and who to call', () => {
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 15 * 60 });

      expect(screen.getByTestId('otp-notice-locked')).toBeTruthy();
      expect(screen.getByText(i18n.t('auth.lockedBody'))).toBeTruthy();
      expect(i18n.t('auth.lockedBody')).toMatch(/IT department/i);
    });

    it('counts the lock down on the button', () => {
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 892 });
      // 14:52 — a number that is visibly moving beats a flat "try later".
      expect(screen.getByText(/14:52/)).toBeTruthy();
    });

    it('does nothing when the locked button is pressed', () => {
      const onSubmit = jest.fn();
      const onResend = jest.fn();
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 600, onSubmit, onResend });

      fireEvent.press(screen.getByTestId('login-verify'));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onResend).not.toHaveBeenCalled();
    });

    it('hides the resend row, which cannot work while locked', () => {
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 600 });
      expect(screen.queryByTestId('login-resend')).toBeNull();
    });
  });

  describe('resend', () => {
    it('is blocked while the timer runs', () => {
      const onResend = jest.fn();
      render({ resendIn: 24, onResend });

      expect(screen.getByText(/00:24/)).toBeTruthy();
      fireEvent.press(screen.getByTestId('login-resend'));
      expect(onResend).not.toHaveBeenCalled();
    });

    it('works once the timer reaches zero', () => {
      const onResend = jest.fn();
      render({ resendIn: 0, onResend });

      fireEvent.press(screen.getByTestId('login-resend'));
      expect(onResend).toHaveBeenCalled();
    });
  });

  describe('changing the number', () => {
    it('offers a way back from the header, the card and the link', () => {
      // A wrong number is the most likely reason no code arrives, so the way out is not
      // hidden behind a single small control.
      const onEditNumber = jest.fn();
      render({ onEditNumber });

      fireEvent.press(screen.getByTestId('otp-back'));
      fireEvent.press(screen.getByTestId('otp-edit-number'));
      fireEvent.press(screen.getByTestId('otp-different-number'));

      expect(onEditNumber).toHaveBeenCalledTimes(3);
    });
  });
});
