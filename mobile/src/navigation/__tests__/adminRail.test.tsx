/**
 * The admin app's sections down the left edge, always in view — the portal's aside.
 *
 * It replaced a drawer behind a menu button, which hid every section until it was opened.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import AdminNavigator from '../admin';
import i18n from '@/i18n';
import { loggedIn } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

function adminStore() {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'a',
      refresh: 'r',
      user: {
        id: 1,
        fullName: 'Office Admin',
        role: 'super_admin',
        mobileNo: '',
        maitId: null,
        sahayakVendorCode: null,
      },
      assignedMppCodes: [],
    }),
  );
  return store;
}

beforeEach(() => {
  // Every screen behind the rail reads something; an empty answer is enough to draw them.
  global.fetch = jest.fn(async () => jsonResponse({ count: 0, results: [] })) as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

describe('the admin rail', () => {
  it('shows every section beside the screen, with no menu button to open', () => {
    renderWithStore(<AdminNavigator />, { store: adminStore() });

    expect(screen.getByTestId('admin-rail')).toBeTruthy();
    expect(screen.queryByTestId('admin-hamburger')).toBeNull();
    expect(screen.getByTestId('admin-rail-dashboard')).toBeTruthy();
    expect(screen.getByTestId('admin-rail-maits')).toBeTruthy();
    expect(screen.getByTestId('admin-rail-logs')).toBeTruthy();
    expect(screen.getByTestId('admin-sign-out')).toBeTruthy();
    // Opens on the dashboard, lit in the rail.
    expect(screen.getByTestId('admin-title')).toHaveTextContent('Dashboard');
    expect(screen.getByTestId('admin-rail-dashboard').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('asks before signing out in our own card, not the system alert', async () => {
    const store = adminStore();
    renderWithStore(<AdminNavigator />, { store });

    fireEvent.press(screen.getByTestId('admin-sign-out'));
    expect(await screen.findByTestId('admin-sign-out-dialog')).toHaveTextContent(/Sign out\?/);

    // Cancel leaves the session alone.
    fireEvent.press(screen.getByTestId('admin-sign-out-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('admin-sign-out-dialog')).toBeNull());
    expect(store.getState().auth.accessToken).toBe('a');

    fireEvent.press(screen.getByTestId('admin-sign-out'));
    fireEvent.press(await screen.findByTestId('admin-sign-out-dialog-confirm'));
    await waitFor(() => expect(store.getState().auth.accessToken).toBeNull());
  });

  it('opens a section in one tap', async () => {
    renderWithStore(<AdminNavigator />, { store: adminStore() });

    fireEvent.press(screen.getByTestId('admin-rail-inventory'));

    await waitFor(() => expect(screen.getByTestId('admin-title')).toHaveTextContent('Inventory'));
    expect(screen.getByTestId('admin-rail-inventory').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('names the sections in Hindi', async () => {
    await i18n.changeLanguage('hi');
    try {
      renderWithStore(<AdminNavigator />, { store: adminStore() });

      expect(screen.getByTestId('admin-title')).toHaveTextContent('डैशबोर्ड');
      expect(screen.getByTestId('admin-rail-maits')).toHaveTextContent(/मैत/);
      expect(screen.getByTestId('admin-rail-pregnancy')).toHaveTextContent(/गर्भ जाँच/);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
