/**
 * Asking the office for a sign-in code when the SMS does not come (accounts.SuperOTP).
 *
 * The screen promises a phone call and nothing else: it posts the ask, says the office will
 * ring the number on the screen, and puts the user back in front of the same six boxes — even
 * if the SMS path had locked them out, because the office's code has its own allowance.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import LoginScreen from '../LoginScreen';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

const MOBILE = '9795402473';
const SENT = { detail: 'sent', expires_in_seconds: 300 };
const ASKED = {
  detail: 'If this number is registered, the office has been asked.',
  expires_in_seconds: 600,
};

function requests() {
  return (global.fetch as jest.Mock).mock.calls.map(([input]) => input as Request);
}

async function onCodeScreen() {
  renderWithStore(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-mobile'), MOBILE);
  fireEvent.press(screen.getByTestId('login-send-otp'));
  await waitFor(() => screen.getByTestId('login-otp'));
}

describe('asking the office for a code', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('is on offer on the code screen before anything has gone wrong', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(SENT));
    await onCodeScreen();
    expect(screen.getByTestId('otp-ask-office')).toBeTruthy();
  });

  it('asks, and says the office will call this number', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(SENT))
      .mockResolvedValueOnce(jsonResponse(ASKED));
    await onCodeScreen();

    fireEvent.press(screen.getByTestId('otp-ask-office'));

    await waitFor(() => screen.getByTestId('otp-office-asked'));
    expect(screen.getByTestId('otp-office-asked')).toHaveTextContent(/\+91 97954 02473/);
    const ask = requests().find(request => request.url.includes('/auth/otp/super/request/'));
    expect(ask).toBeTruthy();
    expect(await (ask as Request).clone().json()).toMatchObject({ mobile_no: MOBILE });
  });

  it('lifts the SMS lock so the office code can be typed', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(SENT))
      .mockResolvedValueOnce(problemResponse(429, 'otp-attempts-exceeded'))
      .mockResolvedValueOnce(jsonResponse(ASKED));
    await onCodeScreen();

    fireEvent.changeText(screen.getByTestId('login-otp'), '111111');
    fireEvent.press(screen.getByTestId('login-verify'));
    await waitFor(() => expect(screen.getByTestId('login-otp').props.editable).toBe(false));

    fireEvent.press(screen.getByTestId('otp-ask-office'));
    await waitFor(() => screen.getByTestId('otp-office-asked'));
    expect(screen.getByTestId('login-otp').props.editable).toBe(true);
  });

  it('says so when there is no signal to ask with', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(SENT))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    await onCodeScreen();

    fireEvent.press(screen.getByTestId('otp-ask-office'));

    await waitFor(() => expect(screen.getByText(/No signal to reach the office/)).toBeTruthy());
    expect(screen.queryByTestId('otp-office-asked')).toBeNull();
  });
});
