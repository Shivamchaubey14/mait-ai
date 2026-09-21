/**
 * One sign-in screen, three apps.
 *
 * A Mait, a store keeper and a zonal manager all sign in on the same screen with the same
 * OTP and land somewhere else entirely. The gate decides between them, and what it decides
 * on for a manager is the one rule the server enforces too: an office account *with a zone*.
 * A head-office Admin — same role, no zone — is not a manager and must not be handed the
 * manager's shell, because every screen in it is scoped by a zone they do not have.
 *
 * Driven through the real gate and the real navigators rather than asserted on state: the
 * thing worth holding still is what ends up mounted.
 */

import React from 'react';
import NetInfo from '@react-native-community/netinfo';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import Shell from '../Shell';
import { clearQueue } from '@api/queue';
import { loggedIn, loggedOut } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const MANAGER: AuthUser = {
  id: 7,
  fullName: 'Anita Verma',
  role: 'admin',
  mobileNo: '9811100001',
  maitId: null,
  sahayakVendorCode: null,
  zones: ['Ayodhya Zone'],
};

/** Same role, no zone — head office. They have a desk, a browser and a password. */
const HEAD_OFFICE: AuthUser = { ...MANAGER, id: 8, fullName: 'Head Office', zones: [] };

const HOME = {
  manager: {
    name: 'Anita Verma',
    mobile_no: '9811100001',
    zones: ['Ayodhya Zone'],
    sections: ['indents'],
  },
  waiting: 1,
  oldest_waiting_days: 2,
  at_depot: 0,
  maits: 4,
  stores: 1,
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

const BOARD = {
  days: 14,
  today: 2,
  yesterday: 1,
  on_yesterday: 1,
  week: 9,
  month: 30,
  maits_working_today: 1,
  in_progress: 0,
  payment_pending: 0,
  trend: [{ date: '2026-09-19', label: '19 Sep', short_label: 'Sat', completed: 2 }],
  best_day: { date: '2026-09-19', label: '19 Sep', short_label: 'Sat', completed: 2 },
  busiest_maits: [],
  busiest_villages: [],
  happening: [],
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

const STOCK = {
  summary: {
    total_straws: 60,
    maits: 4,
    at_zero: 0,
    low: 1,
    low_stock_threshold: 10,
    locations: 1,
    stores: 1,
    store_straws: 100,
  },
  locations: [],
  maits: [],
  stores: [],
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

const APPROVAL = {
  id: 13,
  mait: 4,
  mait_name: 'Sunil Kumar',
  mait_code: '5500000054',
  mpp_names: ['BARSANA'],
  product_type: 'straw',
  breed: 'MURRAH',
  item_name: 'Murrah',
  item_name_hi: 'मुर्रा',
  unit: 'straw',
  qty_requested: 25,
  note: '',
  requested_at: '2026-09-17T09:00:00Z',
  waiting_days: 2,
  status: 'requested',
  store: 1,
  store_name: 'Barsana depot',
  in_store: 40,
  mait_holds: 0,
  coverage: 'ready',
};

function mockApi() {
  (global.fetch as jest.Mock) = jest.fn((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/zonal/dashboard/')) {
      return Promise.resolve(jsonResponse(BOARD));
    }
    if (url.includes('/zonal/approvals/')) {
      return Promise.resolve(jsonResponse({ count: 1, results: [APPROVAL] }));
    }
    if (url.includes('/zonal/stock/')) {
      return Promise.resolve(jsonResponse(STOCK));
    }
    if (url.includes('/zonal/history/')) {
      return Promise.resolve(
        jsonResponse({
          summary: { days: 30, approved: 0, rejected: 0, total: 0, last_signed_in: null },
          outcome: 'all',
          count: 0,
          results: [],
        }),
      );
    }
    if (url.includes('/zonal/events/')) {
      return Promise.resolve(
        jsonResponse({
          count: 0,
          results: [],
          date_from: null,
          date_to: null,
          limit: 30,
          offset: 0,
          has_more: false,
        }),
      );
    }
    if (url.includes('/zonal/')) {
      return Promise.resolve(jsonResponse(HOME));
    }
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(
        jsonResponse({
          total_straws: 0,
          is_low_stock: true,
          by_breed: {},
          straws: [],
          consumables: [],
          assets: [],
        }),
      );
    }
    if (url.includes('/config/')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

beforeEach(async () => {
  await clearQueue();
  mockApi();
  (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});
});

afterEach(() => jest.restoreAllMocks());

function renderShell() {
  const store = makeStore();
  act(() => {
    store.dispatch(loggedOut());
  });
  return renderWithStore(<Shell fontsLoaded />, { store });
}

function signIn(store: ReturnType<typeof makeStore>, user: AuthUser) {
  act(() => {
    store.dispatch(
      loggedIn({
        access: `access-${user.id}`,
        refresh: `refresh-${user.id}`,
        user,
        assignedMppCodes: [],
      }),
    );
  });
}

describe('the zonal manager’s shell', () => {
  it('opens on the zone, not on the queue', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);

    // The first question is whether the zone is working; the second is what is waiting, and
    // that one carries a count on its tab rather than being the screen you land on.
    await screen.findByTestId('zonal-dashboard-hero');
    expect(screen.getByTestId('zonal-dashboard-hero')).toHaveTextContent(/Ayodhya Zone/);
    // None of the Mait's shell is mounted.
    expect(screen.queryByTestId('home-start-ai')).toBeNull();
  });

  it('carries what is waiting on the Indents tab', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);

    await screen.findByTestId('zonal-dashboard-hero');
    expect(await screen.findByTestId('nav-pending')).toHaveTextContent('1');
  });

  it('moves between its five tabs', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);
    await screen.findByTestId('zonal-dashboard-hero');

    fireEvent.press(screen.getByTestId('tab-zonalIndents'));
    await screen.findByTestId('zonal-hero');

    fireEvent.press(screen.getByTestId('tab-zoneStock'));
    await screen.findByTestId('zonal-stock-hero');

    fireEvent.press(screen.getByTestId('tab-zonalHistory'));
    await screen.findByTestId('zonal-history-hero');

    fireEvent.press(screen.getByTestId('tab-settings'));
    await screen.findByTestId('zonal-profile-zone');
    expect(screen.getByTestId('zonal-profile-zone')).toHaveTextContent(/Ayodhya Zone/);
  });

  it('fetches everything afresh when the app comes back to the front', async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      listeners.push(listener as (state: string) => void);
      return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
    });
    const { store } = renderShell();
    signIn(store, MANAGER);
    await screen.findByTestId('zonal-today');

    const boards = () =>
      (global.fetch as jest.Mock).mock.calls.filter(([input]) =>
        (typeof input === 'string' ? input : input.url).includes('/zonal/dashboard/'),
      ).length;
    const before = boards();
    act(() => listeners.forEach(listener => listener('background')));
    act(() => listeners.forEach(listener => listener('active')));
    await waitFor(() => expect(boards()).toBeGreaterThan(before));
  });

  it('opens one request and comes back to the queue', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);
    await screen.findByTestId('zonal-dashboard-hero');

    fireEvent.press(screen.getByTestId('tab-zonalIndents'));
    fireEvent.press(await screen.findByTestId('zonal-approval-13'));
    await screen.findByTestId('zonal-decision-hero');
    expect(screen.getByTestId('zonal-approve')).toBeTruthy();

    fireEvent.press(screen.getByTestId('store-back'));
    await screen.findByTestId('zonal-hero');
  });

  it('opens every AI event from Profile, and the tab bar brings it back', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);
    await screen.findByTestId('zonal-dashboard-hero');

    fireEvent.press(screen.getByTestId('tab-settings'));
    fireEvent.press(await screen.findByTestId('zonal-profile-all-events'));
    await screen.findByTestId('zonal-events-hero');

    fireEvent.press(screen.getByTestId('tab-settings'));
    await screen.findByTestId('zonal-profile-all-events');
  });

  it('gives a head-office admin the Mait shell, not a zone they do not have', async () => {
    const { store } = renderShell();
    signIn(store, HEAD_OFFICE);

    // No zone, so no zonal app. The gate falls through to the default navigator rather than
    // opening four screens that would all be scoped to nothing.
    await screen.findByTestId('tab-home');
    expect(screen.queryByTestId('zonal-dashboard-hero')).toBeNull();
  });

  it('unmounts with the session, like the other two shells', async () => {
    const { store } = renderShell();
    signIn(store, MANAGER);
    await screen.findByTestId('zonal-dashboard-hero');

    act(() => {
      store.dispatch(loggedOut());
    });
    await screen.findByTestId('login-mobile');
    expect(screen.queryByTestId('zonal-dashboard-hero')).toBeNull();
  });
});
