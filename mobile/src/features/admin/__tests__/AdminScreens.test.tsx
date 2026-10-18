/**
 * The admin screens (Round 2 — AI events and Members).
 *
 * What is under test is what an office account would act on wrongly if it were wrong: that the
 * roster renders the server's events and its set-wide counts; that the one irreversible action,
 * delete, is offered to an admin and withheld from a Normal User (the server enforces it too,
 * but the button must not even appear); and that the member search reads back a result.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { loggedIn } from '@/features/auth/authSlice';
import type { UserRole } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

import AdminEventsScreen from '../AdminEventsScreen';
import AdminMembersScreen from '../AdminMembersScreen';

const EVENT = {
  id: 7,
  owner_name: 'Kavita Devi',
  owner_type: 'member',
  member_code: 'MEM-001',
  status: 'completed',
  status_display: 'Completed',
  mpp_code: '001371',
  mpp_name: 'Barsana',
  mait_name: 'Sunil Kumar',
  mait_code: '5500000054',
  breed: 'MURRAH',
  ear_tag_no: 'IN-123',
  straw_unique_no: 'STR-9001',
  doses: 1,
  amount_due: '250.00',
  payment: { mode_display: 'Cash', status_display: 'Verified' },
  performed_at: '2026-10-10T09:00:00Z',
  completed_at: '2026-10-10T09:05:00Z',
  created_at: '2026-10-10T09:00:00Z',
};

const PAGE = {
  count: 1,
  next: null,
  previous: null,
  results: [EVENT],
  summary: { completed: 1, unfinished: 0, cancelled: 0 },
};

const MEMBER = {
  member_code: 'MEM-001',
  member_name: 'Kavita Devi',
  mobile_no: '9811100045',
  mpp_code: '001371',
  activation_status: 'active',
};

function storeFor(role: UserRole) {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'a',
      refresh: 'r',
      user: {
        id: 1,
        fullName: 'Office Admin',
        role,
        mobileNo: '',
        maitId: null,
        sahayakVendorCode: null,
      },
      assignedMppCodes: [],
    }),
  );
  return store;
}

function mockEvents() {
  (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/ai-events/7/')) {
      return jsonResponse(EVENT);
    }
    if (url.includes('/ai-events/')) {
      return jsonResponse(PAGE);
    }
    return jsonResponse({});
  });
}

beforeEach(() => {
  global.fetch = jest.fn() as jest.Mock;
});
afterEach(() => jest.resetAllMocks());

describe('AdminEventsScreen', () => {
  it('lists the network’s events with the set-wide completed count', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-event-7')).toBeTruthy());
    expect(screen.getByText('Kavita Devi')).toBeTruthy();
    // The count on the filter chip is the server's summary, not the page length.
    expect(screen.getByText('Completed 1')).toBeTruthy();
  });

  it('offers delete to an admin on the record', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-event-7'));
    await waitFor(() => expect(screen.getByTestId('admin-event-delete')).toBeTruthy());
  });

  it('withholds delete from a Normal User', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('normal_user') });

    fireEvent.press(await screen.findByTestId('admin-event-7'));
    // The record loads, but the one irreversible action is not even drawn.
    await waitFor(() => expect(screen.getByTestId('admin-event-back')).toBeTruthy());
    expect(screen.queryByTestId('admin-event-delete')).toBeNull();
  });
});

describe('AdminMembersScreen', () => {
  it('searches members and reads back a result', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ count: 1, next: null, previous: null, results: [MEMBER] }),
    );
    renderWithStore(<AdminMembersScreen />, { store: storeFor('admin') });

    fireEvent.changeText(screen.getByTestId('admin-members-search'), 'Kavita');
    await waitFor(() => expect(screen.getByTestId('admin-member-MEM-001')).toBeTruthy());
    expect(screen.getByText('Kavita Devi')).toBeTruthy();
  });
});
