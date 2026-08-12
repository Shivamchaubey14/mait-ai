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
import { OTP_EXPIRY_SECONDS, OTP_LOCK_MINUTES } from '@/config/env';
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
      expect(screen.getByText(/2 tries left/i)).toBeTruthy();
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
      expect(screen.getByText(/One try left/i)).toBeTruthy();
    });

    it('keeps the cells readable while refusing them', () => {
      // The next thing the user does is read their own digits back against the SMS, so the
      // refusal is carried by the outline and never by dimming or filling the digits.
      render({ otp: '492715', failure: 'wrong', attemptsUsed: 1 });
      expect(screen.getByText('4')).toBeTruthy();
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  describe('expired code', () => {
    it('states the lifetime the server actually enforces', () => {
      // Interpolated from OTP_EXPIRY_SECONDS rather than written into the copy, so the
      // sentence cannot drift away from the setting it describes.
      render({ otp: '492715', failure: 'expired' });

      expect(screen.getByTestId('otp-notice-expired')).toBeTruthy();
      expect(screen.getByText(`Codes last ${OTP_EXPIRY_SECONDS / 60} minutes.`)).toBeTruthy();
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
    it('says how long the wait is, in the same minutes the app enforces', () => {
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: OTP_LOCK_MINUTES * 60 });

      expect(screen.getByTestId('otp-notice-locked')).toBeTruthy();
      expect(screen.getByText(`Try again in ${OTP_LOCK_MINUTES} minutes.`)).toBeTruthy();
    });

    it('hides the call link when no support number is configured', () => {
      // A call button that dials nothing is worse than no call button. The number comes from
      // app.json, and this build has none.
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 600 });
      expect(screen.queryByTestId('otp-call-it')).toBeNull();
    });

    it('counts the lock down on the button', () => {
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 892 });
      // 14:52 — a number that is visibly moving beats a flat "try later".
      expect(screen.getByText(/14:52/)).toBeTruthy();
    });

    it('turns the button into a way out once the countdown reaches zero', () => {
      // Not back to "Sign in" — the code that was being typed died long before the lock
      // lifted, so the only move left is a fresh one.
      const onResend = jest.fn();
      render({ failure: 'locked', attemptsUsed: 3, lockedFor: 0, onResend });

      expect(screen.getByText(i18n.t('auth.lockedLiftedBody'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('login-verify'));
      expect(onResend).toHaveBeenCalled();
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

      expect(screen.getByText(/0:24/)).toBeTruthy();
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
    it('puts the way back next to the number it goes back to', () => {
      // A wrong number is the most likely reason no code arrives, so the digits to check and
      // the control that fixes them sit in the same row.
      const onEditNumber = jest.fn();
      render({ onEditNumber });

      expect(screen.getByText('+91 98765 43210')).toBeTruthy();
      fireEvent.press(screen.getByTestId('otp-back'));
      expect(onEditNumber).toHaveBeenCalledTimes(1);
    });
  });

  describe('the signal card', () => {
    it('says the network is needed once, here, and not again', () => {
      render();
      expect(screen.getByText(i18n.t('auth.needsSignalTitle'))).toBeTruthy();
    });

    it('gives way to the failure notice, rather than stacking with it', () => {
      // Someone who has just been told their code was rejected does not need a second card
      // about network coverage competing for the same glance.
      render({ otp: '492715', failure: 'wrong', attemptsUsed: 1 });
      expect(screen.queryByText(i18n.t('auth.needsSignalTitle'))).toBeNull();
    });
  });
});
