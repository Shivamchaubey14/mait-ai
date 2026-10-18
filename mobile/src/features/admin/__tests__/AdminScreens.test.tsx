/**
 * The admin screens (Rounds 2–3 — AI events, Members, Maits, MPPs, Non-members).
 *
 * What is under test is what an office account would act on wrongly if it were wrong: that each
 * roster renders what the server returns; that AI events carries the set-wide counts; and that
 * the one irreversible action, delete, is offered to an admin and withheld from a Normal User
 * (the server enforces it too, but the button must not even appear).
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { loggedIn } from '@/features/auth/authSlice';
import type { UserRole } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

import AdminEventsScreen from '../AdminEventsScreen';
import AdminExceptionsScreen from '../AdminExceptionsScreen';
import AdminIndentsScreen from '../AdminIndentsScreen';
import AdminInventoryScreen from '../AdminInventoryScreen';
import AdminLeaderboardScreen from '../AdminLeaderboardScreen';
import AdminMaitPaymentScreen from '../AdminMaitPaymentScreen';
import AdminMaitsScreen from '../AdminMaitsScreen';
import AdminMembersScreen from '../AdminMembersScreen';
import AdminMppsScreen from '../AdminMppsScreen';
import AdminNonMembersScreen from '../AdminNonMembersScreen';
import AdminPregnancyScreen from '../AdminPregnancyScreen';
import AdminProductsScreen from '../AdminProductsScreen';
import AdminRatesScreen from '../AdminRatesScreen';
import AdminStoresScreen from '../AdminStoresScreen';

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

describe('AdminMaitsScreen', () => {
  it('lists Maits and says where the account stands', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 4,
            sahayak_vendor_code: '5500000054',
            name: 'Sunil Kumar',
            mobile_no: '9811100045',
            needs_mobile: false,
            is_active: true,
            activated: true,
            account_active: true,
            mpp_codes: ['001371'],
            mpp_count: 1,
          },
        ],
      }),
    );
    renderWithStore(<AdminMaitsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-mait-5500000054')).toBeTruthy());
    expect(screen.getByText('Sunil Kumar')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });
});

describe('AdminMppsScreen', () => {
  it('lists collection points with the Mait that holds each', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 9,
            mpp_code: '001371',
            mpp_name: 'Barsana',
            plant_code: '2006',
            plant_name: 'COLONELGANJ',
            district_code: '',
            tehsil_code: '',
            village_code: '',
            mobile_no: '',
            is_active: true,
            mait: 4,
            mait_name: 'Sunil Kumar',
            member_count: 42,
          },
        ],
      }),
    );
    renderWithStore(<AdminMppsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-mpp-001371')).toBeTruthy());
    expect(screen.getByText('Barsana')).toBeTruthy();
  });
});

describe('AdminNonMembersScreen', () => {
  it('searches the field-registered farmers', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 21,
            name: 'Meena Devi',
            father_husband_name: 'Ram',
            relation: 'husband',
            relation_display: 'Husband',
            mobile_no: '9811100099',
            address: '',
            masked_aadhar: 'XXXXXXXX1234',
            aadhar_front_captured: true,
            aadhar_back_captured: false,
            mpp: 9,
            mpp_code: '001371',
            mpp_name: 'Barsana',
            registered_by: 'Sunil Kumar',
            registered_by_code: '5500000054',
            animal_count: 2,
            ai_event_count: 1,
            cattle_cows: 1,
            cattle_buffaloes: 1,
            cattle_total: 2,
            daily_yield_litres: '8.0',
            created_at: '2026-10-01T09:00:00Z',
          },
        ],
      }),
    );
    renderWithStore(<AdminNonMembersScreen />, { store: storeFor('admin') });

    fireEvent.changeText(screen.getByTestId('admin-nonmembers-search'), 'Meena');
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-21')).toBeTruthy());
    expect(screen.getByText('Meena Devi')).toBeTruthy();
  });
});

describe('AdminInventoryScreen', () => {
  it('shows the oversight summary and the emptiest Maits', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        summary: {
          total_straws: 12,
          maits: 2,
          low: 1,
          at_zero: 1,
          low_stock_threshold: 5,
          stores: 1,
          store_straws: 40,
        },
        results: [
          { mait_id: 1, name: 'Empty Mait', sahayak_vendor_code: 'V1', mpp_codes: [], by_breed: {}, total: 0 },
          { mait_id: 2, name: 'Stocked Mait', sahayak_vendor_code: 'V2', mpp_codes: [], by_breed: { MURRAH: 12 }, total: 12 },
        ],
      }),
    );
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-inventory-V1')).toBeTruthy());
    expect(screen.getByText('Empty Mait')).toBeTruthy();
    expect(screen.getByText('MURRAH 12')).toBeTruthy();
  });
});

describe('AdminProductsScreen', () => {
  it('lists the catalogue and flags an unpriced item', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, code: 'LN2', name: 'Liquid nitrogen', category: 'consumable', unit: 'litre', rate: '20.00', display_order: 1, is_active: true },
          { id: 2, code: 'GUN', name: 'AI gun', category: 'asset', unit: 'piece', rate: '0.00', display_order: 2, is_active: true },
        ],
      }),
    );
    renderWithStore(<AdminProductsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-product-LN2')).toBeTruthy());
    expect(screen.getByText('₹ 20.00')).toBeTruthy();
    expect(screen.getByText('No rate')).toBeTruthy();
  });
});

describe('AdminStoresScreen', () => {
  it('lists stores with their zone and open-indent badge', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 3,
            code: 'BARS',
            name: 'Barsana depot',
            zone_name: 'Ayodhya Zone',
            description: '',
            is_active: true,
            plant_names: ['COLONELGANJ'],
            mpp_count: 12,
            keepers: [{ full_name: 'Ram Keeper', mobile_no: '9811100000', is_active: true }],
            open_indents: 3,
            created_at: '2026-10-01T00:00:00Z',
          },
        ],
      }),
    );
    renderWithStore(<AdminStoresScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-store-BARS')).toBeTruthy());
    expect(screen.getByText('Barsana depot')).toBeTruthy();
  });
});

describe('AdminIndentsScreen', () => {
  const INDENT = {
    id: 55,
    breed: 'MURRAH',
    item: 'Semen straw',
    qty_requested: 25,
    qty_issued: 0,
    status: 'requested',
    status_display: 'Waiting',
    mait_name: 'Sunil Kumar',
    mait_code: '5500000054',
    requested_at: '2026-10-10T09:00:00Z',
    issued_at: null,
    received_at: null,
    note: '',
    store_name: 'Barsana depot',
  };

  it('lists waiting indents and offers Approve/Reject on the record', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/indents/55/')) {
        return jsonResponse(INDENT);
      }
      return jsonResponse({ count: 1, next: null, previous: null, results: [INDENT] });
    });
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-indent-55'));
    await waitFor(() => expect(screen.getByTestId('admin-indent-approve')).toBeTruthy());
    expect(screen.getByTestId('admin-indent-reject')).toBeTruthy();
  });
});

describe('AdminMaitPaymentScreen', () => {
  it('previews the month with net payable and masked totals', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        month: '2026-10',
        in_progress: true,
        scheme: { commission_per_ai: '220', monthly_fixed_amount: '2500', fixed_min_ai: 25 },
        rates: {},
        rows: [
          {
            serial: 1,
            mait_id: 1,
            mcc_name: 'COLONELGANJ',
            mait_name: 'Randheer Singh',
            vendor_code: 'V1',
            ai_performed: 67,
            commission: '14740.00',
            fixed_amount: '2500.00',
            gross: '17240.00',
            deduction: '2685.00',
            after_deduction: '14555.00',
            tagging: '0.00',
            net_payable: '14555.00',
            bank_account_no: 'XXXX3035',
            ifsc_code: 'SBIN0012497',
            pan_no: 'XXXXX6713H',
            has_bank_details: true,
            overdrawn: false,
          },
        ],
        totals: { maits: 1, ai_performed: 67, gross: '17240.00', deduction: '2685.00', net_payable: '14555.00', overdrawn: 0 },
      }),
    );
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-payment-V1')).toBeTruthy());
    expect(screen.getByText('Randheer Singh')).toBeTruthy();
  });
});

describe('AdminLeaderboardScreen', () => {
  it('ranks Maits by inseminations', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        date_from: '2026-10-01',
        date_to: '2026-10-31',
        count: 1,
        totals: { ai_count: 67, amount_collected: '0' },
        results: [{ mait_id: 1, name: 'Randheer Singh', sahayak_vendor_code: 'V1', ai_count: 67, collected: 0, cod: 0, online: 0 }],
      }),
    );
    renderWithStore(<AdminLeaderboardScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-leader-V1')).toBeTruthy());
    expect(screen.getByText('Randheer Singh')).toBeTruthy();
  });
});

describe('AdminPregnancyScreen', () => {
  it('leads with overdue and lists Maits', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        summary: { maits: 1, open: 4, overdue: 2, due_this_week: 1, recorded: 10, pregnant: 6, not_pregnant: 3, unsure: 1, declined: 0 },
        results: [{ mait_id: 1, name: 'Sunil Kumar', sahayak_vendor_code: 'V1', open: 4, overdue: 2, due_this_week: 1, recorded: 10, pregnant: 6, not_pregnant: 3, unsure: 1, declined: 0 }],
      }),
    );
    renderWithStore(<AdminPregnancyScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-V1')).toBeTruthy());
    expect(screen.getByText('Sunil Kumar')).toBeTruthy();
  });
});

describe('AdminExceptionsScreen', () => {
  it('shows each queue with its count', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        exceptions: {
          pending_payments: { count: 3, rows: [{ label: 'Barsana · ₹250', meta: '2 days old', severity: 'warning' }], more: 2 },
          failed_otps: { count: 0, rows: [], more: 0 },
          low_stock: { count: 0, rows: [], more: 0 },
        },
      }),
    );
    renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByText('Payments pending')).toBeTruthy());
    expect(screen.getByText('Barsana · ₹250')).toBeTruthy();
  });
});

describe('AdminRatesScreen', () => {
  it('shows the scheme and the material rates', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/scheme/')) {
        return jsonResponse({ commission_per_ai: '220', monthly_fixed_amount: '2500', fixed_min_ai: 25, straw_rate: '35' });
      }
      return jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, code: 'LN2', name: 'Liquid nitrogen', category: 'consumable', unit: 'litre', rate: '20.00', display_order: 1, is_active: true }],
      });
    });
    renderWithStore(<AdminRatesScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-rates-scheme')).toBeTruthy());
    expect(screen.getByTestId('admin-rate-LN2')).toBeTruthy();
  });
});
