/**
 * Login screen tests (SRS §6.8.2, §9.1).
 *
 * The cases that matter are the failure ones: a Mait in a village with a weak signal needs
 * to be told which thing went wrong — wrong code, expired code, or out of attempts — because
 * each has a different next action.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import LoginScreen from '../LoginScreen';
import i18n from '@/i18n';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

const MOBILE = '9795402473';

describe('LoginScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  function typeMobileAndSend() {
    fireEvent.changeText(screen.getByTestId('login-mobile'), MOBILE);
    fireEvent.press(screen.getByTestId('login-send-otp'));
  }

  it('will not send an OTP to a malformed number', () => {
    renderWithStore(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId('login-mobile'), '12345');

    expect(screen.getByTestId('login-send-otp')).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('strips non-digits so a pasted number still works', () => {
    renderWithStore(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId('login-mobile'), '+91 97954-02473');

    // Punctuation is stripped and the first ten digits kept, then displayed grouped 5+5 —
    // the way the number is read aloud and printed on a SIM.
    expect(screen.getByTestId('login-mobile').props.value).toBe('91979 54024');
  });

  it('moves to the OTP step after sending', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ detail: 'sent', expires_in_seconds: 300 }),
    );
    renderWithStore(<LoginScreen />);
    typeMobileAndSend();

    await waitFor(() => expect(screen.getByTestId('login-otp')).toBeTruthy());
  });

  it('tells the user their code was wrong', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ detail: 'sent', expires_in_seconds: 300 }))
      .mockResolvedValueOnce(problemResponse(400, 'otp-invalid'));

    renderWithStore(<LoginScreen />);
    typeMobileAndSend();
    await waitFor(() => screen.getByTestId('login-otp'));

    fireEvent.changeText(screen.getByTestId('login-otp'), '000000');
    fireEvent.press(screen.getByTestId('login-verify'));

    await waitFor(() => expect(screen.getByTestId('login-error')).toBeTruthy());
    expect(screen.getByText(/Incorrect OTP/i)).toBeTruthy();
  });

  it('distinguishes an expired code from a wrong one', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ detail: 'sent', expires_in_seconds: 300 }))
      .mockResolvedValueOnce(problemResponse(400, 'otp-expired'));

    renderWithStore(<LoginScreen />);
    typeMobileAndSend();
    await waitFor(() => screen.getByTestId('login-otp'));

    fireEvent.changeText(screen.getByTestId('login-otp'), '123456');
    fireEvent.press(screen.getByTestId('login-verify'));

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
  });

  it('distinguishes running out of attempts', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ detail: 'sent', expires_in_seconds: 300 }))
      .mockResolvedValueOnce(problemResponse(429, 'otp-attempts-exceeded'));

    renderWithStore(<LoginScreen />);
    typeMobileAndSend();
    await waitFor(() => screen.getByTestId('login-otp'));

    fireEvent.changeText(screen.getByTestId('login-otp'), '123456');
    fireEvent.press(screen.getByTestId('login-verify'));

    await waitFor(() => expect(screen.getByText(/Too many/i)).toBeTruthy());
  });

  it('stores the session and the assigned MPPs on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ detail: 'sent', expires_in_seconds: 300 }))
      .mockResolvedValueOnce(jsonResponse({ access: 'access-token', refresh: 'refresh-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 7,
          username: 'mait5500000003',
          full_name: 'SHIVKUMAR',
          email: '',
          mobile_no: MOBILE,
          role: 'mait',
          role_display: 'Mait (Field Agent)',
          is_active: true,
          last_login_at: null,
          mait_id: 3,
          sahayak_vendor_code: '5500000003',
          assigned_mpp_codes: ['001303', '001305'],
        }),
      );

    const { store } = renderWithStore(<LoginScreen />);
    typeMobileAndSend();
    await waitFor(() => screen.getByTestId('login-otp'));

    fireEvent.changeText(screen.getByTestId('login-otp'), '123456');
    fireEvent.press(screen.getByTestId('login-verify'));

    await waitFor(() => expect(store.getState().auth.accessToken).toBe('access-token'));

    const auth = store.getState().auth;
    expect(auth.user?.role).toBe('mait');
    // Fetched before the session is marked live, so the first screen never has to render an
    // empty state while it waits for scope.
    expect(auth.assignedMppCodes).toEqual(['001303', '001305']);
  });

  it('groups the number 5+5 as it is typed', () => {
    renderWithStore(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId('login-mobile'), '9876543210');
    expect(screen.getByTestId('login-mobile').props.value).toBe('98765 43210');
  });

  it('says plainly that there is no password', () => {
    // Otherwise a user hunts for a password field that does not exist and concludes the
    // app is broken.
    renderWithStore(<LoginScreen />);
    expect(screen.getByText(/No password, ever/i)).toBeTruthy();
  });

  it('explains what to do when a number does not work', () => {
    // 93% of Maits arrive from SAP with no mobile number at all, so this is the most
    // likely first experience, not an edge case.
    renderWithStore(<LoginScreen />);
    expect(screen.getByText(/Number not working/i)).toBeTruthy();
    expect(screen.getByText(/MPP operator can add or change it/i)).toBeTruthy();
  });

  it('offers a language toggle on the screen itself', async () => {
    // Behind a settings screen it would be useless: a Mait who cannot read the app cannot
    // navigate to the setting that fixes it.
    renderWithStore(<LoginScreen />);
    expect(screen.getByTestId('language-en')).toBeTruthy();

    fireEvent.press(screen.getByTestId('language-hi'));
    // The hero subtitle is unique on the screen; the heading text also appears as an
    // accessibility label and would match twice.
    await waitFor(() => expect(screen.getByText(/छह चरणों में/)).toBeTruthy());
    await i18n.changeLanguage('en');
  });

  it('does not reveal whether a number is registered', async () => {
    // The server answers identically either way; the screen must advance regardless, or it
    // would leak which numbers exist.
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ detail: 'If this number is registered, an OTP has been sent to it.' }),
    );

    renderWithStore(<LoginScreen />);
    fireEvent.changeText(screen.getByTestId('login-mobile'), '9999999999');
    fireEvent.press(screen.getByTestId('login-send-otp'));

    await waitFor(() => expect(screen.getByTestId('login-otp')).toBeTruthy());
    expect(screen.queryByTestId('login-error')).toBeNull();
  });
});
