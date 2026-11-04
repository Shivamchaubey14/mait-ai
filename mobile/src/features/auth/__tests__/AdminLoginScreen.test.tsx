/**
 * Admin sign-in and password reset (SRS §6.8.1–6.8.2), as the portal has them.
 *
 * What has to hold: a failed sign-in says so above the form and empties the password, the reset
 * never asks for a phone number, the new password is checked here before a code is spent on it,
 * and a refused code is reported in the server's own words.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import AdminLoginScreen, { djangoAdminUrl } from '../AdminLoginScreen';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

type Sent = { url: string; method: string; body: unknown };

function mockFetch(answers: Record<string, () => Response>, sent: Sent[] = []) {
  (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
    const url = String(input.url ?? input);
    const method = input.method ?? 'GET';
    const body = method === 'GET' ? null : await input.clone().json();
    sent.push({ url, method, body });
    const key = Object.keys(answers).find(path => url.includes(path));
    return key ? answers[key]!() : jsonResponse({}, 404);
  });
}

const ME = {
  id: 1,
  username: 'admin',
  full_name: 'Office Admin',
  email: '',
  mobile_no: '9876543210',
  role: 'admin',
  role_display: 'Admin',
  is_active: true,
  last_login_at: null,
  mait_id: null,
  sahayak_vendor_code: null,
  assigned_mpp_codes: [],
  portal_sections: ['dashboard'],
  zones: [],
};

describe('AdminLoginScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("wears the portal's sign-in: the mark, the headline, the form and the second door", () => {
    renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);

    expect(screen.getByTestId('admin-auth-mark')).toHaveTextContent(/MAIT AI.*ADMIN PORTAL/);
    expect(screen.getByTestId('admin-auth-headline')).toHaveTextContent(
      'Oversight for 105k+ members, 2000+ MPPs and 62+ Maits',
    );
    expect(
      screen.getByText('Admin access only. Field staff sign in on the app with an OTP.'),
    ).toBeTruthy();
    expect(screen.getByText('Use the credentials issued by Shwetdhara IT.')).toBeTruthy();
    expect(screen.getByTestId('admin-login-forgot')).toHaveTextContent('Forgot password?');
    expect(screen.getByTestId('admin-login-submit')).toHaveTextContent(/Sign in.*→/);
    expect(
      screen.getByText(
        'Repeated failures are rate limited. Contact Shwetdhara IT if you are locked out.',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('admin-login-django')).toHaveTextContent(/Superuser login/);
  });

  it('says what is missing rather than sending an empty form', () => {
    renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);
    fireEvent.press(screen.getByTestId('admin-login-submit'));

    expect(screen.getByTestId('admin-login-error')).toHaveTextContent(
      /Enter your username and password\.$/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows and hides the password', () => {
    renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);
    expect(screen.getByTestId('admin-password').props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByTestId('admin-password-toggle'));
    expect(screen.getByTestId('admin-password').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('admin-password-toggle')).toHaveTextContent('Hide');
  });

  it('signs in and holds the profile before the session goes live', async () => {
    const sent: Sent[] = [];
    mockFetch(
      {
        '/auth/login/': () => jsonResponse({ access: 'a-token', refresh: 'r-token' }),
        '/auth/me/': () => jsonResponse(ME),
      },
      sent,
    );
    const { store } = renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('admin-username'), '  admin ');
    fireEvent.changeText(screen.getByTestId('admin-password'), 'MaitAdmin@2026');
    fireEvent.press(screen.getByTestId('admin-login-submit'));

    await waitFor(() => expect(store.getState().auth.accessToken).toBe('a-token'));
    expect(store.getState().auth.user?.role).toBe('admin');
    expect(sent[0]!.body).toEqual({ username: 'admin', password: 'MaitAdmin@2026' });
  });

  it('reports a refused sign-in above the form and clears the password', async () => {
    mockFetch({
      '/auth/login/': () =>
        problemResponse(401, 'authentication-failed', 'Invalid username or password.'),
    });
    renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('admin-username'), 'admin');
    fireEvent.changeText(screen.getByTestId('admin-password'), 'wrong-one');
    fireEvent.press(screen.getByTestId('admin-login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('admin-login-error')).toHaveTextContent(
        /Invalid username or password\.$/,
      ),
    );
    expect(screen.getByTestId('admin-password').props.value).toBe('');
  });

  it('says so when sign-in is rate limited', async () => {
    mockFetch({ '/auth/login/': () => problemResponse(429, 'throttled', 'Slow down') });
    renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId('admin-username'), 'admin');
    fireEvent.changeText(screen.getByTestId('admin-password'), 'x');
    fireEvent.press(screen.getByTestId('admin-login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('admin-login-error')).toHaveTextContent(/Too many|too many/),
    );
  });

  it('opens the superuser door on the API host, and goes back to the OTP sign-in', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const onBack = jest.fn();
    renderWithStore(<AdminLoginScreen onBack={onBack} />);

    fireEvent.press(screen.getByTestId('admin-login-django'));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/$/));
    fireEvent.press(screen.getByTestId('admin-login-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('finds the Django admin from any API base', () => {
    expect(djangoAdminUrl('https://mait.example.in/api/v1')).toBe('https://mait.example.in/admin/');
    expect(djangoAdminUrl('http://10.0.2.2:8000/api/v1/')).toBe('http://10.0.2.2:8000/admin/');
  });

  describe('password reset', () => {
    function toReset(username = '') {
      renderWithStore(<AdminLoginScreen onBack={jest.fn()} />);
      if (username) {
        fireEvent.changeText(screen.getByTestId('admin-username'), username);
      }
      fireEvent.press(screen.getByTestId('admin-login-forgot'));
    }

    it('asks only for the username, carried over from sign-in', () => {
      toReset('ravi');
      expect(screen.getByTestId('admin-auth-headline')).toHaveTextContent(
        'Back into your account, by the number on file',
      );
      expect(screen.getByTestId('admin-reset-username').props.value).toBe('ravi');
      // Never a phone number: the code goes to the one already on the account.
      expect(screen.queryByText(/Mobile number/)).toBeNull();
    });

    it('sends the code, checks the new password here, and resets', async () => {
      const sent: Sent[] = [];
      mockFetch(
        {
          '/password/reset/request/': () =>
            jsonResponse({ detail: 'If that account exists…', expires_in_seconds: 300 }),
          '/password/reset/verify/': () => jsonResponse({ detail: 'Password changed.' }),
        },
        sent,
      );
      toReset('ravi');

      fireEvent.press(screen.getByTestId('admin-reset-send'));
      await waitFor(() => expect(screen.getByTestId('admin-reset-verify')).toBeTruthy());
      expect(sent[0]!.body).toEqual({ username: 'ravi' });
      expect(screen.getByTestId('admin-reset-sent')).toHaveTextContent(/expires in 5 minutes/);

      fireEvent.press(screen.getByTestId('admin-reset-submit'));
      expect(screen.getByTestId('admin-reset-error')).toHaveTextContent(
        /Enter the one-time code sent to your mobile\.$/,
      );
      fireEvent.changeText(screen.getByTestId('admin-reset-code'), '12-34-56');
      expect(screen.getByTestId('admin-reset-code').props.value).toBe('123456');
      fireEvent.changeText(screen.getByTestId('admin-reset-password'), 'short');
      fireEvent.press(screen.getByTestId('admin-reset-submit'));
      expect(screen.getByTestId('admin-reset-error')).toHaveTextContent(
        /Your new password must be at least 10 characters\.$/,
      );
      fireEvent.changeText(screen.getByTestId('admin-reset-password'), 'long-enough-1');
      fireEvent.changeText(screen.getByTestId('admin-reset-confirm'), 'long-enough-2');
      fireEvent.press(screen.getByTestId('admin-reset-submit'));
      expect(screen.getByTestId('admin-reset-error')).toHaveTextContent(
        /The two passwords do not match\.$/,
      );
      expect(screen.getByTestId('admin-reset-confirm').props.value).toBe('');
      expect(sent).toHaveLength(1);

      // Show reveals both, so they are compared in the open or not at all.
      fireEvent.press(screen.getByTestId('admin-reset-toggle'));
      expect(screen.getByTestId('admin-reset-password').props.secureTextEntry).toBe(false);
      expect(screen.getByTestId('admin-reset-confirm').props.secureTextEntry).toBe(false);

      fireEvent.changeText(screen.getByTestId('admin-reset-confirm'), 'long-enough-1');
      fireEvent.press(screen.getByTestId('admin-reset-submit'));
      await waitFor(() => expect(screen.getByTestId('admin-reset-done')).toBeTruthy());
      expect(sent[1]!.body).toEqual({
        username: 'ravi',
        otp: '123456',
        new_password: 'long-enough-1',
      });

      // Back at sign-in, with the username in place and the news said.
      fireEvent.press(screen.getByTestId('admin-reset-signin'));
      expect(screen.getByTestId('admin-username').props.value).toBe('ravi');
      expect(screen.getByTestId('admin-login-notice')).toHaveTextContent(
        /Your password has been changed\. Sign in with the new one\.$/,
      );
    });

    it("reports a refused code in the server's words", async () => {
      mockFetch({
        '/password/reset/request/': () => jsonResponse({ detail: 'sent', expires_in_seconds: 300 }),
        '/password/reset/verify/': () =>
          problemResponse(400, 'otp-expired', 'This OTP has expired. Request a new one.'),
      });
      toReset('ravi');
      fireEvent.press(screen.getByTestId('admin-reset-send'));
      await waitFor(() => expect(screen.getByTestId('admin-reset-verify')).toBeTruthy());

      fireEvent.changeText(screen.getByTestId('admin-reset-code'), '111111');
      fireEvent.changeText(screen.getByTestId('admin-reset-password'), 'long-enough-1');
      fireEvent.changeText(screen.getByTestId('admin-reset-confirm'), 'long-enough-1');
      fireEvent.press(screen.getByTestId('admin-reset-submit'));

      await waitFor(() =>
        expect(screen.getByTestId('admin-reset-error')).toHaveTextContent(
          /This OTP has expired\. Request a new one\.$/,
        ),
      );
    });

    it('needs a username before sending, and goes back without one', () => {
      toReset();
      fireEvent.press(screen.getByTestId('admin-reset-send'));
      expect(screen.getByTestId('admin-reset-error')).toHaveTextContent(/Enter your username\.$/);
      expect(global.fetch).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('admin-reset-back'));
      expect(screen.getByTestId('admin-login')).toBeTruthy();
    });

    it('lets a mistyped username be changed from the code step', async () => {
      mockFetch({
        '/password/reset/request/': () => jsonResponse({ detail: 'sent', expires_in_seconds: 600 }),
      });
      toReset('rav');
      fireEvent.press(screen.getByTestId('admin-reset-send'));
      await waitFor(() => expect(screen.getByTestId('admin-reset-sent')).toBeTruthy());
      expect(screen.getByTestId('admin-reset-sent')).toHaveTextContent(/10 minutes/);

      fireEvent.press(screen.getByTestId('admin-reset-different'));
      expect(screen.getByTestId('admin-reset-username').props.value).toBe('rav');
    });
  });
});
