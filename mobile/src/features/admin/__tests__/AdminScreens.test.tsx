/**
 * The admin screens (Rounds 2–3 — AI events, Members, Maits, MPPs, Non-members).
 *
 * What is under test is what an office account would act on wrongly if it were wrong: that each
 * roster renders what the server returns; that AI events carries the set-wide counts; and that
 * the one irreversible action, delete, is offered to an admin and withheld from a Normal User
 * (the server enforces it too, but the button must not even appear).
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import i18n from '@/i18n';
import { colors } from '@theme/tokens';
import { loggedIn } from '@/features/auth/authSlice';
import type { UserRole } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';
import { downloadAndShare } from '@api/files';

// The share sheet is the phone's; what is under test is which file was asked for.
jest.mock('@api/files', () => ({
  downloadAndShare: jest.fn(async () => undefined),
  XLSX_MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}));

import AdminAssignmentScreen from '../AdminAssignmentScreen';
import AdminAuditScreen, { auditParams, auditTone } from '../AdminAuditScreen';
import AdminDashboardScreen from '../AdminDashboardScreen';
import AdminEventsScreen from '../AdminEventsScreen';
import AdminExceptionsScreen from '../AdminExceptionsScreen';
import AdminIndentsScreen from '../AdminIndentsScreen';
import AdminInventoryScreen from '../AdminInventoryScreen';
import AdminLeaderboardScreen, { presetRange } from '../AdminLeaderboardScreen';
import AdminMaitPaymentScreen, { monthChoices } from '../AdminMaitPaymentScreen';
import AdminMaitsScreen from '../AdminMaitsScreen';
import AdminMembersScreen from '../AdminMembersScreen';
import AdminMppsScreen from '../AdminMppsScreen';
import AdminOtpPipelineScreen from '../AdminOtpPipelineScreen';
import { ADMIN_SECTIONS } from '../sections';
import AdminNonMembersScreen from '../AdminNonMembersScreen';
import AdminPregnancyScreen from '../AdminPregnancyScreen';
import AdminProductsScreen from '../AdminProductsScreen';
import AdminRatesScreen from '../AdminRatesScreen';
import AdminReportsScreen from '../AdminReportsScreen';
import AdminStoresScreen from '../AdminStoresScreen';
import AdminSuperOtpScreen, { matches } from '../AdminSuperOtpScreen';
import type { SuperOtpRow } from '@api/types';
import AdminUploadsScreen from '../AdminUploadsScreen';
import AdminUsersScreen from '../AdminUsersScreen';
import AdminZonesScreen, { relative } from '../AdminZonesScreen';

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
    // The split is the server's summary, not the page length.
    expect(screen.getByTestId('admin-events-note').props.children).toBe(
      '1 matching · 1 completed · showing 1',
    );
    expect(screen.getByTestId('admin-events-count').props.children).toBe('1 event');
  });

  it('switches between cards and the portal table, every column', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    await screen.findByTestId('admin-event-7');
    fireEvent.press(screen.getByTestId('admin-events-view-rows'));

    expect(await screen.findByTestId('admin-event-row-7')).toBeTruthy();
    expect(screen.queryByTestId('admin-event-7')).toBeNull();
    for (const column of ['Event', 'Farmer', 'Mait', 'Animal', 'Payment', 'Captured', 'Status']) {
      expect(screen.getByText(column)).toBeTruthy();
    }

    fireEvent.press(screen.getByTestId('admin-events-view-cards'));
    expect(await screen.findByTestId('admin-event-7')).toBeTruthy();
  });

  it('asks the server for the unfinished set, and an MPP, by name', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });
    await screen.findByTestId('admin-event-7');

    fireEvent.press(screen.getByTestId('admin-events-filter-unfinished'));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes('/ai-events/') && u.includes('unfinished=true'))).toBe(true);
    });
    expect(screen.getByTestId('admin-events-clear')).toBeTruthy();
  });

  it('ticks events for an admin and offers to delete them together', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-event-pick-7'));
    expect(screen.getByTestId('admin-events-bulk')).toBeTruthy();
    expect(screen.getByText('Delete 1')).toBeTruthy();
  });

  it('gives a Normal User no ticks and no Complete', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        ...PAGE,
        results: [
          {
            ...EVENT,
            status: 'payment_pending',
            payment: {
              amount: '100.00',
              mode_display: 'Deduction',
              status: 'verified',
              is_verified: true,
            },
          },
        ],
      }),
    );
    renderWithStore(<AdminEventsScreen />, { store: storeFor('normal_user') });

    await screen.findByTestId('admin-event-7');
    expect(screen.queryByTestId('admin-event-pick-7')).toBeNull();
    expect(screen.queryByTestId('admin-event-complete-7')).toBeNull();
  });

  it('offers Complete on a stuck member capture whose deduction has landed', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        ...PAGE,
        results: [
          {
            ...EVENT,
            status: 'payment_pending',
            payment: {
              amount: '100.00',
              mode_display: 'Deduction',
              status: 'verified',
              is_verified: true,
            },
          },
        ],
      }),
    );
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    expect(await screen.findByTestId('admin-event-complete-7')).toBeTruthy();
    expect(screen.getByText('₹ 100 Deduction')).toBeTruthy();
  });

  it('offers delete to an admin on the record', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-event-7'));
    await waitFor(() => expect(screen.getByTestId('admin-event-delete')).toBeTruthy());
  });

  it('opens the portal’s record: the figures, the farmer, the trail', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/ai-events/7/timeline/')) {
        return jsonResponse([
          {
            id: 11,
            from_status: 'payment_pending',
            to_status: 'completed',
            note: 'Insemination completed',
            actor_name: 'Sunil Kumar',
            created_at: '2026-10-10T09:05:00Z',
          },
        ]);
      }
      if (url.includes('/ai-events/7/')) {
        return jsonResponse({
          ...EVENT,
          animal_type: 'BUFF',
          stock_deducted: true,
          consumables: [{ code: 'GLV', name: 'Gloves', unit: 'pair', qty: 1 }],
          pregnancy_checks: [],
          owner_detail: {
            type: 'member',
            name: 'Kavita Devi',
            code: 'MEM-001',
            mobile_no: '9811100045',
            father_husband_name: 'Ramesh',
            aadhar_masked: 'XXXX-XXXX-1234',
            has_aadhar: true,
          },
          animal_detail: null,
        });
      }
      return jsonResponse(PAGE);
    });
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-event-7'));

    expect(await screen.findByTestId('admin-event-hero')).toBeTruthy();
    expect(screen.getByText('Event 7')).toBeTruthy();
    expect(screen.getByTestId('admin-event-straw')).toBeTruthy();
    expect(screen.getByTestId('admin-event-payment')).toBeTruthy();
    expect(screen.getByText('9811100045')).toBeTruthy();
    expect(screen.getByText('XXXX-XXXX-1234')).toBeTruthy();
    expect(screen.getByText('Gloves')).toBeTruthy();
    expect(await screen.findByTestId('admin-event-step-11')).toBeTruthy();
    expect(screen.getByText('Insemination completed')).toBeTruthy();
  });

  it('washes each card in its state and splits the filters left and right', async () => {
    mockEvents();
    renderWithStore(<AdminEventsScreen />, { store: storeFor('admin') });

    const card = await screen.findByTestId('admin-event-7');
    expect(card).toHaveStyle({ backgroundColor: colors.primaryWash });

    const left = screen.getByTestId('admin-events-filters-left');
    const right = screen.getByTestId('admin-events-filters-right');
    expect(within(left).getByTestId('admin-events-filter-mpp')).toBeTruthy();
    expect(within(left).getByTestId('admin-events-filter-status')).toBeTruthy();
    expect(within(right).getByTestId('admin-events-filter-unfinished')).toBeTruthy();
    expect(within(right).getByTestId('admin-events-filter-dates')).toBeTruthy();
    // Two stacked pairs pushed to either end: a pill at each end of every row.
    expect(left).not.toHaveStyle({ flexDirection: 'row' });
    expect(right).not.toHaveStyle({ flexDirection: 'row' });
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

  const ADMIN_ROW = {
    ...MEMBER,
    id: 1,
    father_husband_name: 'Ramesh',
    activation_status: 'Yes',
    aadhar_masked: 'XXXXXXXX9012',
    mobile_source: 'office',
    mobile_updated_at: '2026-10-20T05:00:00Z',
    mobile_updated_by_name: 'Office Admin',
  };
  const STRANDED = {
    ...MEMBER,
    id: 2,
    member_code: 'MEM-002',
    member_name: 'Asha Devi',
    father_husband_name: '',
    mobile_no: '',
    activation_status: 'Yes',
    aadhar_masked: '',
    mobile_source: 'sap',
  };

  function mockMembers(sent: { url: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (typeof input === 'string' ? 'GET' : input.method) || 'GET';
      if (url.includes('/aadhaar/')) {
        return jsonResponse({ member_code: 'MEM-001', aadhar_no: '123456789012', on_file: true });
      }
      if (url.includes('/mobile-history/')) {
        return jsonResponse({
          results: [
            {
              when: '2026-10-20T05:00:00Z',
              by: 'Office Admin',
              before: '9811100000',
              after: '9811100045',
              reason: 'SAP had the wrong number',
            },
          ],
        });
      }
      if (url.includes('/mobile/') && method === 'POST') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ url, body });
        return jsonResponse({
          member: { ...ADMIN_ROW, mobile_no: '9876543210' },
          shared_with: [],
        });
      }
      return jsonResponse({ count: 2, next: null, previous: null, results: [ADMIN_ROW, STRANDED] });
    });
  }

  it('masks the Aadhaar, washes a member with no number red, and marks an office number', async () => {
    mockMembers();
    renderWithStore(<AdminMembersScreen />, { store: storeFor('admin') });

    expect(await screen.findByTestId('admin-member-MEM-001')).toBeTruthy();
    expect(screen.getByText('Aadhaar is masked until you ask for it')).toBeTruthy();
    expect(screen.getByTestId('admin-member-aadhaar-masked').props.children).toBe('XXXX XXXX 9012');
    expect(screen.getByText('98111 00045')).toBeTruthy();
    expect(screen.getByText('Office')).toBeTruthy();
    expect(screen.getByTestId('admin-member-MEM-002')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByText('Unusable')).toBeTruthy();
    expect(screen.getByText('Add number')).toBeTruthy();
    expect(screen.getByTestId('admin-members-unusable')).toBeTruthy();
  });

  it('shows the full Aadhaar on request and masks it again after thirty seconds', async () => {
    mockMembers();
    renderWithStore(<AdminMembersScreen />, { store: storeFor('admin') });
    await screen.findByTestId('admin-member-MEM-001');

    jest.useFakeTimers();
    try {
      fireEvent.press(screen.getByTestId('admin-member-reveal-MEM-001'));
      await waitFor(() =>
        expect(screen.getByTestId('admin-member-aadhaar-full').props.children).toBe(
          '1234 5678 9012',
        ),
      );
      expect(screen.getByText('masks in 30s')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.queryByTestId('admin-member-aadhaar-full')).toBeNull();
      expect(screen.getByTestId('admin-member-aadhaar-masked')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks the server for members with no number by name', async () => {
    mockMembers();
    renderWithStore(<AdminMembersScreen />, { store: storeFor('admin') });
    await screen.findByTestId('admin-member-MEM-001');

    fireEvent.press(screen.getByTestId('admin-members-filter-no-mobile'));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes('no_mobile=true'))).toBe(true);
    });
  });

  it('changes a number only with a reason, saying what saving will do first', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockMembers(sent);
    renderWithStore(<AdminMembersScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-member-change-MEM-001'));
    expect(await screen.findByText('Changes by the office')).toBeTruthy();
    expect(await screen.findByText('“SAP had the wrong number”', { exact: false })).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('admin-member-phone-new'), '12345');
    expect(screen.getByText('That is not a 10-digit Indian mobile number.')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('admin-member-phone-new'), '98765 43210');
    expect(screen.getByText('Say why it is changing — it is kept in the audit log.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-member-phone-save'));
    expect(sent).toHaveLength(0);

    fireEvent.press(screen.getByTestId('admin-member-reason-reasonRang'));
    expect(screen.getByText(/98111 00045 → 98765 43210 for Kavita Devi/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-member-phone-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toMatch(/\/members\/MEM-001\/mobile\/$/);
    expect(sent[0]?.body).toEqual({
      mobile_no: '9876543210',
      reason: 'The member rang the office',
      expected_mobile: '9811100045',
    });
    expect(await screen.findByTestId('admin-members-flash')).toBeTruthy();
  });

  it('gives a Normal User no way to change a number', async () => {
    mockMembers();
    renderWithStore(<AdminMembersScreen />, { store: storeFor('normal_user') });

    await screen.findByTestId('admin-member-MEM-001');
    expect(screen.queryByTestId('admin-member-change-MEM-001')).toBeNull();
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

  const STRANDED = {
    id: 5,
    sahayak_vendor_code: '5500000091',
    name: 'Ramesh Kumar',
    mobile_no: '',
    needs_mobile: true,
    is_active: true,
    activated: false,
    account_active: null,
    mpp_codes: ['001302', '001303'],
    mpp_count: 2,
  };

  function mockRoster(sent: { method: string; url: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (typeof input === 'string' ? 'GET' : input.method) || 'GET';
      if (method !== 'GET') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ method, url, body });
        if (url.includes('/activate-mait/')) {
          return jsonResponse({ id: 77, full_name: 'Ramesh Kumar' }, 201);
        }
        return jsonResponse({ ...STRANDED, mpp_codes: ['001302'], mpp_count: 1 });
      }
      if (url.includes('/mpp/')) {
        return jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 9,
              mpp_code: '001400',
              mpp_name: 'BAROLI',
              village_code: 'V12',
              tehsil_code: 'T3',
              is_active: true,
              mait: 4,
              mait_name: 'Sunil Kumar',
              mait_code: '5500000054',
              member_count: 120,
            },
          ],
        });
      }
      if (url.includes('/pending-maits/')) {
        return jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              sahayak_vendor_code: '5500000091',
              name: 'Ramesh Kumar',
              mobile_no: '',
              needs_mobile: true,
              mpp_count: 2,
            },
          ],
          summary: { pending_total: 1, without_mobile: 1 },
        });
      }
      if (url.includes('/admin/users/?') || url.endsWith('/admin/users/')) {
        return jsonResponse({ count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [STRANDED],
        summary: { total: 2, activated: 1, without_mobile: 1, deactivated: 0 },
      });
    });
  }

  it('says how big the backlog is, washes a stranded Mait red, and filters by name', async () => {
    mockRoster();
    renderWithStore(<AdminMaitsScreen />, { store: storeFor('admin') });

    expect(await screen.findByTestId('admin-maits-backlog')).toBeTruthy();
    expect(screen.getByText('One Mait has no mobile number')).toBeTruthy();
    expect(screen.getByTestId('admin-mait-5500000091')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getAllByText('Needs mobile').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('admin-maits-filter-needs-mobile'));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes('needs_mobile=true'))).toBe(true);
    });
  });

  it('edits a Mait: suggestions say who holds an MPP, and unassigning asks first', async () => {
    const sent: { method: string; url: string; body: unknown }[] = [];
    mockRoster(sent);
    const alert = jest.spyOn(require('react-native').Alert, 'alert');
    renderWithStore(<AdminMaitsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-mait-edit-5500000091'));
    expect(screen.getByTestId('admin-mait-editor')).toBeTruthy();
    expect(screen.getByTestId('admin-mait-mpp-count').props.children).toBe(2);

    fireEvent.changeText(screen.getByTestId('admin-mait-add'), 'BAROLI');
    expect(await screen.findByTestId('admin-mait-suggest-001400')).toBeTruthy();
    expect(screen.getByText('Already assigned to Sunil Kumar · 5500000054')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-mait-chip-remove-001303'));
    expect(screen.getByText('unassigning 001303')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-mait-save'));
    expect(alert).toHaveBeenCalled();
    const buttons = (alert.mock.calls[0]?.[2] ?? []) as { onPress?: () => void }[];
    buttons[1]?.onPress?.();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.url).toMatch(/\/admin\/users\/maits\/5500000091\/$/);
    expect(sent[0]?.body).toMatchObject({ mpp_codes: ['001302'] });
    expect(await screen.findByTestId('admin-maits-flash')).toBeTruthy();
    alert.mockRestore();
  });

  it('activates a pending Mait only once the number is typed twice and matches', async () => {
    const sent: { method: string; url: string; body: unknown }[] = [];
    mockRoster(sent);
    renderWithStore(<AdminMaitsScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-maits-activate'));
    fireEvent.press(await screen.findByTestId('admin-mait-pending-5500000091'));
    expect(screen.getByText('2 MPPs assigned in SAP')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('admin-mait-activate-mobile'), '9876543210');
    fireEvent.changeText(screen.getByTestId('admin-mait-activate-confirm'), '9876543211');
    expect(screen.getByText('These do not match')).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-mait-activate-submit'));
    expect(sent).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId('admin-mait-activate-confirm'), '9876543210');
    expect(screen.getByText('Matches')).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-mait-activate-submit'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ sahayak_vendor_code: '5500000091', mobile_no: '9876543210' });
    expect(await screen.findByTestId('admin-mait-activated')).toBeTruthy();
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

const NON_MEMBER = {
  id: 21,
  name: 'Meena Devi',
  father_husband_name: 'Ram',
  relation: 'husband',
  relation_display: 'Husband',
  mobile_no: '9811100099',
  address: 'Ward 4, Barsana',
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
  cattle_cows: 3,
  cattle_buffaloes: 1,
  cattle_total: 4,
  daily_yield_litres: '8.0',
  consent_captured_at: '2026-10-01T09:00:00Z',
  created_at: '2026-10-01T09:00:00Z',
};

describe('AdminNonMembersScreen', () => {
  const page = (results: object[], count = results.length) =>
    jsonResponse({ count, next: null, previous: null, results });

  it('lists the field registrations with their card, consent and herd', async () => {
    const noConsent = {
      ...NON_MEMBER,
      id: 22,
      name: 'Kamla',
      mobile_no: '',
      aadhar_front_captured: false,
      consent_captured_at: null,
      cattle_total: null,
    };
    (global.fetch as jest.Mock).mockImplementation(async () => page([NON_MEMBER, noConsent], 40));
    renderWithStore(<AdminNonMembersScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-nonmember-21')).toBeTruthy());
    expect(screen.getByTestId('admin-nonmembers-count')).toHaveTextContent(
      '40 farmers registered by Maits in the field',
    );
    expect(screen.getByTestId('admin-nonmembers-notice')).toBeTruthy();
    // Counted from the page: both are missing a face, one never consented.
    expect(screen.getByTestId('admin-nonmembers-tile-no-card-value')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-nonmembers-tile-no-consent-value')).toHaveTextContent('1');

    const meena = within(screen.getByTestId('admin-nonmember-21'));
    expect(meena.getByText('Front only')).toBeTruthy();
    expect(meena.getByText('Husband: Ram')).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-mobile-21')).toHaveTextContent('98111 00099');
    expect(screen.getByTestId('admin-nonmember-herd-21')).toHaveTextContent('4');

    // No consent tints the whole card red, and no number says so in red.
    expect(screen.getByTestId('admin-nonmember-22')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    const kamla = within(screen.getByTestId('admin-nonmember-22'));
    expect(kamla.getByText('No consent')).toBeTruthy();
    expect(kamla.getByText('Card missing')).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-mobile-22')).toHaveTextContent('No number');
    expect(screen.getByTestId('admin-nonmember-herd-22')).toHaveTextContent('—');
    expect(screen.getByTestId('admin-nonmembers-pager')).toBeTruthy();
  });

  it('narrows to the rows with no card, and pages', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => page([NON_MEMBER], 60));
    renderWithStore(<AdminNonMembersScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-21')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-nonmembers-filter-no-card'));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes('/admin/non-members/') && u.includes('no_card=true'))).toBe(
        true,
      );
    });

    await waitFor(() => expect(screen.getByTestId('admin-nonmembers-next')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-nonmembers-next'));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes('offset=25'))).toBe(true);
    });
  });

  it('opens her record: card, consent, herd, payments and facts', async () => {
    const detail = {
      ...NON_MEMBER,
      aadhar_front_url: '/media/aadhaar/front.jpg',
      aadhar_back_url: '',
      animals: [
        {
          id: 7,
          owner_type: 'non_member',
          member: null,
          non_member: 21,
          owner_name: 'Meena Devi',
          animal_type: 'COW',
          animal_type_display: 'Cow',
          breed: 'Sahiwal',
          ear_tag_no: 'T-77',
          photo_url: '',
          ai_event_count: 1,
          last_ai_at: '2026-10-05T08:00:00Z',
          created_at: '2026-10-01T09:00:00Z',
        },
      ],
      payments: [
        {
          ai_event: 501,
          amount: '300.00',
          mode: 'ONLINE',
          mode_display: 'Online',
          status: 'verified',
          status_display: 'Verified',
          is_verified: true,
          utr_number: 'UTR998877',
          payment_screenshot_url: '/media/proof/501.jpg',
          created_at: '2026-10-05T08:30:00Z',
        },
        {
          ai_event: 502,
          amount: '250.00',
          mode: 'CASH',
          mode_display: 'Cash',
          status: 'pending',
          status_display: '',
          is_verified: false,
          utr_number: '',
          payment_screenshot_url: '',
          created_at: '2026-10-06T08:30:00Z',
        },
      ],
    };
    (global.fetch as jest.Mock).mockImplementation(async (req: { url?: string }) =>
      String(req.url ?? req).includes('/admin/non-members/21/')
        ? jsonResponse(detail)
        : page([NON_MEMBER]),
    );
    renderWithStore(<AdminNonMembersScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-21')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-nonmember-21'));
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-card-panel')).toBeTruthy());

    expect(screen.getByTestId('admin-nonmember-meta')).toHaveTextContent(/by Sunil Kumar/);
    const cardTile = within(screen.getByTestId('admin-nonmember-tile-card'));
    expect(cardTile.getByText('Front only')).toBeTruthy();
    expect(cardTile.getByText('Ask her Mait for the back')).toBeTruthy();
    expect(
      within(screen.getByTestId('admin-nonmember-tile-consent')).getByText('Given'),
    ).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-tile-herd-value')).toHaveTextContent('4');
    expect(screen.getByText('3 cow · 1 buffalo')).toBeTruthy();
    expect(screen.getByText('1 of 2 faces')).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-back-face-empty')).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-masked')).toHaveTextContent('XXXXXXXX1234');
    expect(screen.getByTestId('admin-nonmember-animal-7')).toBeTruthy();

    // Online carries its UTR and screenshot; cash says there was never anything to keep.
    expect(screen.getByTestId('admin-nonmember-utr-501')).toHaveTextContent('UTR998877');
    expect(screen.getByText('Cash — code only')).toBeTruthy();
    expect(screen.getByText('2 · 1 paid online')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();

    // The card opens over the record, with only the face that is on file.
    fireEvent.press(screen.getByTestId('admin-nonmember-front'));
    expect(screen.getByTestId('admin-nonmember-viewer-caption')).toHaveTextContent(
      'Front of the Aadhaar card',
    );
    expect(screen.queryByTestId('admin-nonmember-viewer-next')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-nonmember-viewer-close'));

    fireEvent.press(screen.getByTestId('admin-nonmember-proof-501'));
    expect(screen.getByTestId('admin-nonmember-viewer-caption')).toHaveTextContent(/UTR UTR998877/);
    fireEvent.press(screen.getByTestId('admin-nonmember-viewer-close'));

    fireEvent.press(screen.getByTestId('admin-nonmember-back'));
    await waitFor(() => expect(screen.getByTestId('admin-nonmembers')).toBeTruthy());
  });

  it('hides payments and says "not asked" when there is nothing to show', async () => {
    const detail = {
      ...NON_MEMBER,
      aadhar_front_captured: false,
      cattle_total: 0,
      cattle_cows: 0,
      cattle_buffaloes: 0,
      daily_yield_litres: null,
      consent_captured_at: null,
      aadhar_front_url: '',
      aadhar_back_url: '',
      animals: [],
      payments: [],
    };
    (global.fetch as jest.Mock).mockImplementation(async (req: { url?: string }) =>
      String(req.url ?? req).includes('/admin/non-members/21/')
        ? jsonResponse(detail)
        : page([NON_MEMBER]),
    );
    renderWithStore(<AdminNonMembersScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-21')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-nonmember-21'));
    await waitFor(() => expect(screen.getByTestId('admin-nonmember-card-panel')).toBeTruthy());

    expect(screen.queryByTestId('admin-nonmember-payments')).toBeNull();
    expect(
      within(screen.getByTestId('admin-nonmember-tile-herd')).getByText('Not asked'),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('admin-nonmember-tile-consent')).getByText('Not on record'),
    ).toBeTruthy();
    expect(screen.getByTestId('admin-nonmember-card-panel')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByText('No animals registered to her yet.')).toBeTruthy();
  });
});

describe('AdminInventoryScreen', () => {
  const OVERSIGHT = {
    summary: {
      total_straws: 15,
      maits: 3,
      low: 1,
      at_zero: 1,
      low_stock_threshold: 5,
      stores: 1,
      store_straws: 40,
    },
    results: [
      {
        mait_id: 1,
        name: 'Empty Mait',
        sahayak_vendor_code: 'V1',
        mpp_codes: [],
        by_breed: {},
        total: 0,
      },
      {
        mait_id: 3,
        name: 'Low Mait',
        sahayak_vendor_code: 'V3',
        mpp_codes: ['001371'],
        by_breed: { SAHIWAL: 3 },
        total: 3,
      },
      {
        mait_id: 2,
        name: 'Stocked Mait',
        sahayak_vendor_code: 'V2',
        mpp_codes: ['001302', '001303', '001304'],
        by_breed: { MURRAH: 12 },
        total: 12,
      },
    ],
    stores: [
      {
        id: 5,
        code: 'ST-01',
        name: 'Barsana Store',
        zone_name: 'Mathura',
        plant_names: ['Barsana BMC'],
        lines: [
          {
            product_type: 'straw',
            breed: 'MURRAH',
            product_ref_id: null,
            item_name: 'Murrah',
            item_name_hi: '',
            unit: '',
            on_hand: 40,
            set_aside: 10,
            available: 30,
            category: 'straw',
          },
        ],
        straws_on_hand: 40,
        straws_set_aside: 10,
        open_indents: 2,
      },
    ],
  };

  const CATALOGUE = {
    breeds: [
      { code: 'MURRAH', name: 'Murrah', animal_type: 'BUFF' },
      { code: 'SAHIWAL', name: 'Sahiwal', animal_type: 'COW' },
    ],
    products: [{ id: 9, code: 'GLV', name: 'Gloves', unit: 'pair', category: 'consumable' }],
  };

  const MAIT = {
    mait_id: 2,
    mait_name: 'Stocked Mait',
    sahayak_vendor_code: 'V2',
    total_straws: 12,
    is_low_stock: false,
    by_breed: { MURRAH: 12 },
    consumables: [{ code: 'GLV', name: 'Gloves', unit: 'pair', qty: 4 }],
    assets: [],
    catalogue: CATALOGUE,
  };

  const SHELF = {
    store: { id: 5, name: 'Barsana Store' },
    lines: OVERSIGHT.stores[0]!.lines,
    catalogue: CATALOGUE,
  };

  function mockInventory(sent: { url: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      const body = async () => {
        try {
          return await input.clone().json();
        } catch {
          return null;
        }
      };
      if (url.includes('/admin/zones/')) {
        return jsonResponse({ count: 0, next: null, previous: null, results: [] });
      }
      if (url.includes('/admin/inventory/2/')) {
        if (method === 'POST') {
          sent.push({ url, body: await body() });
          return jsonResponse({ ...MAIT, by_breed: { MURRAH: 17 }, total_straws: 17 });
        }
        return jsonResponse(MAIT);
      }
      if (url.includes('/admin/stores/5/stock/')) {
        if (method === 'POST') {
          sent.push({ url, body: await body() });
          return jsonResponse({
            ...SHELF,
            lines: [{ ...SHELF.lines[0], on_hand: 35, available: 25 }],
          });
        }
        return jsonResponse(SHELF);
      }
      return jsonResponse(OVERSIGHT);
    });
  }

  it('shows the summary, and the Maits emptiest first in their colours', async () => {
    mockInventory();
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-inventory-V1')).toBeTruthy());
    expect(screen.getByTestId('admin-inventory-meta')).toHaveTextContent(
      'Stock in the hands of 3 Maits and on 1 store shelf',
    );
    expect(screen.getByTestId('admin-inventory-tile-zero-value')).toHaveTextContent('1');
    expect(screen.getByTestId('admin-inventory-tile-stores-value')).toHaveTextContent('40');
    expect(screen.getByTestId('admin-inventory-tile-breeds-value')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-inventory-V1')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('admin-inventory-V3')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-inventory-V2')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    // Every breed is written on every card, zeros included.
    expect(within(screen.getByTestId('admin-inventory-V2')).getByText('MURRAH 12')).toBeTruthy();
    expect(within(screen.getByTestId('admin-inventory-V2')).getByText('SAHIWAL 0')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('admin-inventory-search'), '001371');
    expect(screen.queryByTestId('admin-inventory-V1')).toBeNull();
    expect(screen.getByTestId('admin-inventory-V3')).toBeTruthy();
  });

  it('switches to the store shelves with the Stores pill', async () => {
    mockInventory();
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-inventory-tab-stores')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-inventory-tab-stores'));
    expect(screen.queryByTestId('admin-inventory-V1')).toBeNull();
    const card = within(screen.getByTestId('admin-inventory-store-ST-01'));
    expect(card.getByText('Barsana BMC')).toBeTruthy();
    expect(screen.getByTestId('admin-inventory-store-shelf-ST-01')).toHaveTextContent('40 Murrah');
    expect(card.getByText('10')).toBeTruthy();
    expect(card.getByText('2')).toBeTruthy();
  });

  it('adds stock to a Mait and says what saving will do first', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockInventory(sent);
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-inventory-V2')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-inventory-V2'));
    await waitFor(() => expect(screen.getByTestId('admin-inventory-adjust')).toBeTruthy());
    expect(screen.getByTestId('admin-inventory-mait-count')).toHaveTextContent(/12 straws/);
    expect(screen.getByTestId('admin-inventory-holding-consumable')).toHaveTextContent(/Gloves/);

    fireEvent.press(screen.getByTestId('admin-inventory-mait-item-straw:MURRAH'));
    expect(screen.getByTestId('admin-inventory-mait-hint')).toHaveTextContent('12 held now');
    fireEvent.changeText(screen.getByTestId('admin-inventory-mait-qty'), '5');
    expect(screen.getByTestId('admin-inventory-mait-preview-text')).toHaveTextContent(
      'Murrah · Buffalo: 12 → 17 held (+5)',
    );
    fireEvent.press(screen.getByTestId('admin-inventory-mait-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      product_type: 'straw',
      breed: 'MURRAH',
      qty: 5,
      direction: 'add',
      note: '',
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-inventory-flash')).toHaveTextContent(
        /5 Murrah · Buffalo added to Stocked Mait./,
      ),
    );
  });

  it('removes stock by editing the held quantity down', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockInventory(sent);
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-inventory-V2')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-inventory-V2'));
    await waitFor(() => expect(screen.getByTestId('admin-inventory-adjust')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-inventory-dir-remove'));
    // Only what is held can be removed: Sahiwal is not offered.
    expect(screen.queryByTestId('admin-inventory-mait-item-straw:SAHIWAL')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-inventory-mait-item-straw:MURRAH'));
    expect(screen.getByTestId('admin-inventory-mait-qty').props.value).toBe('12');

    fireEvent.changeText(screen.getByTestId('admin-inventory-mait-qty'), '20');
    expect(screen.getByTestId('admin-inventory-mait-preview-text')).toHaveTextContent(
      'They hold only 12. To add more, switch to Add stock.',
    );
    fireEvent.changeText(screen.getByTestId('admin-inventory-mait-qty'), '9');
    expect(screen.getByTestId('admin-inventory-mait-preview-text')).toHaveTextContent(
      'Murrah · Buffalo: 12 → 9 held (−3)',
    );
    fireEvent.press(screen.getByTestId('admin-inventory-mait-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toMatchObject({ breed: 'MURRAH', qty: 3, direction: 'remove' });
  });

  it('corrects a store count, refusing one below what is packed', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockInventory(sent);
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-inventory-tab-stores')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-inventory-tab-stores'));
    fireEvent.press(screen.getByTestId('admin-inventory-store-open-ST-01'));
    await waitFor(() =>
      expect(screen.getByTestId('admin-inventory-correct-straw:MURRAH')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('admin-inventory-correct-straw:MURRAH'));
    expect(screen.getByTestId('admin-inventory-store-qty').props.value).toBe('40');
    fireEvent.changeText(screen.getByTestId('admin-inventory-store-qty'), '8');
    expect(screen.getByTestId('admin-inventory-store-preview-text')).toHaveTextContent(
      /10 are packed for Maits/,
    );
    fireEvent.changeText(screen.getByTestId('admin-inventory-store-qty'), '35');
    expect(screen.getByTestId('admin-inventory-store-preview-text')).toHaveTextContent(
      'Murrah · Buffalo: 40 → 35 on the shelf (−5, recorded as a correction)',
    );
    fireEvent.press(screen.getByTestId('admin-inventory-store-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      mode: 'count',
      product_type: 'straw',
      breed: 'MURRAH',
      qty: 35,
      note: '',
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-inventory-flash')).toHaveTextContent(
        /Murrah · Buffalo at Barsana Store now 35 on the shelf./,
      ),
    );
  });

  it('adds a delivery to a store shelf', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockInventory(sent);
    renderWithStore(<AdminInventoryScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-inventory-tab-stores')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-inventory-tab-stores'));
    fireEvent.press(screen.getByTestId('admin-inventory-store-open-ST-01'));
    await waitFor(() => expect(screen.getByTestId('admin-inventory-store-form')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-inventory-store-kind-consumable'));
    fireEvent.press(screen.getByTestId('admin-inventory-store-item-consumable:9'));
    expect(screen.getByTestId('admin-inventory-store-hint')).toHaveTextContent(
      'None of this on the shelf yet',
    );
    fireEvent.changeText(screen.getByTestId('admin-inventory-store-qty'), '0');
    expect(screen.getByTestId('admin-inventory-store-preview-text')).toHaveTextContent(
      'A delivery is at least one.',
    );
    fireEvent.press(screen.getByTestId('admin-inventory-store-qty-plus'));
    fireEvent.press(screen.getByTestId('admin-inventory-store-qty-plus'));
    expect(screen.getByTestId('admin-inventory-store-preview-text')).toHaveTextContent(
      'Gloves (pair): 0 → 2 on the shelf (+2)',
    );
    fireEvent.press(screen.getByTestId('admin-inventory-store-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      mode: 'receive',
      product_type: 'consumable',
      product_ref_id: 9,
      qty: 2,
      note: '',
    });
  });
});

describe('AdminProductsScreen', () => {
  const PRODUCTS = [
    {
      id: 1,
      code: 'SHEATH',
      name: 'AI sheaths',
      category: 'consumable',
      unit: 'piece',
      rate: '2.50',
      display_order: 1,
      is_active: true,
    },
    {
      id: 2,
      code: 'GLOVE',
      name: 'Gloves',
      category: 'consumable',
      unit: 'pair',
      rate: '0.00',
      display_order: 2,
      is_active: true,
    },
    {
      id: 3,
      code: 'OLDGEL',
      name: 'Old gel',
      category: 'consumable',
      unit: 'litre',
      rate: '0.00',
      display_order: 3,
      is_active: false,
    },
    {
      id: 4,
      code: 'GUN',
      name: 'AI gun',
      category: 'asset',
      unit: 'piece',
      rate: '450.00',
      display_order: 1,
      is_active: true,
    },
  ];
  const BREEDS = [
    {
      id: 7,
      code: 'SAHIWAL',
      name: 'Sahiwal',
      name_hi: 'साहीवाल',
      animal_type: 'COW',
      rate: '50.00',
      display_order: 1,
      is_active: true,
    },
  ];

  function mockCatalogue(sent: { url: string; method: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      if (method !== 'GET') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ url, method, body });
        if (method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ id: 99, name: (body as { name?: string })?.name ?? 'AI sheaths' });
      }
      if (url.includes('/admin/breeds/')) {
        return jsonResponse(BREEDS);
      }
      return jsonResponse({
        count: PRODUCTS.length,
        next: null,
        previous: null,
        results: PRODUCTS,
      });
    });
  }

  it('lists consumables with their rate, calls out the unpriced, and hides retired', async () => {
    mockCatalogue();
    renderWithStore(<AdminProductsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-product-SHEATH')).toBeTruthy());
    expect(screen.getByTestId('admin-products-count')).toHaveTextContent('2 shown · 1 not priced');
    expect(screen.getByTestId('admin-product-rate-SHEATH')).toHaveTextContent('₹2.50');
    expect(screen.getByTestId('admin-product-rate-GLOVE')).toHaveTextContent('not priced');
    expect(screen.queryByTestId('admin-product-GUN')).toBeNull();
    expect(screen.queryByTestId('admin-product-OLDGEL')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-products-retired'));
    expect(screen.getByTestId('admin-product-OLDGEL')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(within(screen.getByTestId('admin-product-OLDGEL')).getByText('Retired')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-products-kind-asset'));
    expect(screen.getByTestId('admin-product-GUN')).toBeTruthy();
    expect(screen.queryByTestId('admin-product-SHEATH')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-products-kind-straw'));
    await waitFor(() => expect(screen.getByTestId('admin-product-SAHIWAL')).toBeTruthy());
    expect(screen.getByText('साहीवाल')).toBeTruthy();
    expect(screen.getByTestId('admin-products-straws-note')).toBeTruthy();
    expect(screen.getByTestId('admin-products-add')).toHaveTextContent(/Add a breed/);
  });

  it('adds a product with the fields its kind needs', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockCatalogue(sent);
    renderWithStore(<AdminProductsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-product-SHEATH')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-products-add'));
    expect(screen.queryByTestId('admin-product-name-hi')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-product-save'));
    expect(screen.getByTestId('admin-product-problem')).toHaveTextContent(
      /A code and a name are both needed/,
    );

    fireEvent.changeText(screen.getByTestId('admin-product-code'), 'lube');
    fireEvent.changeText(screen.getByTestId('admin-product-name'), 'Lubricant');
    fireEvent.press(screen.getByTestId('admin-product-unit-litre'));
    fireEvent.changeText(screen.getByTestId('admin-product-rate'), '12.5');
    fireEvent.press(screen.getByTestId('admin-product-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.url).toContain('/admin/products/');
    expect(sent[0]?.body).toEqual({
      code: 'LUBE',
      name: 'Lubricant',
      rate: '12.50',
      display_order: 0,
      category: 'consumable',
      unit: 'litre',
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-products-flash')).toHaveTextContent(/Lubricant saved\./),
    );
  });

  it('edits a breed with its code and animal fixed', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockCatalogue(sent);
    renderWithStore(<AdminProductsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-products-kind-straw')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-products-kind-straw'));
    await waitFor(() => expect(screen.getByTestId('admin-product-SAHIWAL')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-product-edit-SAHIWAL'));
    expect(screen.getByTestId('admin-product-code').props.editable).toBe(false);
    expect(screen.getByTestId('admin-product-name-hi').props.value).toBe('साहीवाल');
    expect(screen.queryByTestId('admin-product-unit')).toBeNull();
    fireEvent.changeText(screen.getByTestId('admin-product-rate'), '60');
    fireEvent.press(screen.getByTestId('admin-product-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.url).toContain('/admin/breeds/7/');
    expect(sent[0]?.body).toEqual({
      code: 'SAHIWAL',
      name: 'Sahiwal',
      rate: '60.00',
      display_order: 1,
      name_hi: 'साहीवाल',
      animal_type: 'COW',
    });
  });

  it('retires after asking, and deletes only after a second warning', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockCatalogue(sent);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    renderWithStore(<AdminProductsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-product-SHEATH')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-product-edit-SHEATH'));
    fireEvent.press(screen.getByTestId('admin-product-retire'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(alert.mock.calls[0]?.[0]).toBe('Retire AI sheaths?');
    expect(sent[0]?.body).toEqual({ is_active: false });
    await waitFor(() =>
      expect(screen.getByTestId('admin-products-flash')).toHaveTextContent(
        /AI sheaths retired\. Maits can no longer request it\./,
      ),
    );

    fireEvent.press(screen.getByTestId('admin-product-edit-GLOVE'));
    fireEvent.press(screen.getByTestId('admin-product-delete'));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.method).toBe('DELETE');
    expect(sent[1]?.url).toContain('/admin/products/2/');
    alert.mockRestore();
  });
});

describe('AdminStoresScreen', () => {
  const BARSANA = {
    id: 5,
    code: 'BARSANA',
    name: 'Barsana depot',
    zone: 2,
    zone_name: 'Mathura',
    description: '',
    is_active: true,
    plants: ['P1'],
    plant_names: ['Barsana BMC'],
    mpp_count: 12,
    keepers: [
      {
        id: 31,
        full_name: 'Ramesh Yadav',
        mobile_no: '9876500001',
        is_active: true,
        last_login_at: null,
      },
    ],
    stock: [
      { item_name: 'Murrah', on_hand: 40, category: 'straw' },
      { item_name: 'Gloves', on_hand: 0, category: 'consumable' },
    ],
    open_indents: 2,
    created_at: '2026-10-01T00:00:00Z',
  };
  const NO_KEEPER = {
    ...BARSANA,
    id: 6,
    code: 'GOVARDHAN',
    name: 'Govardhan depot',
    plants: [],
    plant_names: [],
    keepers: [],
    stock: [],
    open_indents: 0,
  };
  const PLANTS = [
    {
      plant_code: 'P1',
      plant_name: 'Barsana BMC',
      mpp_count: 12,
      store_id: 5,
      store_name: 'Barsana depot',
      zone_name: 'Mathura',
    },
    {
      plant_code: 'P2',
      plant_name: 'Kosi MCC',
      mpp_count: 7,
      store_id: null,
      store_name: '',
      zone_name: 'Mathura',
    },
    {
      plant_code: 'P3',
      plant_name: 'Chhata BMC',
      mpp_count: 4,
      store_id: null,
      store_name: '',
      zone_name: 'Mathura',
    },
  ];
  const ZONES = [
    {
      id: 2,
      code: 'MTR',
      name: 'Mathura',
      description: '',
      is_active: true,
      plants: ['P1', 'P2', 'P3'],
      plant_names: [],
      mpp_count: 0,
      member_count: 0,
      user_count: 0,
    },
  ];

  function mockStores(sent: { url: string; method: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      if (method !== 'GET') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ url, method, body });
        if (url.endsWith('/admin/stores/')) {
          return jsonResponse({ ...NO_KEEPER, id: 9, ...(body as object) }, 201);
        }
        return jsonResponse(BARSANA);
      }
      if (url.includes('/admin/stores/plants/')) {
        return jsonResponse({ count: 3, unserved: 2, results: PLANTS });
      }
      if (url.includes('/admin/zones/')) {
        return jsonResponse(ZONES);
      }
      // Served unpaginated: a plain array.
      return jsonResponse([BARSANA, NO_KEEPER]);
    });
  }

  it('lists the stores, the summary, and the centres no store serves', async () => {
    mockStores();
    renderWithStore(<AdminStoresScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-store-BARSANA')).toBeTruthy());
    expect(screen.getByTestId('admin-stores-count')).toHaveTextContent('2 stores');
    expect(screen.getByTestId('admin-stores-tile-stores-foot')).toHaveTextContent(
      '1 with no keeper',
    );
    await waitFor(() =>
      expect(screen.getByTestId('admin-stores-tile-served-value')).toHaveTextContent('1 of 3'),
    );
    expect(screen.getByTestId('admin-stores-tile-waiting-value')).toHaveTextContent('2');

    expect(screen.getByTestId('admin-store-BARSANA')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-store-keepers-BARSANA')).toHaveTextContent(/Ramesh Yadav/);
    // An open store nobody keeps is yellow, and says why.
    expect(screen.getByTestId('admin-store-GOVARDHAN')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-store-keepers-GOVARDHAN')).toHaveTextContent(
      'No keeper — nobody can issue',
    );

    expect(screen.getByTestId('admin-stores-unserved')).toBeTruthy();
    expect(screen.getByTestId('admin-stores-place-P2')).toBeTruthy();

    // A keeper's number finds their store, digits only.
    fireEvent.changeText(screen.getByTestId('admin-stores-search'), '98765 00001');
    expect(screen.queryByTestId('admin-store-GOVARDHAN')).toBeNull();
    expect(screen.getByTestId('admin-stores-count')).toHaveTextContent('1 of 2 stores');
  });

  it('starts a store from an unserved centre and saves it', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockStores(sent);
    renderWithStore(<AdminStoresScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-stores-place-P2')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-stores-place-P2'));
    expect(screen.getByTestId('admin-store-plant-count')).toHaveTextContent('1 of 3 ticked');
    // Another store's centre is locked.
    expect(screen.getByTestId('admin-store-plant-P1').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.getByTestId('admin-store-keeper-count')).toHaveTextContent('after saving');

    fireEvent.press(screen.getByTestId('admin-store-save'));
    expect(screen.getByTestId('admin-store-problem')).toHaveTextContent(/Give the store a name/);

    fireEvent.changeText(screen.getByTestId('admin-store-name'), 'Kosi depot');
    fireEvent.changeText(screen.getByTestId('admin-store-code'), 'kosi');
    fireEvent.press(screen.getByTestId('admin-store-zone-2'));
    fireEvent.press(screen.getByTestId('admin-store-pick-zone'));
    expect(screen.getByTestId('admin-store-plant-count')).toHaveTextContent('2 of 3 ticked');

    fireEvent.press(screen.getByTestId('admin-store-save'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.body).toEqual({
      name: 'Kosi depot',
      zone: 2,
      is_active: true,
      plants: ['P2', 'P3'],
      code: 'KOSI',
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-stores-flash')).toHaveTextContent(
        /Kosi depot created\. Now give it a keeper\./,
      ),
    );
  });

  it('names a removed centre, adds a keeper and takes one off', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockStores(sent);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    renderWithStore(<AdminStoresScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-store-edit-BARSANA')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-store-edit-BARSANA'));
    expect(screen.getByTestId('admin-store-code').props.editable).toBe(false);
    fireEvent.press(screen.getByTestId('admin-store-plant-P1'));
    expect(
      screen.getByText('Removing Barsana BMC — their Maits stop collecting here'),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-store-plant-P1'));

    fireEvent.changeText(screen.getByTestId('admin-store-keeper-name'), 'Sita');
    fireEvent.changeText(screen.getByTestId('admin-store-keeper-mobile'), '98765');
    fireEvent.press(screen.getByTestId('admin-store-keeper-add'));
    expect(screen.getByText('Their 10-digit mobile — the number the OTP goes to.')).toBeTruthy();
    expect(sent).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId('admin-store-keeper-mobile'), '9876500009');
    fireEvent.press(screen.getByTestId('admin-store-keeper-add'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toContain('/admin/stores/5/keepers/');
    expect(sent[0]?.body).toEqual({ full_name: 'Sita', mobile_no: '9876500009' });

    fireEvent.press(screen.getByTestId('admin-store-keeper-remove-31'));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.url).toContain('/admin/stores/5/keepers/31/remove/');
    alert.mockRestore();
  });

  it('opens the shelf editor from Stock', async () => {
    mockStores();
    renderWithStore(<AdminStoresScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-store-stock-BARSANA')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-store-stock-BARSANA'));
    expect(screen.getByTestId('admin-inventory-store')).toBeTruthy();
  });
});

describe('AdminIndentsScreen', () => {
  const daysBack = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const BASE = {
    product_type: 'straw',
    breed: 'MURRAH',
    item: 'Semen straw',
    qty_requested: 25,
    qty_issued: 0,
    mait_name: 'Sunil Kumar',
    mait_code: '5500000054',
    issued_at: null,
    received_at: null,
    note: '',
    handovers: [],
  };
  // Fresh, waiting on the office, routed to a store.
  const REQUESTED = {
    ...BASE,
    id: 55,
    status: 'requested',
    status_display: 'Requested',
    requested_at: daysBack(0),
    store_name: 'Barsana depot',
  };
  // Approved days ago, no store serves the Mait: stale, and the office issues it.
  const NO_STORE = {
    ...BASE,
    id: 56,
    status: 'approved',
    status_display: 'Approved',
    requested_at: daysBack(5),
    store_name: '',
  };
  // Part of it already over a store's counter.
  const PART = {
    ...BASE,
    id: 57,
    status: 'approved',
    status_display: 'Approved',
    requested_at: daysBack(1),
    store_name: 'Barsana depot',
    qty_issued: 10,
    qty_to_collect: 10,
  };
  const ISSUED = {
    ...BASE,
    id: 58,
    status: 'issued',
    status_display: 'Issued',
    requested_at: daysBack(1),
    store_name: 'Barsana depot',
    qty_issued: 25,
  };

  function mockIndents(sent: { url: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      if (method === 'POST') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ url, body });
        if (url.includes('/issue/')) {
          return jsonResponse({ ...NO_STORE, status: 'issued', qty_issued: 3 });
        }
        return jsonResponse({ ...REQUESTED, status: 'approved' });
      }
      return jsonResponse({
        count: 4,
        next: null,
        previous: null,
        results: [REQUESTED, NO_STORE, PART, ISSUED],
      });
    });
  }

  it('lists the queue in its colours, with one action per indent', async () => {
    mockIndents();
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-indent-55')).toBeTruthy());
    expect(screen.getByTestId('admin-indents-count')).toHaveTextContent(
      '4 indents · 3 awaiting you on this page · 1 stale',
    );
    // Stale beats every other state: red, and said in words.
    expect(screen.getByTestId('admin-indent-56')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(within(screen.getByTestId('admin-indent-56')).getByText('Stale')).toBeTruthy();
    expect(screen.getByTestId('admin-indent-depot-56')).toHaveTextContent(
      'no store — issued from here',
    );
    expect(within(screen.getByTestId('admin-indent-56')).getByText('Issue')).toBeTruthy();

    expect(screen.getByTestId('admin-indent-55')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(within(screen.getByTestId('admin-indent-55')).getByText('Review')).toBeTruthy();

    expect(
      within(screen.getByTestId('admin-indent-57')).getByText('Part-issued 10/25'),
    ).toBeTruthy();
    expect(screen.getByTestId('admin-indent-depot-57')).toHaveTextContent(
      '10 issued · 10 at the counter · Barsana depot',
    );
    expect(
      within(screen.getByTestId('admin-indent-57')).getByText('With Barsana depot'),
    ).toBeTruthy();

    // Issued but not yet collected is not in the Mait's hands.
    expect(
      within(screen.getByTestId('admin-indent-58')).getByText('Awaiting collection'),
    ).toBeTruthy();
    expect(screen.queryByTestId('admin-indent-open-58')).toBeNull();
    expect(screen.getByTestId('admin-indents-notice')).toBeTruthy();
  });

  it('asks the server for stale indents, by status, and by search', async () => {
    mockIndents();
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-indent-55')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-indents-stale'));
    fireEvent.press(screen.getByTestId('admin-indents-status-approved'));
    fireEvent.changeText(screen.getByTestId('admin-indents-search'), 'Sunil');
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(
        urls.some(
          u =>
            u.includes('stale=true') && u.includes('status=approved') && u.includes('search=Sunil'),
        ),
      ).toBe(true);
    });
  });

  it('approves a request and says it went to the store', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockIndents(sent);
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-indent-open-55')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-indent-open-55'));
    expect(screen.getByTestId('admin-indent-effect')).toHaveTextContent(
      /puts it in Barsana depot's queue/,
    );
    // A store issues this one, so the office has no Issue.
    expect(screen.queryByTestId('admin-indent-issue')).toBeNull();
    expect(screen.getByTestId('admin-indent-fact-qty')).toHaveTextContent(/25/);

    fireEvent.press(screen.getByTestId('admin-indent-approve'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toContain('/indents/55/approve/');
    await waitFor(() =>
      expect(screen.getByTestId('admin-indents-flash')).toHaveTextContent(
        /IND-55 approved\. It is in Barsana depot's queue to hand over\./,
      ),
    );
  });

  it('will not reject without a reason, and sends the one given', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockIndents(sent);
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-indent-open-55')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-indent-open-55'));

    fireEvent.press(screen.getByTestId('admin-indent-reject'));
    expect(screen.getByTestId('admin-indent-hint')).toHaveTextContent(
      'Give a reason — the Mait sees only this.',
    );
    expect(sent).toHaveLength(0);

    fireEvent.changeText(screen.getByTestId('admin-indent-reason'), 'No Murrah at the depot');
    fireEvent.press(screen.getByTestId('admin-indent-reject'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toContain('/indents/55/reject/');
    expect(sent[0]?.body).toEqual({ reason: 'No Murrah at the depot' });
  });

  it('issues from the office by straw numbers, refusing a duplicate', async () => {
    const sent: { url: string; body: unknown }[] = [];
    mockIndents(sent);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      buttons?.find(b => b.style !== 'cancel')?.onPress?.();
    });
    renderWithStore(<AdminIndentsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-indent-open-56')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-indent-open-56'));

    expect(screen.getByTestId('admin-indent-qty').props.value).toBe('25');
    fireEvent.changeText(screen.getByTestId('admin-indent-straws'), 'm-1, M-1');
    expect(screen.getByTestId('admin-indent-straw-hint')).toHaveTextContent(
      /The same number is listed twice/,
    );

    fireEvent.changeText(screen.getByTestId('admin-indent-straws'), 'm-1, m-2\nm-3');
    expect(screen.getByTestId('admin-indent-straw-count')).toHaveTextContent('3 listed');
    expect(screen.getByTestId('admin-indent-qty').props.value).toBe('3');
    expect(screen.getByTestId('admin-indent-hint')).toHaveTextContent(
      'Issuing the 3 straws listed below.',
    );

    fireEvent.press(screen.getByTestId('admin-indent-issue'));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(alert.mock.calls[0]?.[0]).toBe('Credit 3 to Sunil Kumar?');
    expect(sent[0]?.url).toContain('/indents/56/issue/');
    expect(sent[0]?.body).toEqual({ straw_numbers: ['M-1', 'M-2', 'M-3'] });
    await waitFor(() =>
      expect(screen.getByTestId('admin-indents-flash')).toHaveTextContent(
        /IND-56 issued · 3 credited to Sunil Kumar/,
      ),
    );
    alert.mockRestore();
  });
});

describe('AdminMaitPaymentScreen', () => {
  const RANDHEER = {
    serial: 1,
    mait_id: 1,
    mcc_name: 'COLONELGANJ',
    mait_name: 'Randheer Singh',
    vendor_code: 'V1',
    ai_performed: 67,
    commission: '14740.00',
    fixed_amount: '2500.00',
    gross: '17240.00',
    quantities: { semen: 71, ln2: 0, sheath: 70, gloves: 70 },
    recoveries: { semen: '2485.00', ln2: '0', sheath: '140.00', gloves: '60.00' },
    admin_quantities: { semen: 5, ln2: 0, sheath: 0, gloves: 0 },
    deduction: '2685.00',
    after_deduction: '14555.00',
    tagging: '0.00',
    net_payable: '14555.00',
    bank_account_no: 'XXXX3035',
    ifsc_code: 'SBIN0012497',
    pan_no: 'XXXXX6713H',
    has_bank_details: true,
    overdrawn: false,
  };
  const SURESH = {
    ...RANDHEER,
    serial: 2,
    mait_id: 2,
    mcc_name: 'TARABGANJ',
    mait_name: 'Suresh Pal',
    vendor_code: 'V2',
    ai_performed: 2,
    commission: '440.00',
    fixed_amount: '0.00',
    gross: '440.00',
    admin_quantities: { semen: 0, ln2: 0, sheath: 0, gloves: 0 },
    deduction: '1200.00',
    after_deduction: '-760.00',
    net_payable: '-760.00',
    overdrawn: true,
  };
  const MOHAN = {
    ...RANDHEER,
    serial: 3,
    mait_id: 3,
    mcc_name: 'COLONELGANJ',
    mait_name: 'Mohan Lal',
    vendor_code: 'V3',
    admin_quantities: { semen: 0, ln2: 0, sheath: 0, gloves: 0 },
    bank_account_no: '',
    ifsc_code: '',
    has_bank_details: false,
  };
  const REPORT = {
    month: '2026-10',
    in_progress: true,
    scheme: { commission_per_ai: '220.00', monthly_fixed_amount: '2500.00', fixed_min_ai: 25 },
    rates: { semen: '35.00', ln2: '0', sheath: '2.00', gloves: '0.86' },
    rows: [RANDHEER, SURESH, MOHAN],
    totals: {
      maits: 3,
      ai_performed: 136,
      commission: '29920.00',
      fixed_amount: '5000.00',
      gross: '34920.00',
      quantities: { semen: 213, ln2: 0, sheath: 210, gloves: 210 },
      deduction: '6570.00',
      after_deduction: '28350.00',
      tagging: '0.00',
      net_payable: '28350.00',
      overdrawn: 1,
    },
  };

  function mockPayment(sent: { url: string; method: string; body: unknown }[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({ url, method, body: await input.clone().json() });
        return jsonResponse({});
      }
      sent.push({ url, method, body: null });
      const month = url.match(/month=(\d{4}-\d{2})/)?.[1];
      return jsonResponse(
        month && month !== '2026-10' ? { ...REPORT, month, in_progress: false } : REPORT,
      );
    });
  }

  it('leads with the four figures, and says the month is still running', async () => {
    mockPayment();
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-payment-V1')).toBeTruthy());
    expect(screen.getByTestId('admin-payment-state')).toHaveTextContent(/still in progress/);
    expect(screen.getByTestId('admin-payment-tile-ai-value')).toHaveTextContent('136');
    expect(screen.getByTestId('admin-payment-tile-ai-foot')).toHaveTextContent(
      'across 3 Maits · ₹220 each',
    );
    expect(screen.getByTestId('admin-payment-tile-earned-foot')).toHaveTextContent(
      '₹29,920 commission + ₹5,000 fixed',
    );
    expect(screen.getByTestId('admin-payment-tile-recovered-value')).toHaveTextContent('₹6,570');
    expect(screen.getByTestId('admin-payment-tile-net-value')).toHaveTextContent('₹28,350');
    // A row below zero is not a payment, and the tile says so.
    expect(screen.getByTestId('admin-payment-tile-net-foot')).toHaveTextContent(
      '1 Mait owes more than they earned',
    );
    expect(screen.getByTestId('admin-payment-count')).toHaveTextContent(
      '3 Maits · October 2026 · 1 to check',
    );

    // Owes more is red, no bank details is yellow, the rest green.
    expect(screen.getByTestId('admin-payment-V2')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('admin-payment-net-V2')).toHaveTextContent('−₹760');
    expect(screen.getByTestId('admin-payment-V3')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-payment-V1')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-payment-totals-net')).toHaveTextContent('₹28,350');
  });

  it('opens a Mait to every column of their row, money and counts kept apart', async () => {
    mockPayment();
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-payment-toggle-V1')).toBeTruthy());

    expect(screen.queryByTestId('admin-payment-detail-V1')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-payment-toggle-V1'));
    expect(screen.getByTestId('admin-payment-gross-V1')).toHaveTextContent('₹17,240');
    // Seventy-one straws is a count, and what they recover is money beside it.
    expect(screen.getByTestId('admin-payment-semen-V1')).toHaveTextContent('71 · ₹2,485');
    expect(screen.getByTestId('admin-payment-ln2-V1')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('admin-payment-added-V1')).toHaveTextContent(
      'Added by admin, not deducted: 5 Semen',
    );
    expect(screen.getByTestId('admin-payment-deduction-V1')).toHaveTextContent('₹2,685');
    expect(screen.getByTestId('admin-payment-account-V1')).toHaveTextContent('XXXX3035');

    // One open at a time.
    fireEvent.press(screen.getByTestId('admin-payment-toggle-V3'));
    expect(screen.queryByTestId('admin-payment-detail-V1')).toBeNull();
    expect(screen.getByTestId('admin-payment-account-V3')).toHaveTextContent('—');
  });

  it('searches the sheet and narrows it to the rows to check', async () => {
    mockPayment();
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-payment-V1')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('admin-payment-search'), 'tarab');
    expect(screen.queryByTestId('admin-payment-V1')).toBeNull();
    expect(screen.getByTestId('admin-payment-V2')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('admin-payment-search'), '');
    fireEvent.press(screen.getByTestId('admin-payment-filter-noBank'));
    expect(screen.queryByTestId('admin-payment-V1')).toBeNull();
    expect(screen.getByTestId('admin-payment-V3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-payment-filter-overdrawn'));
    expect(screen.getByTestId('admin-payment-V2')).toBeTruthy();
    expect(screen.queryByTestId('admin-payment-V3')).toBeNull();
  });

  it('picks another month, which is asked for by name', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockPayment(sent);
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-payment-V1')).toBeTruthy());

    const months = monthChoices();
    const previous = months[1]!;
    fireEvent.press(screen.getByTestId('admin-payment-month'));
    fireEvent.press(screen.getByTestId(`admin-payment-month-${previous}`));
    await waitFor(() => expect(sent.some(s => s.url.includes(`month=${previous}`))).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('admin-payment-state')).toHaveTextContent(/has finished/),
    );
  });

  it('offers no month before payroll began', () => {
    expect(monthChoices(new Date(2026, 2, 15))).toEqual(['2026-03', '2026-02', '2026-01']);
    expect(monthChoices(new Date(2027, 11, 1))).toHaveLength(18);
  });

  it('saves only a changed rate card, and rebuilds the sheet', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockPayment(sent);
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-payment-commission')).toBeTruthy());

    expect(screen.getByTestId('admin-payment-commission').props.value).toBe('220');
    expect(screen.getByTestId('admin-payment-straw').props.value).toBe('35');
    expect(screen.getByTestId('admin-payment-rate-state')).toHaveTextContent('1 not priced');
    expect(screen.getByTestId('admin-payment-rate-ln2')).toHaveTextContent('Not priced');
    expect(screen.getByTestId('admin-payment-save').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.changeText(screen.getByTestId('admin-payment-commission'), '');
    fireEvent.press(screen.getByTestId('admin-payment-save'));
    expect(screen.getByTestId('admin-payment-rate-problem')).toHaveTextContent(
      'Each rate needs a number, zero or more.',
    );

    fireEvent.changeText(screen.getByTestId('admin-payment-commission'), '240');
    fireEvent.press(screen.getByTestId('admin-payment-save'));
    await waitFor(() => expect(sent.some(s => s.method === 'PATCH')).toBe(true));
    const patch = sent.find(s => s.method === 'PATCH')!;
    expect(patch.url).toContain('/reports/mait-payment/scheme/');
    expect(patch.body).toEqual({
      commission_per_ai: '240',
      monthly_fixed_amount: '2500',
      fixed_min_ai: 25,
      straw_rate: '35',
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-payment-flash')).toHaveTextContent(
        'Rates saved. The sheet has been rebuilt.',
      ),
    );
    // Rebuilt, not patched: the sheet is asked for again.
    expect(sent.filter(s => s.url.includes('/reports/mait-payment/?')).length).toBeGreaterThan(1);
  });

  it('asks before downloading a file of whole account numbers', async () => {
    mockPayment();
    (downloadAndShare as jest.Mock).mockClear();
    const alert = jest.spyOn(Alert, 'alert');
    renderWithStore(<AdminMaitPaymentScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-payment-V1')).toBeTruthy());

    alert.mockImplementationOnce(() => undefined);
    fireEvent.press(screen.getByTestId('admin-payment-export'));
    expect(alert).toHaveBeenCalledWith(
      'Download the payment workbook?',
      expect.stringMatching(/full bank account numbers/),
      expect.any(Array),
    );
    expect(downloadAndShare).not.toHaveBeenCalled();

    alert.mockImplementationOnce((_title, _body, buttons) => {
      buttons?.find(b => b.text === 'Download')?.onPress?.();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-payment-export'));
    });
    expect(downloadAndShare).toHaveBeenCalledWith(
      '/reports/mait-payment/export/?month=2026-10',
      'mait-payment-2026-10.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expect.any(String),
    );
    alert.mockRestore();
  });
});

describe('AdminLeaderboardScreen', () => {
  const BOARD = {
    date_from: '2026-10-20',
    date_to: '2026-10-26',
    days: 7,
    count: 3,
    totals: { ai_count: 30, amount_collected: '6000.00', cod_amount: '4500.00' },
    results: [
      {
        mait_id: 1,
        name: 'Rohit Kumar',
        sahayak_vendor_code: '5500000054',
        ai_count: 20,
        amount_collected: '4000.00',
        cod_amount: '3000.00',
        online_amount: '1000.00',
      },
      {
        mait_id: 2,
        name: 'Sunil Kumar',
        sahayak_vendor_code: '5500000055',
        ai_count: 7,
        amount_collected: '2000.00',
        cod_amount: '1500.00',
        online_amount: '500.00',
      },
      {
        mait_id: 3,
        name: 'Anil Singh',
        sahayak_vendor_code: '5500000056',
        ai_count: 3,
        amount_collected: '0',
        cod_amount: '0',
        online_amount: '0',
      },
    ],
  };

  function mockBoard(board: object = BOARD) {
    (global.fetch as jest.Mock).mockImplementation(async () => jsonResponse(board));
  }

  it('works out the preset ranges, counting today in', () => {
    const today = new Date(2026, 9, 26);
    expect(presetRange('7', today)).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(presetRange('30', today)).toEqual({ from: '2026-09-27', to: '2026-10-26' });
    expect(presetRange('this-month', today)).toEqual({ from: '2026-10-01', to: '2026-10-26' });
    expect(presetRange('last-month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('shows the range it counted, the tiles, and the board against the leader', async () => {
    mockBoard();
    renderWithStore(<AdminLeaderboardScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-leader-5500000054')).toBeTruthy());
    expect(screen.getByTestId('admin-leaderboard-period')).toHaveTextContent(
      '20 Oct 2026 – 26 Oct 2026',
    );
    expect(screen.getByTestId('admin-leaderboard-tile-ai-value')).toHaveTextContent('30');
    expect(screen.getByTestId('admin-leaderboard-tile-ai-foot')).toHaveTextContent('across 7 days');
    expect(screen.getByTestId('admin-leaderboard-tile-collected-value')).toHaveTextContent(
      '₹6,000',
    );
    expect(screen.getByTestId('admin-leaderboard-tile-collected-foot')).toHaveTextContent(
      '75% of it in cash',
    );
    expect(screen.getByTestId('admin-leaderboard-tile-average-value')).toHaveTextContent('4.3');

    expect(screen.getByTestId('admin-leader-collected-5500000054')).toHaveTextContent('₹4,000');
    expect(screen.getByTestId('admin-leader-share-5500000054')).toHaveTextContent('75%');
    expect(screen.getByTestId('admin-leader-share-5500000056')).toHaveTextContent('—');
    // Below half the leader is yellow and says so.
    expect(screen.getByTestId('admin-leader-5500000055')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-leader-5500000054')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-leaderboard-foot')).toHaveTextContent(
      /Yellow marks anyone below half of them\.$/,
    );
  });

  it('keeps the rank through a search, and says when the board is capped', async () => {
    mockBoard({ ...BOARD, count: 250 });
    renderWithStore(<AdminLeaderboardScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-leader-5500000056')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('admin-leaderboard-search'), 'anil');
    expect(screen.queryByTestId('admin-leader-5500000054')).toBeNull();
    // Still third in the district — and so still wearing the top-three trophy.
    expect(screen.getByTestId('admin-leader-rank-5500000056')).toHaveTextContent(/^trophy3$/);
    expect(screen.getByTestId('admin-leaderboard-foot')).toHaveTextContent(
      /Showing the top 3 of 250 Maits who worked\./,
    );
  });

  it('asks for the preset range picked', async () => {
    mockBoard();
    renderWithStore(<AdminLeaderboardScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-leader-5500000054')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-leaderboard-preset-last-month'));
    const { from, to } = presetRange('last-month');
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map(([r]) => String(r.url ?? r));
      expect(urls.some(u => u.includes(`date_from=${from}`) && u.includes(`date_to=${to}`))).toBe(
        true,
      );
    });
  });
});

describe('AdminPregnancyScreen', () => {
  const OVERSIGHT = {
    summary: {
      maits: 3,
      open: 9,
      overdue: 3,
      due_this_week: 5,
      recorded: 44,
      pregnant: 21,
      not_pregnant: 15,
      unsure: 4,
      declined: 4,
      conception_rate: 52.5,
      conceived: 21,
      decided: 40,
    },
    results: [
      {
        mait_id: 1,
        name: 'Sunil Kumar',
        sahayak_vendor_code: 'V1',
        mpp_codes: ['M01', 'M02', 'M03', 'M04', 'M05'],
        open: 6,
        overdue: 3,
        due_this_week: 4,
        recorded: 30,
        pregnant: 15,
        not_pregnant: 10,
        unsure: 2,
        declined: 3,
        conception_rate: 60,
        conceived: 15,
        decided: 25,
      },
      {
        mait_id: 2,
        name: 'Anil Singh',
        sahayak_vendor_code: 'V2',
        mpp_codes: ['K10'],
        open: 3,
        overdue: 0,
        due_this_week: 1,
        recorded: 14,
        pregnant: 6,
        not_pregnant: 5,
        unsure: 2,
        declined: 1,
        conception_rate: 20,
        conceived: 3,
        decided: 15,
      },
      {
        mait_id: 3,
        name: 'Bharat Lal',
        sahayak_vendor_code: 'V3',
        mpp_codes: [],
        open: 0,
        overdue: 0,
        due_this_week: 0,
        recorded: 0,
        pregnant: 0,
        not_pregnant: 0,
        unsure: 0,
        declined: 0,
        conception_rate: null,
        conceived: 0,
        decided: 0,
      },
    ],
  };

  const OPEN_CHECK = {
    id: 71,
    ai_event_id: 501,
    owner_name: 'Akanksha Devi',
    owner_type: 'member',
    owner_mobile: '9876543210',
    mpp_id: 4,
    mpp_code: 'M01',
    mpp_name: 'Barsana',
    member_code: '1000000000000042',
    non_member_id: null,
    animal_id: 9,
    animal_type: 'BUFF',
    ear_tag_no: '102938475610',
    breed: 'MURRAH',
    gps_lat: '27.6488000',
    gps_lng: '-77.3770000',
    gps_source: 'photo',
    served_on: '2026-07-15',
    due_on: '2026-10-13',
    days_until: -12,
    days_since_ai: 102,
    outcome: '',
    outcome_display: '',
    checked_at: null,
    calving_due_on: null,
    photo_url: '',
    note: 'Animal moved to the cowshed by the pond',
    price: '150.00',
    amount_charged: null,
  };
  const DONE_CHECK = {
    ...OPEN_CHECK,
    id: 72,
    owner_type: 'non_member',
    owner_mobile: '',
    member_code: '',
    ear_tag_no: null,
    gps_lat: null,
    gps_lng: null,
    days_until: -40,
    outcome: 'pregnant',
    outcome_display: 'Pregnant',
    checked_at: '2026-10-02T10:30:00+05:30',
    calving_due_on: '2027-04-25',
    amount_charged: '300.00',
    note: '',
  };
  const DECLINED = { ...DONE_CHECK, id: 73, outcome: 'declined', amount_charged: null };

  function mockPregnancy(urls: string[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      urls.push(url);
      if (/\/admin\/pregnancy\/\d+\//.test(url)) {
        const done = url.includes('window=done');
        return jsonResponse({
          count: done ? 2 : 140,
          next: null,
          previous: null,
          results: done ? [DONE_CHECK, DECLINED] : [OPEN_CHECK],
          mait: { mait_id: 1, name: 'Sunil Kumar', sahayak_vendor_code: 'V1', mpp_codes: [] },
          summary: { ...OVERSIGHT.results[0] },
        });
      }
      return jsonResponse(OVERSIGHT);
    });
  }

  it('leads with the rate, and colours each Mait by what is owed', async () => {
    mockPregnancy();
    renderWithStore(<AdminPregnancyScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-V1')).toBeTruthy());
    expect(screen.getByTestId('admin-pregnancy-meta')).toHaveTextContent(/3 Maits on the round/);
    expect(screen.getByTestId('admin-pregnancy-tile-rate-value')).toHaveTextContent('52.5%');
    expect(screen.getByTestId('admin-pregnancy-tile-rate-foot')).toHaveTextContent(
      '21 of 40 inseminations settled',
    );
    expect(screen.getByTestId('admin-pregnancy-tile-overdue-foot')).toHaveTextContent(
      'Nobody has walked these',
    );
    expect(screen.getByTestId('admin-pregnancy-tile-due-value')).toHaveTextContent('5');
    // Refusals are named beside the findings, never folded into "not".
    expect(screen.getByTestId('admin-pregnancy-tile-recorded-foot')).toHaveTextContent(
      '21 pregnant · 15 not · 4 unsure · 4 declined',
    );

    // Overdue is yellow, never red; a settled round is green; no checks is grey.
    expect(screen.getByTestId('admin-pregnancy-V1')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-pregnancy-V2')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-pregnancy-rate-V1')).toHaveTextContent('60.0%');
    expect(screen.getByTestId('admin-pregnancy-rate-V3')).toHaveTextContent('No checks yet');

    // Three MPP codes, the rest behind their count.
    expect(screen.queryByText('M04')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-pregnancy-mpps-V1-more'));
    expect(screen.getByText('M05')).toBeTruthy();
    expect(screen.getByText('Show fewer')).toBeTruthy();
  });

  it('finds a Mait by an MPP code, and sorts by name when asked', async () => {
    mockPregnancy();
    renderWithStore(<AdminPregnancyScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-V1')).toBeTruthy());

    // M05 sits behind "+2 more" and still finds its Mait.
    fireEvent.changeText(screen.getByTestId('admin-pregnancy-search'), 'm05');
    expect(screen.queryByTestId('admin-pregnancy-V2')).toBeNull();
    expect(screen.getByTestId('admin-pregnancy-count')).toHaveTextContent('1 of 3 Maits');

    fireEvent.changeText(screen.getByTestId('admin-pregnancy-search'), '');
    fireEvent.press(screen.getByTestId('admin-pregnancy-overdue-first'));
    const order = screen
      .getAllByTestId(/^admin-pregnancy-V\d$/)
      .map(node => node.props.testID as string);
    expect(order).toEqual(['admin-pregnancy-V2', 'admin-pregnancy-V3', 'admin-pregnancy-V1']);
  });

  it('opens a round, oldest first, and switches to what was recorded', async () => {
    const urls: string[] = [];
    mockPregnancy(urls);
    renderWithStore(<AdminPregnancyScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-round-V1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-pregnancy-round-V1'));
    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-check-71')).toBeTruthy());
    expect(urls.some(u => u.includes('/admin/pregnancy/1/') && u.includes('window=due'))).toBe(
      true,
    );
    expect(screen.getByTestId('admin-pregnancy-round-title')).toHaveTextContent('Sunil Kumar · V1');
    expect(screen.getByTestId('admin-pregnancy-round-owed')).toHaveTextContent('6 still owed');

    expect(screen.getByTestId('admin-pregnancy-badge-71')).toHaveTextContent('12 days overdue');
    expect(screen.getByTestId('admin-pregnancy-check-71')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-pregnancy-owner-71')).toHaveTextContent(
      'Member · 1000000000000042',
    );
    expect(screen.getByTestId('admin-pregnancy-phone-71')).toHaveTextContent(/98765 43210/);
    expect(screen.getByTestId('admin-pregnancy-tag-71')).toHaveTextContent('102938475610');
    // West is said as west, and a pin from a photograph says so.
    expect(screen.getByTestId('admin-pregnancy-pin-71')).toHaveTextContent(
      '27.6488° N, 77.3770° W · from the photo',
    );
    expect(screen.getByTestId('admin-pregnancy-map-71')).toBeTruthy();
    expect(screen.getByText('Animal moved to the cowshed by the pond')).toBeTruthy();
    expect(screen.getByTestId('admin-pregnancy-round-more')).toHaveTextContent(
      'Showing the first 1 of 140.',
    );

    fireEvent.press(screen.getByTestId('admin-pregnancy-window-done'));
    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-check-72')).toBeTruthy());
    expect(urls.some(u => u.includes('window=done'))).toBe(true);
    expect(screen.getByTestId('admin-pregnancy-badge-72')).toHaveTextContent('Pregnant');
    expect(screen.getByTestId('admin-pregnancy-check-72')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-pregnancy-charged-72')).toHaveTextContent('₹300');
    expect(screen.getByTestId('admin-pregnancy-tag-72')).toHaveTextContent('Not tagged');
    expect(screen.getByTestId('admin-pregnancy-pin-72')).toHaveTextContent('No pin was recorded');
    expect(screen.queryByTestId('admin-pregnancy-map-72')).toBeNull();
    expect(screen.queryByTestId('admin-pregnancy-phone-72')).toBeNull();
    // A refusal is grey and was billed nothing.
    expect(screen.getByTestId('admin-pregnancy-badge-73')).toHaveTextContent('Declined');
    expect(screen.getByTestId('admin-pregnancy-charged-73')).toHaveTextContent('Nothing');

    fireEvent.press(screen.getByTestId('admin-pregnancy-round-back'));
    expect(screen.getByTestId('admin-pregnancy-V1')).toBeTruthy();
  });

  it('takes the search with it into the report', async () => {
    mockPregnancy();
    renderWithStore(<AdminPregnancyScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-pregnancy-V1')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('admin-pregnancy-search'), 'Sunil');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-pregnancy-export'));
    });
    expect(downloadAndShare).toHaveBeenCalledWith(
      '/reports/pregnancy/?search=Sunil',
      'pregnancy-checks.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expect.any(String),
    );
  });
});

describe('AdminExceptionsScreen', () => {
  const SUMMARY = {
    exceptions: {
      pending_payments: {
        count: 14,
        rows: [
          { label: 'Barsana · ₹250', meta: '2 days old', severity: 'warning' },
          { label: 'Kosi · ₹300', meta: '5 days old', severity: 'warning' },
        ],
        more: 12,
      },
      failed_otps: {
        count: 2,
        rows: [{ label: 'Rohit Kumar', meta: 'Attempts used up', severity: 'error' }],
        more: 0,
      },
      low_stock: { count: 0, rows: [], more: 0 },
      stale_indents: {
        count: 1,
        rows: [{ label: 'Sunil Kumar', meta: '40 × Murrah · 6 days', severity: 'warning' }],
        more: 0,
      },
      overdue_checks: { count: 0, rows: [], more: 0 },
      declined_checks: { count: 0, rows: [], more: 0 },
    },
  };

  const PAYMENTS = {
    queue: 'pending-payments',
    title: 'Pending payments',
    subtitle: 'Collections started and never finished',
    count: 14,
    shown: 2,
    filter: '',
    truncated: false,
    windowed: false,
    window_days: 30,
    buckets: [
      { key: 'not_authorised', label: 'Not authorised', tone: 'bad', count: 1 },
      { key: 'awaiting_proof', label: 'No proof yet', tone: 'warn', count: 1 },
      { key: 'awaiting_cash', label: 'Cash not confirmed', tone: 'warn', count: 0 },
      { key: 'ready', label: 'Everything collected', tone: 'info', count: 0 },
    ],
    results: [
      {
        id: 'payment-1',
        bucket: 'not_authorised',
        title: 'Akanksha Devi',
        subtitle: '1000000000000042 · Barsana',
        detail: 'Cash',
        state: { label: 'Not authorised', tone: 'bad' },
        metric: '₹250',
        when: '2026-10-24T09:15:00+05:30',
        guidance: 'The farmer has not entered her authorisation code, so nothing can move.',
        facts: [
          { label: 'Waiting', value: '2 days', href: null },
          { label: 'Farmer authorised', value: 'No', href: null },
          { label: 'UTR', value: '', href: null },
          { label: 'Sent', value: '2026-10-24T09:15:00+05:30', href: null },
        ],
        link: { href: 'ai-event.html?id=501', label: 'AI event 501' },
      },
      {
        id: 'payment-2',
        bucket: 'awaiting_proof',
        title: 'Kamla Devi',
        subtitle: '1000000000000043 · Kosi',
        detail: 'Online',
        state: { label: 'No proof yet', tone: 'warn' },
        metric: '₹300',
        when: '2026-10-21T09:15:00+05:30',
        guidance: 'She authorised it and the money was sent online.',
        facts: [],
        link: { href: 'indents.html', label: 'Open Indents' },
      },
    ],
  };

  const OTPS = {
    ...PAYMENTS,
    queue: 'failed-otps',
    title: 'Failed OTPs',
    count: 2,
    windowed: true,
    window_days: 7,
    people: 1,
    buckets: [{ key: 'attempts_exhausted', label: 'Attempts used up', tone: 'bad', count: 2 }],
    results: [
      {
        ...PAYMENTS.results[0],
        id: 88,
        bucket: 'attempts_exhausted',
        title: 'Rohit Kumar',
        state: { label: 'Attempts used up', tone: 'bad' },
        metric: '3 of 3',
        mobile_no: '9876543210',
        link: null,
      },
    ],
  };

  function mockExceptions(urls: string[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      urls.push(url);
      if (url.includes('/admin/otp-failures/')) {
        return jsonResponse(OTPS);
      }
      if (url.includes('/admin/exceptions/pending-payments/')) {
        const filter = url.match(/[?&]filter=([^&]+)/)?.[1];
        return jsonResponse(
          filter
            ? {
                ...PAYMENTS,
                filter,
                shown: 1,
                results: PAYMENTS.results.filter(r => r.bucket === filter),
              }
            : PAYMENTS,
        );
      }
      return jsonResponse(SUMMARY);
    });
  }

  it('shows each queue with its count, red where work is blocked, green where clear', async () => {
    mockExceptions();
    renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });

    await waitFor(() =>
      expect(screen.getByTestId('admin-exceptions-pending-payments')).toBeTruthy(),
    );
    expect(screen.getByTestId('admin-exceptions-total')).toHaveTextContent('17 waiting');
    expect(screen.getByTestId('admin-exceptions-count-pending-payments')).toHaveTextContent('14');
    expect(screen.getByText('Barsana · ₹250')).toBeTruthy();
    expect(screen.getByTestId('admin-exceptions-more-pending-payments')).toHaveTextContent(
      '12 more',
    );
    expect(screen.getByTestId('admin-exceptions-pending-payments')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-exceptions-failed-otps')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    // An empty queue is good news and reads as good news, with nothing to open.
    expect(screen.getByTestId('admin-exceptions-low-stock')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.queryByTestId('admin-exceptions-open-low-stock')).toBeNull();
    expect(screen.getByTestId('admin-exceptions-notice')).toBeTruthy();
  });

  it('searches every queue at once and says how many of each matched', async () => {
    mockExceptions();
    renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });
    await waitFor(() =>
      expect(screen.getByTestId('admin-exceptions-pending-payments')).toBeTruthy(),
    );

    fireEvent.changeText(screen.getByTestId('admin-exceptions-search'), 'kosi');
    expect(screen.getByTestId('admin-exceptions-count-pending-payments')).toHaveTextContent(
      '1 of 14',
    );
    expect(screen.queryByText('Barsana · ₹250')).toBeNull();
    // "N more" counts the whole queue, so it is not said while searching.
    expect(screen.queryByTestId('admin-exceptions-more-pending-payments')).toBeNull();
    expect(screen.getByTestId('admin-exceptions-stale-indents')).toHaveTextContent(
      /Nothing here matches\./,
    );
    // The queue behind the card is not empty, so it can still be opened.
    expect(screen.getByTestId('admin-exceptions-open-stale-indents')).toBeTruthy();
  });

  it('opens a queue in place, filters by cause, and reads a row out', async () => {
    const urls: string[] = [];
    mockExceptions(urls);
    const onOpenSection = jest.fn();
    renderWithStore(<AdminExceptionsScreen onOpenSection={onOpenSection} />, {
      store: storeFor('admin'),
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-exceptions-open-pending-payments')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('admin-exceptions-open-pending-payments'));
    await waitFor(() => expect(screen.getByTestId('admin-queue-row-payment-1')).toBeTruthy());
    expect(screen.getByTestId('admin-queue-title')).toHaveTextContent('Pending payments');
    expect(screen.getByTestId('admin-queue-tally')).toHaveTextContent('14 in this queue');
    // Only the causes actually present get a chip.
    expect(screen.getByTestId('admin-queue-filter-not_authorised')).toHaveTextContent(
      /Not authorised 1$/,
    );
    expect(screen.queryByTestId('admin-queue-filter-ready')).toBeNull();
    expect(screen.getByTestId('admin-queue-row-payment-1')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('admin-queue-metric-payment-1')).toHaveTextContent('₹250');

    // Opening a row says who to ring, and lists its facts — an empty one said, not dropped.
    expect(screen.queryByTestId('admin-queue-guidance-payment-1')).toBeNull();
    fireEvent.press(screen.getByTestId('admin-queue-toggle-payment-1'));
    expect(screen.getByTestId('admin-queue-guidance-payment-1')).toHaveTextContent(
      /has not entered her authorisation code/,
    );
    expect(screen.getByTestId('admin-queue-fact-payment-1-1')).toHaveTextContent(
      'Farmer authorisedNo',
    );
    expect(screen.getByTestId('admin-queue-fact-payment-1-2')).toHaveTextContent('UTRNot recorded');
    expect(screen.getByTestId('admin-queue-fact-payment-1-3')).toHaveTextContent(
      /24 Oct 2026, \d\d:\d\d/,
    );
    // One open at a time.
    fireEvent.press(screen.getByTestId('admin-queue-toggle-payment-2'));
    expect(screen.queryByTestId('admin-queue-guidance-payment-1')).toBeNull();
    // A row worked on a whole screen opens that section.
    fireEvent.press(screen.getByTestId('admin-queue-go-payment-2'));
    expect(onOpenSection).toHaveBeenCalledWith('indents');

    fireEvent.press(screen.getByTestId('admin-queue-filter-awaiting_proof'));
    await waitFor(() =>
      expect(screen.getByTestId('admin-queue-tally')).toHaveTextContent(
        '14 in this queue · 1 shown',
      ),
    );
    expect(urls.some(u => u.includes('filter=awaiting_proof'))).toBe(true);
    expect(screen.queryByTestId('admin-queue-row-payment-1')).toBeNull();
    expect(screen.getByTestId('admin-queue-row-payment-2')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-queue-back'));
    expect(screen.getByTestId('admin-exceptions-pending-payments')).toBeTruthy();
  });

  it('opens a row on its own record, without leaving the screen', async () => {
    mockExceptions();
    renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });
    await waitFor(() =>
      expect(screen.getByTestId('admin-exceptions-open-pending-payments')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('admin-exceptions-open-pending-payments'));
    await waitFor(() => expect(screen.getByTestId('admin-queue-toggle-payment-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-queue-toggle-payment-1'));
    expect(screen.getByTestId('admin-queue-go-payment-1')).toHaveTextContent(/AI event 501/);

    fireEvent.press(screen.getByTestId('admin-queue-go-payment-1'));
    await waitFor(() => expect(screen.queryByTestId('admin-queue')).toBeNull());
  });

  it('offers the windows the server honours, and counts people on Failed OTPs', async () => {
    const urls: string[] = [];
    mockExceptions(urls);
    renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });
    await waitFor(() =>
      expect(screen.getByTestId('admin-exceptions-open-failed-otps')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('admin-exceptions-open-failed-otps'));
    await waitFor(() => expect(screen.getByTestId('admin-queue-row-88')).toBeTruthy());
    expect(urls.some(u => u.includes('/admin/otp-failures/') && u.includes('limit=200'))).toBe(
      true,
    );
    expect(screen.getByTestId('admin-queue-tally')).toHaveTextContent('2 in this queue · 1 person');
    // Opened on the window the server chose; nothing past thirty days is offered.
    expect(screen.getByTestId('admin-queue-window-7').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.queryByTestId('admin-queue-window-90')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-queue-toggle-88'));
    expect(screen.getByTestId('admin-queue-call-88')).toHaveTextContent(/98765 43210/);

    fireEvent.press(screen.getByTestId('admin-queue-window-30'));
    await waitFor(() => expect(urls.some(u => u.includes('days=30'))).toBe(true));
  });

  it('reads the causes and the guidance in Hindi', async () => {
    mockExceptions();
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    try {
      renderWithStore(<AdminExceptionsScreen />, { store: storeFor('admin') });
      await waitFor(() =>
        expect(screen.getByTestId('admin-exceptions-open-pending-payments')).toBeTruthy(),
      );
      fireEvent.press(screen.getByTestId('admin-exceptions-open-pending-payments'));
      await waitFor(() => expect(screen.getByTestId('admin-queue-toggle-payment-1')).toBeTruthy());
      fireEvent.press(screen.getByTestId('admin-queue-toggle-payment-1'));
      expect(screen.getByTestId('admin-queue-state-payment-1')).toHaveTextContent('अनुमति नहीं');
      expect(screen.getByTestId('admin-queue-guidance-payment-1')).toHaveTextContent(
        /अनुमति कोड नहीं डाला/,
      );
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });
});

describe('AdminRatesScreen', () => {
  const BREEDS = [
    {
      id: 1,
      code: 'SAHIWAL',
      name: 'Sahiwal',
      name_hi: '',
      animal_type: 'COW',
      rate: '300.00',
      non_member_rate: '400.00',
      display_order: 1,
      is_active: true,
    },
    {
      id: 2,
      code: 'GIR',
      name: 'Gir',
      name_hi: '',
      animal_type: 'COW',
      rate: '0.00',
      non_member_rate: '350.00',
      display_order: 2,
      is_active: true,
    },
    {
      id: 3,
      code: 'MURRAH',
      name: 'Murrah',
      name_hi: '',
      animal_type: 'BUFF',
      rate: '350.00',
      non_member_rate: '450.00',
      display_order: 1,
      is_active: true,
    },
  ];

  function mockRates(
    sent: { url: string; method: string; body: unknown }[] = [],
    pd = { member_rate: '0.00', non_member_rate: '0.00' },
    failBreed?: number,
  ) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      if (method !== 'GET') {
        let body: unknown = null;
        try {
          body = await input.clone().json();
        } catch {
          body = null;
        }
        sent.push({ url, method, body });
        if (failBreed && url.includes(`/admin/breeds/${failBreed}/`)) {
          return jsonResponse({ detail: 'nope' }, 400);
        }
        return jsonResponse({ ...(body as object), service: 'PD' });
      }
      if (url.includes('/admin/breeds/')) {
        return jsonResponse(BREEDS);
      }
      if (url.includes('/admin/pregnancy/rate/')) {
        return jsonResponse({ service: 'PD', ...pd });
      }
      if (url.includes('/mait-payment/scheme/')) {
        return jsonResponse({
          commission_per_ai: '50.00',
          monthly_fixed_amount: '1000.00',
          fixed_min_ai: 20,
        });
      }
      return jsonResponse({});
    });
  }

  it('leads with the unpriced count, the two ranges, and the pregnancy card', async () => {
    mockRates();
    renderWithStore(<AdminRatesScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-rate-SAHIWAL')).toBeTruthy());
    expect(screen.getByTestId('admin-rates-tile-unpriced-value')).toHaveTextContent('1');
    expect(screen.getByTestId('admin-rates-tile-member-value')).toHaveTextContent('₹300–₹350');
    expect(screen.getByTestId('admin-rates-tile-non-member-value')).toHaveTextContent('₹400–₹450');
    // Gir has no member rate: red, and said in words.
    expect(screen.getByTestId('admin-rate-GIR')).toHaveStyle({ backgroundColor: colors.errorWash });
    expect(within(screen.getByTestId('admin-rate-GIR')).getByText('Not priced')).toBeTruthy();
    expect(within(screen.getByTestId('admin-rate-SAHIWAL')).getByText('Priced')).toBeTruthy();
    // Buffaloes wait behind their own pill.
    expect(screen.queryByTestId('admin-rate-MURRAH')).toBeNull();
    // The pregnancy card is yellow while either figure is zero.
    await waitFor(() =>
      expect(screen.getByTestId('admin-rates-pd')).toHaveStyle({
        backgroundColor: colors.secondaryWash,
      }),
    );
    expect(screen.getByTestId('admin-rates-zero-note')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('admin-rates-scheme')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-rates-filter-BUFF'));
    expect(screen.getByTestId('admin-rate-MURRAH')).toBeTruthy();
    fireEvent.press(screen.getByTestId('admin-rates-filter-unpriced'));
    expect(screen.getByTestId('admin-rate-GIR')).toBeTruthy();
    expect(screen.queryByTestId('admin-rate-SAHIWAL')).toBeNull();
  });

  it('marks an edit unsaved and saves only what changed, with the pregnancy rate', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockRates(sent);
    renderWithStore(<AdminRatesScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-rate-GIR')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('admin-rates-pd-member').props.value).toBe('0'));

    fireEvent.press(screen.getByTestId('admin-rates-save'));
    expect(screen.getByTestId('admin-rates-flash')).toHaveTextContent(/Nothing has changed\./);

    fireEvent.changeText(screen.getByTestId('admin-rate-GIR-member'), '320');
    expect(within(screen.getByTestId('admin-rate-GIR')).getByText('Unsaved')).toBeTruthy();
    expect(screen.getByTestId('admin-rate-GIR')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    fireEvent.changeText(screen.getByTestId('admin-rates-pd-member'), '100');
    fireEvent.changeText(screen.getByTestId('admin-rates-pd-non-member'), '150');
    expect(screen.getByTestId('admin-rates-bar')).toHaveTextContent(/2 unsaved changes/);

    fireEvent.press(screen.getByTestId('admin-rates-bar-save'));
    await waitFor(() => expect(sent).toHaveLength(2));
    const breed = sent.find(s => s.url.includes('/admin/breeds/2/'));
    expect(breed?.method).toBe('PATCH');
    expect(breed?.body).toEqual({ rate: 320, non_member_rate: 350 });
    const pd = sent.find(s => s.url.includes('/admin/pregnancy/rate/'));
    expect(pd?.method).toBe('PATCH');
    expect(pd?.body).toEqual({ member_rate: 100, non_member_rate: 150 });
    await waitFor(() =>
      expect(screen.getByTestId('admin-rates-flash')).toHaveTextContent(/2 rates saved\./),
    );
  });

  it('names the breed that did not save', async () => {
    const sent: { url: string; method: string; body: unknown }[] = [];
    mockRates(sent, { member_rate: '100.00', non_member_rate: '150.00' }, 1);
    renderWithStore(<AdminRatesScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-rate-SAHIWAL')).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId('admin-rates-pd')).toHaveStyle({
        backgroundColor: colors.primaryWash,
      }),
    );

    fireEvent.changeText(screen.getByTestId('admin-rate-SAHIWAL-non-member'), '420');
    fireEvent.press(screen.getByTestId('admin-rates-save'));
    await waitFor(() =>
      expect(screen.getByTestId('admin-rates-flash')).toHaveTextContent(
        /Could not save: Sahiwal\./,
      ),
    );
    // What did not land keeps its typed figure, still marked unsaved.
    expect(screen.getByTestId('admin-rate-SAHIWAL-non-member').props.value).toBe('420');
    expect(within(screen.getByTestId('admin-rate-SAHIWAL')).getByText('Unsaved')).toBeTruthy();
  });
});

describe('AdminDashboardScreen, against a summary it does not understand', () => {
  it('says the load failed rather than crashing the app', async () => {
    // An older server, or anything answering with the wrong shape: no pregnancy block.
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({ count: 0, next: null, previous: null, results: [] }),
    );
    renderWithStore(<AdminDashboardScreen />, { store: storeFor('admin') });
    await waitFor(() =>
      expect(screen.getByText(i18n.t('admin.dashboard.error') as string)).toBeTruthy(),
    );
  });
});

describe('AdminDashboardScreen', () => {
  /** The summary as the server sends it — `conception_rate`, not the `rate` the app once read. */
  const SUMMARY = {
    today: 42,
    today_delta_percent: 10,
    this_week: 210,
    this_month: 900,
    last_month_to_same_day: 850,
    lifetime: 32006,
    since: 'Jan 2026',
    highest_day: { value: 60, label: '05 Sep 2026' },
    highest_month: { value: 1200, label: 'September 2026' },
    scope: { scoped: false, zones: [], plant_codes: null },
    exceptions: {
      pending_payments: {
        count: 3,
        rows: [{ label: 'Barsana · ₹250', meta: '2 days old', severity: 'warning' }],
        more: 2,
      },
      failed_otps: { count: 0, rows: [], more: 0 },
      low_stock: {
        count: 1,
        rows: [{ label: 'Sunil Kumar', meta: 'Murrah 1', severity: 'error' }],
        more: 0,
      },
      stale_indents: { count: 0, rows: [], more: 0 },
      overdue_checks: { count: 2, rows: [], more: 2 },
      declined_checks: { count: 0, rows: [], more: 0 },
    },
    pregnancy: { conception_rate: 75, conceived: 6, decided: 8, overdue: 2, declined_30d: 0 },
  };
  const TRENDS = {
    days: 7,
    results: [
      { date: '2026-10-22', label: '22 Oct', short_label: 'Thu', completed: 3, pending: 1 },
      { date: '2026-10-23', label: '23 Oct', short_label: 'Fri', completed: 0, pending: 0 },
    ],
  };
  const ZONES = {
    days: 7,
    results: [
      { code: 'ZONE2', name: 'Pratapgarh Zone', plants: 4, events: 4, share_percent: 100 },
      { code: 'ZONE3', name: 'Ayodhya Zone', plants: 5, events: 0, share_percent: 0 },
    ],
  };

  function mockDashboard() {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/dashboard/trends/')) {
        return jsonResponse(TRENDS);
      }
      if (url.includes('/dashboard/zones/')) {
        return jsonResponse(ZONES);
      }
      return jsonResponse(SUMMARY);
    });
  }

  it('leads with today, then the week, month, all-time and the conception rate', async () => {
    mockDashboard();
    renderWithStore(<AdminDashboardScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('dashboard-today')).toHaveTextContent('42'));
    expect(screen.getByText('+10% vs yesterday')).toBeTruthy();
    expect(screen.getByTestId('dashboard-week')).toHaveTextContent(/This week\s*210/);
    expect(screen.getByTestId('dashboard-month')).toHaveTextContent(/This month\s*900/);
    expect(screen.getByTestId('dashboard-lifetime')).toHaveTextContent(/32,006/);
    expect(screen.getByTestId('dashboard-lifetime')).toHaveTextContent(/since Jan 2026/);
    // The rate the server sends, which the tile used to miss and show as a dash.
    expect(screen.getByTestId('dashboard-conception')).toHaveTextContent(/75%/);
    expect(screen.getByTestId('dashboard-conception')).toHaveTextContent(/6 of 8 checks/);
  });

  it('charts the days and shares out the zones', async () => {
    mockDashboard();
    renderWithStore(<AdminDashboardScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('dashboard-chart')).toBeTruthy());
    expect(screen.getByTestId('dashboard-bar-2026-10-22')).toHaveTextContent(/4/);
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-zone-ZONE2')).toHaveTextContent(/Pratapgarh Zone/),
    );
    expect(screen.getByTestId('dashboard-zone-ZONE2')).toHaveTextContent(/4 AIs/);
  });

  it('lists every queue that needs a person, and opens Exceptions from them', async () => {
    mockDashboard();
    const onOpenExceptions = jest.fn();
    renderWithStore(<AdminDashboardScreen onOpenExceptions={onOpenExceptions} />, {
      store: storeFor('admin'),
    });

    await waitFor(() =>
      expect(screen.getByTestId('dashboard-queue-pending_payments')).toBeTruthy(),
    );
    expect(screen.getByTestId('dashboard-queue-pending_payments')).toHaveTextContent(
      /Barsana · ₹250/,
    );
    expect(screen.getByTestId('dashboard-queue-low_stock')).toHaveTextContent(/Sunil Kumar/);
    expect(screen.getByTestId('dashboard-queue-stale_indents')).toHaveTextContent(/All clear/);
    expect(screen.getByTestId('dashboard-queue-overdue_checks')).toBeTruthy();

    fireEvent.press(screen.getByTestId('dashboard-queue-pending_payments'));
    expect(onOpenExceptions).toHaveBeenCalled();
  });

  it('says it all in Hindi', async () => {
    mockDashboard();
    await i18n.changeLanguage('hi');
    try {
      renderWithStore(<AdminDashboardScreen />, { store: storeFor('admin') });

      await waitFor(() => expect(screen.getByText('आज के AI')).toBeTruthy());
      expect(screen.getByText('गर्भधारण दर')).toBeTruthy();
      expect(screen.getByText('रोज़ के AI')).toBeTruthy();
      expect(screen.getByText('ज़ोन के अनुसार AI')).toBeTruthy();
      expect(screen.getByText('लंबित भुगतान')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('AdminAuditScreen', () => {
  const PII = {
    id: 901,
    when: new Date(Date.now() - 5 * 60000).toISOString(),
    action: 'pii_access',
    action_label: 'Personal data read',
    tone: 'bad',
    entity_type: 'member',
    entity_label: 'Member',
    entity_id: 'MEM-001',
    summary: 'Opened the Aadhaar card of member MEM-001',
    actor: { name: 'Office Admin', role: 'Admin', initials: 'OA', system: false },
    ip_address: '10.0.0.4',
    changes: [],
    facts: [{ label: 'Aadhaar card viewed', value: 'Front' }],
    request_id: 'req-7f3a',
  };
  const SCHEME = {
    ...PII,
    id: 902,
    action: 'update',
    action_label: 'Updated',
    tone: 'info',
    entity_type: 'mait_payout_scheme',
    entity_label: 'Mait payout scheme',
    entity_id: '1',
    summary: 'Updated Mait payout scheme 1',
    changes: [{ field: 'Commission per AI', from: '220', to: '240' }],
    facts: [],
    request_id: '',
  };
  const JOB = {
    ...PII,
    id: 903,
    action: 'create',
    action_label: 'Created',
    tone: 'good',
    entity_type: 'data_upload_log',
    entity_label: 'SAP upload',
    entity_id: '44',
    summary: 'Created SAP upload 44',
    actor: { name: 'System', role: '', initials: 'SY', system: true },
    ip_address: '',
    changes: [],
    facts: [],
    request_id: '',
  };
  const TRAIL = {
    count: 120,
    limit: 50,
    offset: 0,
    results: [PII, SCHEME, JOB],
    summary: { window_days: 30, total: 1532, today: 41, people: 9, pii_access: 17 },
    facets: {
      actions: [
        { key: 'login', label: 'Signed in', tone: null, count: 900 },
        { key: 'pii_access', label: 'Personal data read', tone: 'bad', count: 17 },
      ],
      entity_types: [
        { key: 'member', label: 'Member', count: 300 },
        { key: 'indent', label: 'Indent', count: 80 },
      ],
    },
  };

  function mockAudit(urls: string[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      urls.push(url);
      const offset = Number(url.match(/offset=(\d+)/)?.[1] ?? 0);
      // A filtered ask matches nothing, so the empty answer can be told from the sample.
      if (/[?&](search|action|entity_type|date_from)=/.test(url)) {
        return jsonResponse({ ...TRAIL, count: 0, results: [] });
      }
      return jsonResponse({ ...TRAIL, offset });
    });
  }

  async function open(urls: string[] = []) {
    mockAudit(urls);
    renderWithStore(<AdminAuditScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-audit-901')).toBeTruthy());
  }

  it('leads with the last thirty days, and colours personal data red', async () => {
    await open();

    expect(screen.getByTestId('admin-audit-tile-total-value')).toHaveTextContent('1,532');
    expect(screen.getByTestId('admin-audit-tile-total-foot')).toHaveTextContent(
      'in the last 30 days',
    );
    expect(screen.getByTestId('admin-audit-tile-today-value')).toHaveTextContent('41');
    expect(screen.getByTestId('admin-audit-tile-people-value')).toHaveTextContent('9');
    expect(screen.getByTestId('admin-audit-tile-pii-value')).toHaveTextContent('17');
    expect(screen.getByTestId('admin-audit-count')).toHaveTextContent('120 entries');

    // The trail's own tones: personal data red, an edit blue, a creation green.
    expect(screen.getByTestId('admin-audit-901')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('admin-audit-902')).toHaveStyle({ backgroundColor: colors.infoWash });
    expect(screen.getByTestId('admin-audit-903')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-audit-901')).toHaveTextContent(
      /Office Admin.*5 min ago.*Personal data read.*Opened the Aadhaar card.*Member · MEM-001.*10\.0\.0\.4/,
    );
    expect(screen.getByTestId('admin-audit-903')).toHaveTextContent(/System/);
    expect(screen.getByTestId('admin-audit-action-pii_access')).toHaveTextContent(
      /Personal data read 17/,
    );
  });

  it('opens an entry to its change, its facts and its request', async () => {
    const urls: string[] = [];
    await open(urls);

    // Nothing folded away, nothing to open.
    expect(screen.queryByTestId('admin-audit-toggle-903')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-audit-toggle-902'));
    expect(screen.getByTestId('admin-audit-detail-902')).toHaveTextContent(
      /Commission per AI.*220.*240/,
    );
    fireEvent.press(screen.getByTestId('admin-audit-toggle-901'));
    expect(screen.queryByTestId('admin-audit-detail-902')).toBeNull();
    expect(screen.getByTestId('admin-audit-detail-901')).toHaveTextContent(
      /Aadhaar card viewed.*Front/,
    );

    // Following the request is a search for it, shown in the search box.
    fireEvent.press(screen.getByTestId('admin-audit-trace-901'));
    expect(screen.getByTestId('admin-audit-search').props.value).toBe('req-7f3a');
    await waitFor(() => expect(urls.some(u => u.includes('search=req-7f3a'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByText('Nothing in the trail matches that.')).toBeTruthy(),
    );
  });

  it('narrows by action and record type, and clears them all', async () => {
    const urls: string[] = [];
    await open(urls);

    fireEvent.press(screen.getByTestId('admin-audit-action-pii_access'));
    await waitFor(() => expect(urls.some(u => u.includes('action=pii_access'))).toBe(true));

    fireEvent.press(screen.getByTestId('admin-audit-type'));
    fireEvent.press(screen.getByTestId('admin-audit-type-indent'));
    await waitFor(() =>
      expect(
        urls.some(u => u.includes('entity_type=indent') && u.includes('action=pii_access')),
      ).toBe(true),
    );
    expect(screen.getByTestId('admin-audit-type-value')).toHaveTextContent('Indent');

    fireEvent.press(screen.getByTestId('admin-audit-clear'));
    await waitFor(() => expect(screen.getByTestId('admin-audit-901')).toBeTruthy());
    expect(screen.getByTestId('admin-audit-type-value')).toHaveTextContent('All record types');
  });

  it('pages fifty at a time', async () => {
    const urls: string[] = [];
    await open(urls);
    expect(urls.some(u => u.includes('limit=50'))).toBe(true);
    expect(screen.getByTestId('admin-audit-page')).toHaveTextContent('1–50 of 120');
    fireEvent.press(screen.getByTestId('admin-audit-next'));
    await waitFor(() => expect(urls.some(u => u.includes('offset=50'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('admin-audit-page')).toHaveTextContent('51–100 of 120'),
    );
  });

  it('exports the filters, never the paging, and reloads the trail after', async () => {
    const urls: string[] = [];
    await open(urls);
    (downloadAndShare as jest.Mock).mockClear();

    fireEvent.press(screen.getByTestId('admin-audit-next'));
    await waitFor(() => expect(urls.some(u => u.includes('offset=50'))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-audit-action-pii_access'));
    await waitFor(() => expect(urls.some(u => u.includes('action=pii_access'))).toBe(true));
    const before = urls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-audit-export'));
    });
    expect(downloadAndShare).toHaveBeenCalledWith(
      '/admin/audit/export/?action=pii_access',
      expect.stringMatching(/^audit-trail-\d{4}-\d{2}-\d{2}\.xlsx$/),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expect.any(String),
    );
    await waitFor(() => expect(urls.length).toBeGreaterThan(before));
  });

  it('says so plainly when the workbook fails', async () => {
    await open();
    (downloadAndShare as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-audit-export'));
    });
    expect(screen.getByTestId('admin-audit-problem')).toHaveTextContent(
      'The workbook could not be produced. Try a narrower date range.',
    );
  });

  it("reads the trail's tones and keeps an empty filter out of the query", () => {
    expect(['good', 'bad', 'warn', 'info', null].map(auditTone)).toEqual([
      'green',
      'red',
      'yolk',
      'blue',
      'slate',
    ]);
    expect(auditParams({ search: '', action: 'login', date_from: '2026-10-01' })).toEqual({
      action: 'login',
      date_from: '2026-10-01',
    });
  });
});

describe('AdminUsersScreen', () => {
  const ALL = [
    'dashboard',
    'uploads',
    'ai-events',
    'maits',
    'mpps',
    'assignments',
    'members',
    'non-members',
    'inventory',
    'products',
    'rates',
    'indents',
    'stores',
    'leaderboard',
    'pregnancy',
    'exceptions',
    'reports',
    'mait-payment',
    'users',
    'super-otp',
    'zones',
    'logs',
  ];
  const BASE = {
    email: '',
    mobile_no: '',
    is_active: true,
    fixed_otp_enabled: false,
    last_login_at: null,
    mait_name: null,
    sahayak_vendor_code: null,
    assigned_mpp_count: 0,
    portal_sections: ALL,
    portal_section_total: 22,
    zones: [],
    zone_names: [],
  };
  // Account 1 is the one signed in (`storeFor` signs in as id 1).
  const ME = {
    ...BASE,
    id: 1,
    username: 'office',
    full_name: 'Office Admin',
    role: 'admin',
    role_display: 'Admin',
  };
  const RAVI = {
    ...BASE,
    id: 2,
    username: 'ravi',
    full_name: 'Ravi Verma',
    email: 'ravi@example.com',
    role: 'admin',
    role_display: 'Admin',
    portal_sections: ALL.slice(0, 12),
    zones: ['BRH'],
    zone_names: ['Bahraich Zone'],
    last_login_at: '2026-10-20T09:05:00Z',
  };
  const BOSS = {
    ...BASE,
    id: 3,
    username: 'boss',
    full_name: 'Head Office',
    role: 'super_admin',
    role_display: 'Super Admin',
  };
  const CLERK = {
    ...BASE,
    id: 4,
    username: 'clerk',
    full_name: 'Desk Clerk',
    role: 'normal_user',
    role_display: 'Normal User',
    portal_sections: [],
    is_active: false,
  };
  const SUNIL = {
    ...BASE,
    id: 5,
    username: 'mait1001',
    full_name: 'Sunil Kumar',
    role: 'mait',
    role_display: 'Mait',
    portal_sections: [],
    assigned_mpp_count: 3,
    fixed_otp_enabled: true,
  };
  const ZONES = [
    {
      id: 1,
      code: 'BRH',
      name: 'Bahraich Zone',
      description: '',
      is_active: true,
      plant_names: ['Bahraich BMC', 'Nanpara MCC'],
      mpp_count: 10,
      member_count: 100,
      user_count: 1,
    },
    {
      id: 2,
      code: 'GND',
      name: 'Gonda Zone',
      description: '',
      is_active: true,
      plant_names: [],
      mpp_count: 0,
      member_count: 0,
      user_count: 0,
    },
    {
      id: 3,
      code: 'OLD',
      name: 'Retired Zone',
      description: '',
      is_active: false,
      plant_names: [],
      mpp_count: 0,
      member_count: 0,
      user_count: 0,
    },
  ];

  type Sent = { url: string; method: string; body: Record<string, unknown> | null };

  function mockUsers(sent: Sent[] = [], { refuse = {} as Record<number, string>, count = 5 } = {}) {
    const users: Record<number, Record<string, unknown>> = {};
    [ME, RAVI, BOSS, CLERK, SUNIL].forEach(u => (users[u.id] = { ...u }));
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      const body = method === 'GET' ? null : await input.clone().json();
      sent.push({ url, method, body });
      if (url.includes('/portal-sections/')) {
        return jsonResponse({ results: ALL.map(key => ({ key, label: key })), count: ALL.length });
      }
      if (url.includes('/admin/zones/')) {
        return jsonResponse(ZONES);
      }
      if (method === 'PATCH') {
        const id = Number(url.match(/users\/(\d+)\//)?.[1]);
        if (refuse[id]) {
          return jsonResponse({ is_active: [refuse[id]] }, 400);
        }
        users[id] = { ...users[id], ...body };
        if (body?.zones) {
          users[id]!.zone_names = (body.zones as string[]).map(
            c => ZONES.find(z => z.code === c)!.name,
          );
        }
        return jsonResponse(users[id]);
      }
      if (method === 'POST') {
        if (body?.username === 'taken') {
          return jsonResponse({ username: ['That username is already taken.'] }, 400);
        }
        return jsonResponse({ ...BASE, id: 9, role_display: 'Admin', ...body }, 201);
      }
      return jsonResponse({
        count,
        next: null,
        previous: null,
        results: Object.values(users),
      });
    });
  }

  async function open(sent: Sent[] = [], options?: Parameters<typeof mockUsers>[1]) {
    mockUsers(sent, options);
    renderWithStore(<AdminUsersScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-user-ravi')).toBeTruthy());
  }

  it('reads every column of an account off its card, in its colour', async () => {
    await open();

    expect(screen.getByTestId('admin-users-count')).toHaveTextContent('5 portal accounts');
    expect(screen.getByTestId('admin-users-split')).toHaveTextContent('4 active · 1 deactivated');

    // Pages: a count, all of them, none (worth acting on), or no portal at all.
    expect(screen.getByTestId('admin-user-pages-ravi')).toHaveTextContent(/12 of 22/);
    expect(screen.getByTestId('admin-user-pages-boss')).toHaveTextContent(/All 22/);
    expect(screen.getByTestId('admin-user-pages-clerk')).toHaveTextContent(/No pages/);
    expect(screen.getByTestId('admin-user-pages-mait1001')).toHaveTextContent(/No portal/);

    // Scope: the zones and whether the app can open, the whole network, or a Mait's MPPs.
    expect(screen.getByTestId('admin-user-scope-ravi')).toHaveTextContent(/Bahraich Zone/);
    expect(screen.getByTestId('admin-user-scope-ravi')).toHaveTextContent(/No number — no app/);
    expect(screen.getByTestId('admin-user-scope-boss')).toHaveTextContent(/Whole network/);
    expect(screen.getByTestId('admin-user-scope-mait1001')).toHaveTextContent(/3 MPPs/);
    expect(screen.getByTestId('admin-user-ravi')).toHaveTextContent(/20 Oct 2026/);
    expect(screen.getByTestId('admin-user-clerk')).toHaveTextContent(/Never/);

    // Switched off is red; signing in past the OTP is yellow and says so; the rest green.
    expect(screen.getByTestId('admin-user-clerk')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('admin-user-status-clerk')).toHaveTextContent(/Deactivated/);
    expect(screen.getByTestId('admin-user-mait1001')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-user-status-mait1001')).toHaveTextContent(/Code 123456/);
    expect(screen.getByTestId('admin-user-ravi')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-user-toggle-clerk')).toHaveTextContent(/Reactivate/);

    // Your own account is marked, and cannot be ticked into a bulk action.
    expect(screen.getByTestId('admin-user-status-office')).toHaveTextContent(/You/);
    expect(screen.queryByTestId('admin-user-pick-office')).toBeNull();
    expect(screen.getByTestId('admin-users-notice')).toHaveTextContent(
      /Field staff never get a portal account/,
    );
  });

  it('searches and filters by role on the server, and pages through', async () => {
    const sent: Sent[] = [];
    await open(sent, { count: 40 });

    // Every role pill is drawn whole in a wrapping row, never in a strip that slices one off.
    const roles = screen.getByTestId('admin-users-roles');
    expect(roles).toHaveStyle({ flexWrap: 'wrap' });
    for (const r of ['all', 'super_admin', 'admin', 'normal_user', 'mait']) {
      expect(within(roles).getByTestId(`admin-users-role-${r}`)).toBeTruthy();
    }

    fireEvent.changeText(screen.getByTestId('admin-users-search'), ' ravi ');
    await waitFor(() => expect(sent.some(s => /users\/\?.*search=ravi/.test(s.url))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-users-role-normal_user'));
    await waitFor(() =>
      expect(sent.some(s => /role=normal_user/.test(s.url) && /search=ravi/.test(s.url))).toBe(
        true,
      ),
    );

    expect(screen.getByTestId('admin-users-page')).toHaveTextContent('1–25 of 40');
    fireEvent.press(screen.getByTestId('admin-users-next'));
    await waitFor(() => expect(sent.some(s => /offset=25/.test(s.url))).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('admin-users-page')).toHaveTextContent('26–40 of 40'),
    );
  });

  it('switches one account off from its row, and repaints only that row', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-user-toggle-ravi'));
    await waitFor(() =>
      expect(screen.getByTestId('admin-user-status-ravi')).toHaveTextContent(/Deactivated/),
    );
    const patch = sent.find(s => s.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/admin\/users\/2\/$/);
    expect(patch.body).toEqual({ is_active: false });
    expect(screen.getByTestId('admin-user-toggle-ravi')).toHaveTextContent(/Reactivate/);
  });

  it('asks before you switch your own account off', async () => {
    const sent: Sent[] = [];
    await open(sent);
    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce(() => undefined);

    fireEvent.press(screen.getByTestId('admin-user-toggle-office'));
    expect(alert).toHaveBeenCalledWith(
      'Deactivate your own account?',
      expect.any(String),
      expect.any(Array),
    );
    expect(sent.some(s => s.method === 'PATCH')).toBe(false);
    alert.mockRestore();
  });

  it('offers each bulk action counted, only where it changes something, and names a refusal', async () => {
    const sent: Sent[] = [];
    await open(sent, { refuse: { 3: 'You cannot deactivate the last Super Admin.' } });

    fireEvent.press(screen.getByTestId('admin-user-pick-ravi'));
    fireEvent.press(screen.getByTestId('admin-user-pick-clerk'));
    expect(screen.getByTestId('admin-users-bulk-count')).toHaveTextContent('2 accounts selected');
    // One live, one switched off: one of each, and nobody to switch off the fixed code for.
    expect(screen.getByTestId('admin-users-bulk-activate')).toHaveTextContent(/Activate 1/);
    expect(screen.getByTestId('admin-users-bulk-deactivate')).toHaveTextContent(/Deactivate 1/);
    expect(screen.getByTestId('admin-users-bulk-fixedOn')).toHaveTextContent(/Fixed code on · 2/);
    expect(screen.queryByTestId('admin-users-bulk-fixedOff')).toBeNull();

    // Select page ticks everyone but you.
    fireEvent.press(screen.getByTestId('admin-users-pick-all'));
    expect(screen.getByTestId('admin-users-bulk-count')).toHaveTextContent('4 accounts selected');

    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, body, buttons) => {
      expect(body).toMatch(/Deactivate 3 accounts\?/);
      buttons?.find(b => b.text === 'Deactivate')?.onPress?.();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-users-bulk-deactivate'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-users-bulk-status')).toHaveTextContent(
        '2 changed · 1 refused: Head Office',
      ),
    );
    const patched = sent.filter(s => s.method === 'PATCH');
    expect(patched.map(s => s.url.match(/users\/(\d+)\//)?.[1]).sort()).toEqual(['2', '3', '5']);
    patched.forEach(s => expect(s.body).toEqual({ is_active: false }));
    expect(screen.getByTestId('admin-users-problem')).toHaveTextContent(
      'Head Office — You cannot deactivate the last Super Admin.',
    );
    expect(screen.getByTestId('admin-user-status-ravi')).toHaveTextContent(/Deactivated/);
    alert.mockRestore();
  });

  it('edits the pages an Admin opens, naming what is taken away', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-user-pages-ravi'));
    await waitFor(() => expect(screen.getByTestId('admin-access-count')).toBeTruthy());
    expect(screen.getByTestId('admin-access-count')).toHaveTextContent('12 of 22');
    expect(screen.getByTestId('admin-access-diff')).toHaveTextContent('Nothing changed yet.');

    fireEvent.press(screen.getByTestId('admin-access-rates'));
    fireEvent.press(screen.getByTestId('admin-access-logs'));
    expect(screen.getByTestId('admin-access-diff')).toHaveTextContent(
      'Adding Audit log · Removing Rates',
    );
    fireEvent.press(screen.getByTestId('admin-access-none'));
    expect(screen.getByTestId('admin-access-diff')).toHaveTextContent(
      /They will sign in to an empty sidebar/,
    );
    fireEvent.press(screen.getByTestId('admin-access-all'));
    expect(screen.getByTestId('admin-access-count')).toHaveTextContent('All 22');

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-user-pages-ravi')).toHaveTextContent(/All 22/),
    );
    expect(sent.find(s => s.method === 'PATCH')!.body).toEqual({ portal_sections: ALL });
    expect(screen.getByTestId('admin-users-flash')).toHaveTextContent(
      'Changes saved for Ravi Verma.',
    );
  });

  it("never opens a Super Admin's pages, or your own", async () => {
    await open();
    fireEvent.press(screen.getByTestId('admin-user-pages-boss'));
    fireEvent.press(screen.getByTestId('admin-user-pages-office'));
    fireEvent.press(screen.getByTestId('admin-user-scope-office'));
    expect(screen.queryByTestId('admin-user-editor')).toBeNull();
  });

  it('gives an Admin a zone and the number that opens the app, sending only what moved', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-user-scope-ravi'));
    await waitFor(() => expect(screen.getByTestId('admin-zone-BRH')).toBeTruthy());
    // An inactive zone scopes nothing, so it is not offered.
    expect(screen.queryByTestId('admin-zone-OLD')).toBeNull();
    expect(screen.getByTestId('admin-zone-BRH')).toHaveTextContent(/Bahraich BMC, Nanpara MCC/);
    expect(screen.getByTestId('admin-zone-GND')).toHaveTextContent(/no BMC\/MCC yet/);
    expect(screen.getByTestId('admin-zone-app')).toHaveTextContent(/Without a number/);

    fireEvent.press(screen.getByTestId('admin-zone-GND'));
    expect(screen.getByTestId('admin-zone-count')).toHaveTextContent('2 zones');
    fireEvent.changeText(screen.getByTestId('admin-zone-mobile'), '98765-43210x');
    expect(screen.getByTestId('admin-zone-mobile').props.value).toBe('9876543210');
    expect(screen.getByTestId('admin-zone-app')).toHaveTextContent(
      'They can sign in to the zonal manager app on this number.',
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-user-scope-ravi')).toHaveTextContent(/Gonda Zone/),
    );
    expect(sent.find(s => s.method === 'PATCH')!.body).toEqual({
      zones: ['BRH', 'GND'],
      mobile_no: '9876543210',
    });
    expect(screen.getByTestId('admin-user-scope-ravi')).toHaveTextContent(/App · 9876543210/);
  });

  it('moves somebody to the whole network without touching their number', async () => {
    const sent: Sent[] = [];
    await open(sent);
    fireEvent.press(screen.getByTestId('admin-user-scope-ravi'));
    await waitFor(() => expect(screen.getByTestId('admin-zone-none')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-zone-none'));
    expect(screen.getByTestId('admin-zone-count')).toHaveTextContent('None — whole network');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() => expect(sent.some(s => s.method === 'PATCH')).toBe(true));
    expect(sent.find(s => s.method === 'PATCH')!.body).toEqual({ zones: [] });
  });

  it('corrects details, sending only the fields that changed', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-user-name-ravi'));
    await waitFor(() => expect(screen.getByTestId('admin-details-name')).toBeTruthy());
    expect(screen.getByTestId('admin-details-mobile-hint')).toHaveTextContent(
      /The number they sign into the app with/,
    );

    fireEvent.changeText(screen.getByTestId('admin-details-name'), '  ');
    fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
      'A name is what the rest of the portal calls this account.',
    );
    fireEvent.changeText(screen.getByTestId('admin-details-name'), 'Ravi Kumar Verma');
    fireEvent.changeText(screen.getByTestId('admin-details-mobile'), '12345');
    fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
      'A mobile number is ten digits, starting 6 to 9.',
    );
    fireEvent.changeText(screen.getByTestId('admin-details-mobile'), '');
    fireEvent.press(screen.getByTestId('admin-details-role-normal_user'));
    fireEvent.press(screen.getByTestId('admin-details-fixed'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() => expect(screen.getByText('Ravi Kumar Verma')).toBeTruthy());
    expect(sent.find(s => s.method === 'PATCH')!.body).toEqual({
      full_name: 'Ravi Kumar Verma',
      fixed_otp_enabled: true,
      role: 'normal_user',
    });
    expect(screen.getByTestId('admin-user-status-ravi')).toHaveTextContent(/Code 123456/);
  });

  it('offers no role switch for a Super Admin', async () => {
    await open();
    fireEvent.press(screen.getByTestId('admin-user-name-boss'));
    await waitFor(() => expect(screen.getByTestId('admin-details-name')).toBeTruthy());
    expect(screen.queryByTestId('admin-details-role-admin')).toBeNull();
  });

  it('changes a username and resets a password, checked before it is sent', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-user-username-ravi'));
    await waitFor(() => expect(screen.getByTestId('admin-cred-username')).toBeTruthy());
    expect(screen.getByTestId('admin-cred-username').props.value).toBe('ravi');

    fireEvent.changeText(screen.getByTestId('admin-cred-password'), 'short');
    fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
      'A password needs at least 10 characters.',
    );
    fireEvent.changeText(screen.getByTestId('admin-cred-password'), 'long-enough-1');
    fireEvent.changeText(screen.getByTestId('admin-cred-confirm'), 'long-enough-2');
    fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
      'The two passwords do not match.',
    );

    fireEvent.changeText(screen.getByTestId('admin-cred-confirm'), 'long-enough-1');
    fireEvent.changeText(screen.getByTestId('admin-cred-username'), 'ravi.v');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-users-flash')).toHaveTextContent(
        'Username updated and password reset for Ravi Verma.',
      ),
    );
    expect(sent.find(s => s.method === 'PATCH')!.body).toEqual({
      username: 'ravi.v',
      password: 'long-enough-1',
    });
  });

  it('offers a Mait no password', async () => {
    await open();
    fireEvent.press(screen.getByTestId('admin-user-username-mait1001'));
    await waitFor(() => expect(screen.getByTestId('admin-cred-mait-note')).toBeTruthy());
    expect(screen.queryByTestId('admin-cred-password')).toBeNull();
  });

  it('creates an office account with every page ticked to start, and none for a Super Admin', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-users-create'));
    await waitFor(() => expect(screen.getByTestId('admin-create-username')).toBeTruthy());
    expect(screen.getByTestId('admin-create-access-count')).toHaveTextContent('All 22');

    fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
      /Username, full name and a temporary password/,
    );

    fireEvent.changeText(screen.getByTestId('admin-create-username'), 'taken');
    fireEvent.changeText(screen.getByTestId('admin-create-full_name'), 'New Clerk');
    fireEvent.changeText(screen.getByTestId('admin-create-password'), 'temporary-pass');
    fireEvent.press(screen.getByTestId('admin-create-access-none'));
    fireEvent.press(screen.getByTestId('admin-create-access-ai-events'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    // The server's field message, not a generic failure.
    await waitFor(() =>
      expect(screen.getByTestId('admin-user-editor-status')).toHaveTextContent(
        'That username is already taken.',
      ),
    );
    expect(sent.find(s => s.method === 'POST')!.body).toEqual({
      username: 'taken',
      full_name: 'New Clerk',
      email: '',
      mobile_no: '',
      role: 'admin',
      password: 'temporary-pass',
      portal_sections: ['ai-events'],
    });

    fireEvent.press(screen.getByTestId('admin-create-role-super_admin'));
    expect(screen.queryByTestId('admin-create-access')).toBeNull();
    fireEvent.changeText(screen.getByTestId('admin-create-username'), 'chief');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-user-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-users-flash')).toHaveTextContent(
        /Account created for New Clerk/,
      ),
    );
    const created = sent.filter(s => s.method === 'POST')[1]!.body!;
    expect(created.role).toBe('super_admin');
    expect(created).not.toHaveProperty('portal_sections');
  });
});

describe('AdminZonesScreen', () => {
  const BAHRAICH = {
    id: 1,
    code: 'BRH',
    name: 'Bahraich Zone',
    description: 'Run from Nanpara',
    is_active: true,
    plants: ['P01', 'P02'],
    plant_names: ['NANPARA', 'BAHRAICH BMC'],
    mpp_count: 247,
    member_count: 7449,
    user_count: 2,
  };
  const GONDA = {
    id: 2,
    code: 'GND',
    name: 'Gonda Zone',
    description: '',
    is_active: false,
    plants: [],
    plant_names: [],
    mpp_count: 0,
    member_count: 0,
    user_count: 0,
  };
  const PLANTS = [
    {
      plant_code: 'P01',
      plant_name: 'NANPARA',
      mpp_count: 200,
      member_count: 6000,
      zone_code: 'BRH',
      zone_name: 'Bahraich Zone',
    },
    {
      plant_code: 'P02',
      plant_name: 'BAHRAICH BMC',
      mpp_count: 47,
      member_count: 1449,
      zone_code: 'BRH',
      zone_name: 'Bahraich Zone',
    },
    {
      plant_code: 'P03',
      plant_name: 'TARABGANJ',
      mpp_count: 39,
      member_count: 900,
      zone_code: '',
      zone_name: '',
    },
    {
      plant_code: 'P04',
      plant_name: 'COLONELGANJ',
      mpp_count: 60,
      member_count: 1500,
      zone_code: '',
      zone_name: '',
    },
  ];
  const ACTIVITY = { actions: 0, approved: 0, rejected: 0, last_action_at: null };
  const RAVI = {
    id: 21,
    full_name: 'Ravi Verma',
    username: 'ravi',
    email: '',
    mobile_no: '9876543210',
    is_active: true,
    zone_codes: ['BRH'],
    zone_names: ['Bahraich Zone'],
    inactive_zones: [],
    sections: [],
    last_login_at: '2026-10-20T09:05:00Z',
    app_access: true,
    maits: 15,
    activity: { actions: 12, approved: 3, rejected: 1, last_action_at: null },
  };
  const ASHA = {
    ...RAVI,
    id: 22,
    full_name: 'Asha Singh',
    username: 'asha',
    mobile_no: '',
    app_access: false,
    maits: 0,
    last_login_at: null,
    activity: ACTIVITY,
  };
  const OMKAR = {
    ...RAVI,
    id: 23,
    full_name: 'Omkar Nath',
    username: 'omkar',
    zone_codes: ['GND'],
    zone_names: [],
    inactive_zones: ['Gonda Zone'],
    app_access: false,
    activity: { actions: 4, approved: 0, rejected: 0, last_action_at: null },
  };
  const ENTRY = {
    id: 501,
    when: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    action: 'state_change',
    action_label: 'State change',
    tone: 'info',
    entity_type: 'indent',
    entity_label: 'Indent',
    entity_id: '9',
    summary: 'Approved indent IND-9 for Tarabganj store',
    actor: { name: 'Ravi Verma', initials: 'RV' },
    ip_address: '',
  };

  type Sent = { url: string; method: string; body: unknown };

  function mockZones(sent: Sent[] = [], { refuseDelete = '', activity = [ENTRY] } = {}) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      const body = method === 'GET' || method === 'DELETE' ? null : await input.clone().json();
      sent.push({ url, method, body });
      if (method === 'DELETE') {
        return refuseDelete ? jsonResponse({ detail: refuseDelete }, 409) : jsonResponse(null, 204);
      }
      if (url.includes('/managers/')) {
        if (method === 'PATCH') {
          const b = body as { mobile_no: string };
          return jsonResponse({ ...ASHA, mobile_no: b.mobile_no, app_access: !!b.mobile_no });
        }
        return jsonResponse({
          days: 30,
          count: 3,
          without_mobile: 1,
          idle: 1,
          results: [RAVI, ASHA, OMKAR],
        });
      }
      if (url.includes('/activity/')) {
        return jsonResponse({ days: 30, count: activity.length, results: activity });
      }
      if (url.includes('/plants/')) {
        return jsonResponse({ count: PLANTS.length, unassigned: 2, results: PLANTS });
      }
      if (method === 'POST') {
        const b = body as Record<string, unknown>;
        return jsonResponse({ ...GONDA, id: 3, ...b }, 201);
      }
      if (method === 'PATCH') {
        return jsonResponse({ ...BAHRAICH, ...(body as object) });
      }
      // The zone list is a plain array — the server turns pagination off.
      return jsonResponse([BAHRAICH, GONDA]);
    });
  }

  async function open(
    sent: Sent[] = [],
    options?: Parameters<typeof mockZones>[1],
    onOpenSection = jest.fn(),
  ) {
    mockZones(sent, options);
    renderWithStore(<AdminZonesScreen onOpenSection={onOpenSection} />, {
      store: storeFor('admin'),
    });
    await waitFor(() => expect(screen.getByTestId('admin-zone-BRH')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('admin-manager-21')).toBeTruthy());
    return onOpenSection;
  }

  it('leads with the rule and the four tiles, then each zone in its colour', async () => {
    const onOpenSection = await open();

    expect(screen.getByTestId('admin-zones-count')).toHaveTextContent('2 zones');
    expect(screen.getByTestId('admin-zones-tile-zones-value')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-zones-tile-zones-foot')).toHaveTextContent('1 inactive');
    expect(screen.getByTestId('admin-zones-tile-placed-value')).toHaveTextContent('2 of 4');
    expect(screen.getByTestId('admin-zones-tile-placed-foot')).toHaveTextContent(
      '2 still to place',
    );
    expect(screen.getByTestId('admin-zones-tile-members-value')).toHaveTextContent('7,449');
    expect(screen.getByTestId('admin-zones-tile-managers-value')).toHaveTextContent('3');
    expect(screen.getByTestId('admin-zones-tile-managers-foot')).toHaveTextContent(
      '1 has no number — no app',
    );

    expect(screen.getByTestId('admin-zone-BRH')).toHaveTextContent(/NANPARA/);
    expect(screen.getByTestId('admin-zone-BRH')).toHaveTextContent(/Run from Nanpara/);
    expect(screen.getByTestId('admin-zone-accounts-BRH')).toHaveTextContent('2');
    expect(screen.getByTestId('admin-zone-BRH')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    // An empty, switched-off zone says both, in red.
    expect(screen.getByTestId('admin-zone-GND')).toHaveStyle({ backgroundColor: colors.errorWash });
    expect(screen.getByTestId('admin-zone-empty-GND')).toHaveTextContent(
      /anyone assigned sees nothing/,
    );
    expect(screen.getByTestId('admin-zone-accounts-GND')).toHaveTextContent('None');

    fireEvent.press(screen.getByTestId('admin-zones-rule-action'));
    expect(onOpenSection).toHaveBeenCalledWith('users');
  });

  it('lists who runs the zones: number, app, patch and decisions', async () => {
    await open();

    expect(screen.getByTestId('admin-zones-managers-count')).toHaveTextContent('3 accounts');
    expect(screen.getByTestId('admin-manager-app-21')).toHaveTextContent('App');
    expect(screen.getByTestId('admin-manager-21')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-manager-zone-21')).toHaveTextContent(
      /Bahraich Zone.*15 Maits/,
    );
    expect(screen.getByTestId('admin-manager-decisions-21')).toHaveTextContent(
      /3 approved.*1 rejected.*12 actions in all/,
    );

    // No number: portal only, in yellow, and said in place of the number.
    expect(screen.getByTestId('admin-manager-app-22')).toHaveTextContent('Portal only');
    expect(screen.getByTestId('admin-manager-mobile-22')).toHaveTextContent(/No number/);
    expect(screen.getByTestId('admin-manager-zone-22')).toHaveTextContent(/no Maits yet/);
    expect(screen.getByTestId('admin-manager-decisions-22')).toHaveTextContent(
      'Nothing in 30 days',
    );

    // A switched-off zone is a different reason, fixed by a different person.
    expect(screen.getByTestId('admin-manager-app-23')).toHaveTextContent(/Zone off.*Gonda Zone/);
    expect(screen.getByTestId('admin-manager-zone-23')).toHaveTextContent(/No live zone/);
    expect(screen.getByTestId('admin-manager-decisions-23')).toHaveTextContent(
      /No indent decisions.*4 actions in all/,
    );
  });

  it('reads the activity as sentences, narrowed by window, kind and manager', async () => {
    const sent: Sent[] = [];
    await open(sent);

    await waitFor(() => expect(screen.getByTestId('admin-zone-activity-501')).toBeTruthy());
    expect(screen.getByTestId('admin-zone-activity-501')).toHaveTextContent(
      /State change.*Approved indent IND-9.*Ravi Verma.*3 hours ago/,
    );
    expect(screen.getByTestId('admin-zones-activity-count')).toHaveTextContent('1 action');
    expect(screen.getByTestId('admin-zones-who-all')).toHaveTextContent(/Everyone 16/);
    expect(
      sent.some(s => /activity\/\?.*kind=decisions/.test(s.url) && /days=30/.test(s.url)),
    ).toBe(true);

    fireEvent.press(screen.getByTestId('admin-zones-days-90'));
    await waitFor(() => expect(sent.some(s => /managers\/\?days=90/.test(s.url))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-zones-kind-all'));
    await waitFor(() => expect(sent.some(s => /kind=all/.test(s.url))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-zones-who-21'));
    await waitFor(() =>
      expect(sent.some(s => /activity\/\?.*manager=21/.test(s.url) && /days=90/.test(s.url))).toBe(
        true,
      ),
    );
  });

  it('says so when a manager has done nothing in the window', async () => {
    await open([], { activity: [] });
    await waitFor(() => expect(screen.getByTestId('admin-zones-activity-empty')).toBeTruthy());
    expect(screen.getByTestId('admin-zones-activity-empty')).toHaveTextContent(
      /Nothing in the last 30 days.*sign-ins are under Everything/,
    );
    expect(screen.getByTestId('admin-zones-activity-count')).toHaveTextContent('nothing yet');
  });

  it('adds a zone from an unplaced centre, ticked to start, refusing a taken one', async () => {
    const sent: Sent[] = [];
    await open(sent);

    expect(screen.getByTestId('admin-zones-unplaced-count')).toHaveTextContent('2');
    fireEvent.press(screen.getByTestId('admin-zones-place-P03'));
    await waitFor(() => expect(screen.getByTestId('admin-zone-editor')).toBeTruthy());
    expect(screen.getByTestId('admin-zone-editor-count')).toHaveTextContent('1 of 4 ticked');
    expect(screen.getByTestId('admin-zone-editor-diff')).toHaveTextContent('Adding TARABGANJ');
    // Another zone's centre is shown, locked, with its holder.
    expect(screen.getByTestId('admin-zone-plant-P01')).toHaveTextContent(/in Bahraich Zone/);
    expect(screen.getByTestId('admin-zone-plant-P01').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(screen.getByTestId('admin-zone-plant-P04')).toHaveTextContent(/60 MPPs · 1,500 members/);
    expect(screen.queryByTestId('admin-zone-editor-delete')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-zone-editor-save'));
    expect(screen.getByTestId('admin-zone-editor-status')).toHaveTextContent(
      'Give the zone a name.',
    );
    fireEvent.changeText(screen.getByTestId('admin-zone-editor-name'), 'Gonda North');
    fireEvent.press(screen.getByTestId('admin-zone-editor-save'));
    expect(screen.getByTestId('admin-zone-editor-status')).toHaveTextContent(
      /Give the zone a code/,
    );

    fireEvent.changeText(screen.getByTestId('admin-zone-editor-code'), 'gnd2');
    fireEvent.press(screen.getByTestId('admin-zone-editor-free'));
    expect(screen.getByTestId('admin-zone-editor-count')).toHaveTextContent('2 of 4 ticked');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-zone-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-zones-flash')).toHaveTextContent(
        'Gonda North created with 2 BMC/MCCs.',
      ),
    );
    expect(sent.find(s => s.method === 'POST')!.body).toEqual({
      code: 'GND2',
      name: 'Gonda North',
      description: '',
      plants: ['P03', 'P04'],
    });
  });

  it('edits a zone, naming what is taken out, and can switch it off', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-zone-edit-BRH'));
    await waitFor(() => expect(screen.getByTestId('admin-zone-editor')).toBeTruthy());
    expect(screen.getByTestId('admin-zone-editor-meta')).toHaveTextContent(
      'BRH · 2 account(s) read this zone',
    );
    expect(screen.getByTestId('admin-zone-editor-code').props.editable).toBe(false);
    expect(screen.getByTestId('admin-zone-editor-diff')).toHaveTextContent(
      'No change to the centres in this zone.',
    );

    fireEvent.press(screen.getByTestId('admin-zone-plant-P01'));
    expect(screen.getByTestId('admin-zone-editor-diff')).toHaveTextContent('Removing NANPARA');
    fireEvent.press(screen.getByTestId('admin-zone-editor-active'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-zone-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-zones-flash')).toHaveTextContent('Bahraich Zone saved.'),
    );
    const patch = sent.find(s => s.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/admin\/zones\/1\/$/);
    expect(patch.body).toEqual({
      name: 'Bahraich Zone',
      description: 'Run from Nanpara',
      plants: ['P02'],
      is_active: false,
    });
  });

  it('warns before deleting a zone people read, and shows the refusal', async () => {
    const sent: Sent[] = [];
    await open(sent, {
      refuseDelete: 'Bahraich Zone is the zone for Ravi Verma. Move those accounts first.',
    });
    fireEvent.press(screen.getByTestId('admin-zone-edit-BRH'));
    await waitFor(() => expect(screen.getByTestId('admin-zone-editor-delete')).toBeTruthy());

    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((title, body, buttons) => {
      expect(title).toBe('Delete Bahraich Zone?');
      expect(body).toMatch(/2 accounts read this zone. The server will refuse/);
      buttons?.find(b => b.text === 'Delete')?.onPress?.();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-zone-editor-delete'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-zone-editor-status')).toHaveTextContent(
        /is the zone for Ravi Verma/,
      ),
    );
    expect(sent.find(s => s.method === 'DELETE')!.url).toMatch(/\/admin\/zones\/1\/$/);
    alert.mockRestore();
  });

  it("sets a manager's number, saying whether the app will open", async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-manager-mobile-22'));
    await waitFor(() => expect(screen.getByTestId('admin-manager-editor')).toBeTruthy());
    expect(screen.getByTestId('admin-manager-editor-hint')).toHaveTextContent(
      /With no number they can only work in the portal/,
    );
    expect(screen.getByTestId('admin-manager-editor-zones')).toHaveTextContent('Bahraich Zone');

    fireEvent.changeText(screen.getByTestId('admin-manager-editor-mobile'), '12345');
    fireEvent.press(screen.getByTestId('admin-manager-editor-save'));
    expect(screen.getByTestId('admin-manager-editor-status')).toHaveTextContent(
      'A mobile number is ten digits, starting 6 to 9.',
    );
    fireEvent.changeText(screen.getByTestId('admin-manager-editor-mobile'), '91234-56789');
    expect(screen.getByTestId('admin-manager-editor-hint')).toHaveTextContent(
      'A sign-in code will be sent to this number.',
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-manager-editor-save'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-zones-flash')).toHaveTextContent(
        'Asha Singh can sign in to the app on 9123456789.',
      ),
    );
    const patch = sent.find(s => s.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/admin\/zones\/managers\/22\/$/);
    expect(patch.body).toEqual({ mobile_no: '9123456789' });
  });

  it('works out the relative times the feed uses', () => {
    const t = i18n.t.bind(i18n);
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(relative(t, '2026-10-27T11:59:30Z', now)).toBe('just now');
    expect(relative(t, '2026-10-27T11:48:00Z', now)).toBe('12 min ago');
    expect(relative(t, '2026-10-27T11:00:00Z', now)).toBe('1 hour ago');
    expect(relative(t, '2026-10-26T12:00:00Z', now)).toBe('yesterday');
    expect(relative(t, '2026-10-21T12:00:00Z', now)).toBe('6 days ago');
  });
});

describe('AdminSuperOtpScreen', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 27, h, m).toISOString();
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();
  const BASE = {
    purpose: 'login',
    step: 'Sign-in',
    for_farmer: false,
    farmer_name: null,
    context: null,
    ai_event_id: null,
    status: 'requested',
    status_display: 'Waiting for a call',
    full_name: 'Sunil Kumar',
    role: 'mait',
    role_display: 'Mait',
    who: 'Mait · 5500000054',
    mobile_no: '9811100045',
    number_on_file: '9811100045',
    reason: '',
    requested_at: null as string | null,
    request_count: 1,
    issued_by_name: '',
    issued_at: null as string | null,
    expires_at: null as string | null,
    attempt_count: 0,
    used_at: null as string | null,
    decline_reason: '',
    sms: null as null | Record<string, unknown>,
  };
  const ASK = {
    ...BASE,
    id: 12,
    state: 'waiting',
    reason: 'The SMS never came',
    requested_at: minutesAgo(4),
    request_count: 3,
    sms: { delivered: false, sent_at: at(9, 59), sent_last_hour: 2, verified: false },
  };
  const FARMER = {
    ...BASE,
    id: 13,
    state: 'waiting',
    purpose: 'farmer_check',
    step: 'Farmer check',
    for_farmer: true,
    farmer_name: 'Kavita Devi',
    context: 'AI-100482',
    number_on_file: '9812345678',
    requested_at: minutesAgo(130),
  };
  const GIVEN = {
    ...BASE,
    id: 14,
    state: 'issued',
    full_name: 'Ramesh Yadav',
    role: 'store',
    who: 'Store · Bahraich depot',
    number_on_file: '9822200011',
    mobile_no: '9822200011',
    requested_at: minutesAgo(20),
    issued_by_name: 'Office Admin',
    issued_at: at(10, 5),
    expires_at: at(10, 15),
    attempt_count: 2,
    sms: { delivered: true, sent_at: at(10, 1), sent_last_hour: 1, verified: true },
  };
  const PHONED = {
    ...BASE,
    id: 15,
    state: 'expired',
    full_name: 'Mohan Lal',
    number_on_file: '9833300022',
  };
  const DECLINED = {
    ...BASE,
    id: 16,
    state: 'declined',
    full_name: 'Gita Rani',
    requested_at: minutesAgo(3000),
    decline_reason: 'Could not reach them',
  };
  const USED = { ...BASE, id: 17, state: 'used', full_name: 'Hari Om', used_at: at(11, 30) };
  const ROWS = [ASK, FARMER, GIVEN, PHONED, DECLINED, USED];
  const CODE = {
    ...FARMER,
    state: 'issued',
    code: '482917',
    expires_at: new Date(Date.now() + 600000).toISOString(),
  };

  type Sent = { url: string; method: string; body: unknown };

  function mockOtp(sent: Sent[] = [], { refuse = '' } = {}) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      const method = input.method ?? 'GET';
      const body = method === 'GET' ? null : await input.clone().json();
      sent.push({ url, method, body });
      if (method === 'POST') {
        if (refuse) {
          return jsonResponse({ mobile_no: [refuse] }, 400);
        }
        if (url.includes('/decline/')) {
          return jsonResponse({ ...ASK, state: 'declined' });
        }
        if (url.includes('/issue-for-number/')) {
          return jsonResponse({ ...GIVEN, code: '115599', expires_at: CODE.expires_at });
        }
        return jsonResponse(CODE);
      }
      // A plain array, not a page — the server turns pagination off here.
      return jsonResponse(ROWS);
    });
  }

  async function open(sent: Sent[] = [], options?: Parameters<typeof mockOtp>[1]) {
    mockOtp(sent, options);
    renderWithStore(<AdminSuperOtpScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-superotp-12')).toBeTruthy());
  }

  it('leads with the rule, then reads every column of an ask off its card', async () => {
    await open();

    expect(screen.getByTestId('admin-superotp-count')).toHaveTextContent(
      '2 people waiting for a call',
    );
    expect(screen.getByTestId('admin-superotp-rule')).toHaveTextContent(
      /Call the number on file. Never read a code to whoever rang./,
    );

    // Waiting: when, how often, why, and that the gateway did not deliver.
    expect(screen.getByTestId('admin-superotp-pills-12')).toHaveTextContent(/Sign-in/);
    expect(screen.getByTestId('admin-superotp-pills-12')).toHaveTextContent(/Waiting for a call/);
    expect(screen.getByTestId('admin-superotp-asked-12')).toHaveTextContent(/4 min ago · asked 3×/);
    expect(screen.getByTestId('admin-superotp-asked-12')).toHaveTextContent(/“The SMS never came”/);
    expect(screen.getByTestId('admin-superotp-sms-12')).toHaveTextContent(
      /Not delivered · 09:59.*2 sent in the last hour/,
    );
    expect(screen.getByTestId('admin-superotp-12')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });

    // A farmer's step names her, and who asked.
    expect(screen.getByTestId('admin-superotp-13')).toHaveTextContent(/Kavita Devi/);
    expect(screen.getByTestId('admin-superotp-13')).toHaveTextContent(
      /AI-100482 · asked by Sunil Kumar/,
    );
    expect(screen.getByTestId('admin-superotp-asked-13')).toHaveTextContent(/2 h ago/);

    // A code given: by whom, until when, how many wrong — and the gateway's word for it.
    expect(screen.getByTestId('admin-superotp-detail-14')).toHaveTextContent(
      'by Office Admin at 10:05 · until 10:15 · 2 wrong',
    );
    expect(screen.getByTestId('admin-superotp-sms-14')).toHaveTextContent(
      /Gateway sent it 10:01.*1 sent in the last hour · last one was used/,
    );
    expect(screen.getByTestId('admin-superotp-14')).toHaveStyle({
      backgroundColor: colors.infoWash,
    });

    expect(screen.getByTestId('admin-superotp-asked-15')).toHaveTextContent(/Phoned the office/);
    expect(screen.getByTestId('admin-superotp-sms-15')).toHaveTextContent(/No SMS sent yet/);
    expect(screen.getByTestId('admin-superotp-pills-15')).toHaveTextContent(/Code expired/);
    expect(screen.getByTestId('admin-superotp-detail-16')).toHaveTextContent(
      'Could not reach them',
    );
    expect(screen.getByTestId('admin-superotp-detail-17')).toHaveTextContent('at 11:30');
    expect(screen.getByTestId('admin-superotp-17')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });

    // A new code by number is for sign-in only; a waiting ask is generated or declined.
    expect(screen.getByTestId('admin-superotp-newcode-14')).toBeTruthy();
    expect(screen.getByTestId('admin-superotp-newcode-15')).toBeTruthy();
    expect(screen.queryByTestId('admin-superotp-newcode-16')).toBeNull();
    expect(screen.getByTestId('admin-superotp-generate-13')).toBeTruthy();
    expect(screen.getByTestId('admin-superotp-decline-13')).toBeTruthy();
  });

  it('searches words, or three digits of a number', async () => {
    const rows = ROWS as unknown as SuperOtpRow[];
    expect(rows.filter(r => matches(r, 'kavita')).map(r => r.id)).toEqual([13]);
    expect(rows.filter(r => matches(r, 'AI-1004')).map(r => r.id)).toEqual([13]);
    expect(rows.filter(r => matches(r, 'bahraich')).map(r => r.id)).toEqual([14]);
    expect(rows.filter(r => matches(r, '222')).map(r => r.id)).toEqual([14]);
    // Two digits would match nearly every number, so a search needs three.
    expect(rows.filter(r => matches(r, '98'))).toHaveLength(0);

    await open();
    fireEvent.changeText(screen.getByTestId('admin-superotp-search'), 'nobody here');
    await waitFor(() => expect(screen.getByText('Nobody matches “nobody here”.')).toBeTruthy());
  });

  it('asks the server for everything when told to', async () => {
    const sent: Sent[] = [];
    await open(sent);
    expect(sent.some(s => s.url.includes('state=open'))).toBe(true);
    fireEvent.press(screen.getByTestId('admin-superotp-scope-all'));
    await waitFor(() => expect(sent.some(s => s.url.includes('state=all'))).toBe(true));
  });

  it("generates a farmer's code to be read to her, shows it once, and hides it", async () => {
    const sent: Sent[] = [];
    await open(sent);
    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, body, buttons) => {
      expect(body).toMatch(/Generate a farmer check code for Kavita Devi\?/);
      expect(body).toMatch(/read it to HER by calling 9812345678 — not to Sunil Kumar/);
      buttons?.find(b => b.text === 'Generate code')?.onPress?.();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-superotp-generate-13'));
    });
    await waitFor(() => expect(screen.getByTestId('admin-superotp-code')).toBeTruthy());
    expect(sent.find(s => s.method === 'POST')!.url).toMatch(/\/admin\/super-otp\/13\/issue\/$/);
    expect(screen.getByTestId('admin-superotp-code')).toHaveTextContent('4 8 2 9 1 7');
    expect(screen.getByTestId('admin-superotp-reveal-who')).toHaveTextContent(
      'Kavita Devi · Farmer check · AI-100482',
    );
    expect(screen.getByTestId('admin-superotp-reveal-call')).toHaveTextContent(
      'Call her on 9812345678 — the farmer, not Sunil Kumar who asked',
    );
    expect(screen.getByTestId('admin-superotp-reveal-foot')).toHaveTextContent(
      /Works for \d+:\d\d.*same six boxes/,
    );
    expect(screen.getByTestId('admin-superotp-flash')).toHaveTextContent(
      'Code generated for Kavita Devi. Call 9812345678 now.',
    );

    fireEvent.press(screen.getByTestId('admin-superotp-reveal-close'));
    expect(screen.queryByTestId('admin-superotp-code')).toBeNull();
    alert.mockRestore();
  });

  it('declines an ask with the reason kept', async () => {
    const sent: Sent[] = [];
    await open(sent);

    fireEvent.press(screen.getByTestId('admin-superotp-decline-12'));
    expect(screen.getByTestId('admin-superotp-decline-reason').props.value).toBe(
      'Could not reach them on the number on file',
    );
    fireEvent.changeText(screen.getByTestId('admin-superotp-decline-reason'), '  Not the owner  ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-superotp-decline-confirm'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-superotp-flash')).toHaveTextContent('Declined.'),
    );
    const post = sent.find(s => s.method === 'POST')!;
    expect(post.url).toMatch(/\/admin\/super-otp\/12\/decline\/$/);
    expect(post.body).toEqual({ reason: 'Not the owner' });
    expect(screen.queryByTestId('admin-superotp-decline-sheet')).toBeNull();
  });

  it('makes a sign-in code for somebody who phoned, checking the number first', async () => {
    const sent: Sent[] = [];
    await open(sent);
    const alert = jest.spyOn(Alert, 'alert');

    fireEvent.changeText(screen.getByTestId('admin-superotp-phone'), '98-123');
    expect(screen.getByTestId('admin-superotp-phone').props.value).toBe('98123');
    fireEvent.press(screen.getByTestId('admin-superotp-phone-issue'));
    expect(screen.getByTestId('admin-superotp-problem')).toHaveTextContent(
      'The 10-digit number they sign in with.',
    );
    expect(alert).not.toHaveBeenCalled();

    alert.mockImplementationOnce((_t, body, buttons) => {
      expect(body).toMatch(/Hang up and call that number back/);
      buttons?.find(b => b.text === 'Generate code')?.onPress?.();
    });
    fireEvent.changeText(screen.getByTestId('admin-superotp-phone'), '9822200011');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-superotp-phone-issue'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-superotp-code')).toHaveTextContent('1 1 5 5 9 9'),
    );
    const post = sent.find(s => s.method === 'POST')!;
    expect(post.url).toMatch(/\/issue-for-number\/$/);
    expect(post.body).toEqual({ mobile_no: '9822200011' });
    expect(screen.getByTestId('admin-superotp-phone').props.value).toBe('');
    expect(screen.queryByTestId('admin-superotp-problem')).toBeNull();
    alert.mockRestore();
  });

  it('makes a farmer-check code for a Mait with no signal — the Mait, then one of member or number', async () => {
    const sent: Sent[] = [];
    await open(sent);
    const alert = jest.spyOn(Alert, 'alert');

    // The Mait is required before anything else.
    fireEvent.press(screen.getByTestId('admin-superotp-field-issue'));
    expect(screen.getByTestId('admin-superotp-problem')).toHaveTextContent(
      "The Mait's sign-in number or vendor code.",
    );
    expect(alert).not.toHaveBeenCalled();

    // A Mait, but neither a member code nor a number — exactly one is required.
    fireEvent.changeText(screen.getByTestId('admin-superotp-field-mait'), 'V-5521');
    fireEvent.press(screen.getByTestId('admin-superotp-field-issue'));
    expect(screen.getByTestId('admin-superotp-problem')).toHaveTextContent(
      "A member's code, or a non-member's 10-digit number — one of the two.",
    );
    expect(alert).not.toHaveBeenCalled();

    // A member code makes it valid; the confirm says the code is read to HER, not the Mait.
    alert.mockImplementationOnce((_t, body, buttons) => {
      expect(body).toMatch(/Generate a farmer-check code for M-1007\?/);
      expect(body).toMatch(/read it to HER on the number on her record/);
      buttons?.find(b => b.text === 'Generate code')?.onPress?.();
    });
    fireEvent.changeText(screen.getByTestId('admin-superotp-field-member'), 'M-1007');
    fireEvent.changeText(screen.getByTestId('admin-superotp-field-name'), 'Kavita Devi');
    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-superotp-field-issue'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-superotp-code')).toHaveTextContent('4 8 2 9 1 7'),
    );

    const post = sent.find(s => s.url.includes('/field-code/'))!;
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({
      mait: 'V-5521',
      member_code: 'M-1007',
      farmer_mobile: '',
      farmer_name: 'Kavita Devi',
    });
    // The farmer fields clear; the Mait stays for the next farmer this one reads out.
    expect(screen.getByTestId('admin-superotp-field-mait').props.value).toBe('V-5521');
    expect(screen.getByTestId('admin-superotp-field-member').props.value).toBe('');
    expect(screen.getByTestId('admin-superotp-field-name').props.value).toBe('');
    alert.mockRestore();
  });

  it("says the server's own reason when a code is refused", async () => {
    await open([], { refuse: 'No active account signs in with this number.' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementationOnce((_t, body, buttons) => {
      expect(body).toMatch(/Replace the code for 9833300022/);
      buttons?.find(b => b.text === 'New code')?.onPress?.();
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-superotp-newcode-15'));
    });
    await waitFor(() =>
      expect(screen.getByTestId('admin-superotp-problem')).toHaveTextContent(
        'No active account signs in with this number.',
      ),
    );
    expect(screen.queryByTestId('admin-superotp-code')).toBeNull();
    alert.mockRestore();
  });
});

describe('AdminUploadsScreen', () => {
  it('lists an import job with its tally', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 3,
            upload_type: 'member_master',
            upload_type_display: 'Member Master',
            file_name: 'members-oct.xlsx',
            status: 'completed_with_errors',
            status_display: 'Completed with errors',
            uploaded_by: 1,
            uploaded_by_name: 'Office Admin',
            total_rows: 1000,
            processed_rows: 1000,
            success_rows: 980,
            skipped_rows: 0,
            kept_rows: 0,
            failed_rows: 20,
            progress_percent: 100,
            error_count: 20,
            started_at: '2026-10-18T02:00:00Z',
            finished_at: '2026-10-18T02:05:00Z',
            created_at: '2026-10-18T02:00:00Z',
          },
        ],
      }),
    );
    renderWithStore(<AdminUploadsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-upload-3')).toBeTruthy());
    expect(screen.getByText('Member Master')).toBeTruthy();
    expect(screen.getByText('members-oct.xlsx')).toBeTruthy();
  });
});

describe('AdminUploadsScreen, sending a master', () => {
  const JOB = {
    id: 9,
    upload_type: 'member',
    upload_type_display: 'Member Master',
    file_name: 'Member.xlsx',
    status: 'processing',
    status_display: 'Processing',
    uploaded_by: 1,
    uploaded_by_name: 'Office Admin',
    total_rows: 1000,
    processed_rows: 400,
    success_rows: 380,
    skipped_rows: 20,
    kept_rows: 0,
    failed_rows: 0,
    progress_percent: 40,
    error_count: 0,
    started_at: '2026-10-25T05:00:00Z',
    finished_at: null,
    created_at: '2026-10-25T05:00:00Z',
  };

  class FakeXhr {
    static sent: { url: string; body: unknown }[] = [];
    upload: { onprogress?: (e: unknown) => void } = {};
    status = 0;
    responseText = '';
    onload?: () => void;
    onerror?: () => void;
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    send(body: unknown) {
      FakeXhr.sent.push({ url: this.url, body });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = 202;
      this.responseText = JSON.stringify({ ...JOB, status: 'queued', processed_rows: 0 });
      setTimeout(() => this.onload?.(), 0);
    }
  }

  beforeEach(() => {
    FakeXhr.sent = [];
    (global as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    delete (global as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  });

  it('says when each master last landed, and runs a chosen file to a live card', async () => {
    const picker = jest.requireMock('expo-document-picker') as {
      getDocumentAsync: jest.Mock;
    };
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///Member.xlsx', name: 'Member.xlsx', mimeType: null }],
    });
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      if (url.includes('/admin/uploads/9/')) {
        return jsonResponse(JOB);
      }
      if (url.includes('upload_type=mait')) {
        return jsonResponse({ count: 0, next: null, previous: null, results: [] });
      }
      const done = {
        ...JOB,
        id: 4,
        status: 'completed',
        total_rows: 105412,
        finished_at: '2026-10-12T05:00:00Z',
      };
      return jsonResponse({ count: 1, next: null, previous: null, results: [done] });
    });

    renderWithStore(<AdminUploadsScreen />, { store: storeFor('admin') });

    await waitFor(() =>
      expect(screen.getByTestId('admin-upload-last-mait').props.children).toBe('Never uploaded'),
    );
    expect(screen.getByTestId('admin-upload-last-member').props.children).toMatch(/1,05,412 rows/);
    expect(screen.getByText('Download masters')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-upload-choose-member'));

    await waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
    expect(FakeXhr.sent[0]?.url).toMatch(/\/admin\/uploads\/members\/$/);
    await waitFor(() => expect(screen.getByText('400 of 1,000 read')).toBeTruthy());
    expect(screen.getByTestId('admin-upload-run-member')).toBeTruthy();
    expect(screen.getByText(/380 added · 20 already on record/)).toBeTruthy();
  });
});

describe('AdminAssignmentScreen', () => {
  const MAITS = [
    {
      id: 4,
      sahayak_vendor_code: '5500000054',
      name: 'Sunil Kumar',
      mobile_no: '9811100045',
      needs_mobile: false,
      is_active: true,
      activated: true,
      account_active: true,
      mpp_codes: ['001371', '001372', '001373', '001374', '001375', '001376', '001377'],
      mpp_count: 7,
    },
    {
      id: 5,
      sahayak_vendor_code: '5500000091',
      name: 'Ramesh Kumar',
      mobile_no: '',
      needs_mobile: true,
      is_active: true,
      activated: false,
      account_active: null,
      mpp_codes: [],
      mpp_count: 0,
    },
  ];

  class FakeXhr {
    static sent: string[] = [];
    upload: { onprogress?: (e: unknown) => void } = {};
    status = 0;
    responseText = '';
    onload?: () => void;
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    send() {
      FakeXhr.sent.push(this.url);
      this.status = 202;
      this.responseText = JSON.stringify({
        id: 21,
        upload_type: 'assignment',
        file_name: 'assign.xlsx',
        status: 'queued',
        total_rows: 0,
        processed_rows: 0,
        success_rows: 0,
        failed_rows: 0,
        progress_percent: 0,
        created_at: '2026-10-26T05:00:00Z',
      });
      setTimeout(() => this.onload?.(), 0);
    }
  }

  function mockAssignment() {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/admin/uploads/21/errors/')) {
        return jsonResponse({
          failed_rows: 1,
          truncated: false,
          results: [{ row: 7, error: 'Unknown MPP code 009999' }],
        });
      }
      if (url.includes('/admin/uploads/21/')) {
        return jsonResponse({
          id: 21,
          upload_type: 'assignment',
          file_name: 'assign.xlsx',
          status: 'completed_with_errors',
          total_rows: 10,
          processed_rows: 10,
          success_rows: 9,
          failed_rows: 1,
          progress_percent: 100,
          created_at: '2026-10-26T05:00:00Z',
        });
      }
      if (url.includes('/admin/uploads/')) {
        return jsonResponse({ count: 0, next: null, previous: null, results: [] });
      }
      return jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: MAITS,
        summary: { total: 2, activated: 1, without_mobile: 1, deactivated: 0 },
      });
    });
  }

  beforeEach(() => {
    FakeXhr.sent = [];
    (global as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
  });
  afterEach(() => {
    delete (global as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  });

  it('lays out the round trip and the roster, an uncovered Mait tinted yellow', async () => {
    mockAssignment();
    renderWithStore(<AdminAssignmentScreen />, { store: storeFor('admin') });

    expect(await screen.findByText('2 Maits · 1 with no mobile')).toBeTruthy();
    expect(screen.getByText('Download the sheet')).toBeTruthy();
    expect(screen.getByText('Edit it in Excel')).toBeTruthy();
    expect(screen.getByText('Upload it back')).toBeTruthy();

    // Six chips and the rest counted.
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByTestId('admin-assign-mait-5500000091')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByText('No MPPs — this Mait can record nothing')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-assign-filter-uncovered'));
    await waitFor(() => expect(screen.queryByTestId('admin-assign-mait-5500000054')).toBeNull());
    expect(screen.getByTestId('admin-assign-mait-5500000091')).toBeTruthy();
  });

  it('sends the sheet, watches it apply, and lists the rows it rejected', async () => {
    const picker = jest.requireMock('expo-document-picker') as { getDocumentAsync: jest.Mock };
    picker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///assign.xlsx', name: 'assign.xlsx', mimeType: null }],
    });
    mockAssignment();
    renderWithStore(<AdminAssignmentScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-assign-upload'));
    await waitFor(() => expect(FakeXhr.sent).toHaveLength(1));
    expect(FakeXhr.sent[0]).toMatch(/\/admin\/uploads\/assignments\/$/);

    expect(await screen.findByTestId('admin-assign-rejects', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('Row 7')).toBeTruthy();
    expect(screen.getByText('Unknown MPP code 009999')).toBeTruthy();
    expect(screen.getByText('9 of 10 rows applied · 1 rejected')).toBeTruthy();
  });

  it('opens the shared Mait editor from a row', async () => {
    mockAssignment();
    renderWithStore(<AdminAssignmentScreen />, { store: storeFor('admin') });

    fireEvent.press(await screen.findByTestId('admin-assign-edit-5500000054'));
    expect(screen.getByTestId('admin-mait-editor')).toBeTruthy();
    expect(screen.getByTestId('admin-mait-mpp-count').props.children).toBe(7);
  });
});

describe('AdminReportsScreen', () => {
  const PAID = {
    ...EVENT,
    id: 41,
    payment: { amount: '300.00', mode_display: 'Cash', status_display: 'Verified' },
  };
  const PENDING = {
    ...EVENT,
    id: 42,
    status: 'payment_pending',
    status_display: 'Payment pending',
    payment: null,
  };
  const REAL = {
    count: 37,
    next: null,
    previous: null,
    results: [PAID, PENDING],
    summary: { completed: 30, unfinished: 5, cancelled: 2 },
  };
  const NOTHING = {
    count: 0,
    next: null,
    previous: null,
    results: [],
    summary: { completed: 0, unfinished: 0, cancelled: 0 },
  };

  function mockReports(page: object = REAL, urls: string[] = []) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      urls.push(url);
      if (url.includes('/mpp/')) {
        return jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 3, mpp_code: '001371', mpp_name: 'Barsana' }],
        });
      }
      // Anything filtered matches nothing, so the empty answer can be told from the sample.
      return jsonResponse(/[?&](status|search|mpp|date_from)=/.test(url) ? NOTHING : page);
    });
  }

  it('previews the most recent ten on open, with the count and its status split', async () => {
    const urls: string[] = [];
    mockReports(REAL, urls);
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());
    expect(urls.some(u => u.includes('/ai-events/') && u.includes('limit=10'))).toBe(true);
    expect(screen.getByTestId('admin-reports-count')).toHaveTextContent(
      '37 rows match · showing the first 10',
    );
    expect(screen.getByTestId('admin-reports-split')).toHaveTextContent(/30 completed/);
    expect(screen.getByTestId('admin-report-amount-41')).toHaveTextContent('₹300');
    expect(screen.getByTestId('admin-report-amount-42')).toHaveTextContent('—');
    // Completed is green; waiting on money is yellow.
    expect(screen.getByTestId('admin-report-41')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-report-42')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-reports-notice')).toHaveTextContent(
      /Exports carry no personal data/,
    );
  });

  it('runs the query built, says when the builder has moved on, and clears it', async () => {
    const urls: string[] = [];
    mockReports(REAL, urls);
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-reports-status-completed'));
    fireEvent.changeText(screen.getByTestId('admin-reports-search'), '  Barsana ');
    fireEvent.press(screen.getByTestId('admin-reports-quick-7'));
    // Not run yet: the preview still shows the last query, and says the builder has changed.
    expect(screen.getByTestId('admin-reports-edited')).toBeTruthy();
    expect(screen.getByTestId('admin-report-41')).toBeTruthy();

    fireEvent.press(screen.getByTestId('admin-reports-run'));
    await waitFor(() => expect(screen.getByText('Nothing matches those filters.')).toBeTruthy());
    expect(screen.queryByTestId('admin-reports-edited')).toBeNull();
    const { from, to } = presetRange('7');
    const ran = urls.find(u => u.includes('status=completed'));
    expect(ran).toContain('search=Barsana');
    expect(ran).toContain(`date_from=${from}`);
    expect(ran).toContain(`date_to=${to}`);
    // A filtered query that matches nothing is a result, never covered by the example.
    expect(screen.queryByTestId('admin-reports-sample')).toBeNull();

    fireEvent.press(screen.getByTestId('admin-reports-clear'));
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());
    expect(screen.getByTestId('admin-reports-search').props.value).toBe('');
  });

  it('exports the query that was run, not the one being typed', async () => {
    mockReports();
    (downloadAndShare as jest.Mock).mockClear();
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-reports-status-cancelled'));
    fireEvent.press(screen.getByTestId('admin-reports-run'));
    await waitFor(() => expect(screen.queryByTestId('admin-reports-edited')).toBeNull());
    fireEvent.changeText(screen.getByTestId('admin-reports-search'), 'unsent');

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-reports-export'));
    });
    expect(downloadAndShare).toHaveBeenCalledWith(
      '/reports/export/?status=cancelled',
      'ai-events.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expect.any(String),
    );
    expect(screen.getByTestId('admin-reports-flash')).toHaveTextContent(/The file is ready/);
  });

  it('says so plainly when the export fails', async () => {
    mockReports();
    (downloadAndShare as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('admin-reports-export'));
    });
    expect(screen.getByTestId('admin-reports-problem')).toHaveTextContent(
      'The export could not be produced. Try a narrower date range.',
    );
  });

  it('shows a marked sample on an empty database, and nothing in it opens', async () => {
    mockReports(NOTHING);
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });

    await waitFor(() => expect(screen.getByTestId('admin-reports-sample')).toBeTruthy());
    expect(screen.getByTestId('admin-reports-count')).toHaveTextContent(
      'Sample — run a query for real rows',
    );
    expect(screen.getByTestId('admin-report-s1')).toHaveTextContent(/AI-100482/);
    expect(screen.getByTestId('admin-report-s1').props.accessibilityRole).toBeUndefined();
  });

  it('opens an event from the preview', async () => {
    mockReports();
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-report-41'));
    await waitFor(() => expect(screen.queryByTestId('admin-reports')).toBeNull());
  });

  it('picks one MPP from the sheet', async () => {
    const urls: string[] = [];
    mockReports(REAL, urls);
    renderWithStore(<AdminReportsScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByTestId('admin-report-41')).toBeTruthy());

    fireEvent.press(screen.getByTestId('admin-reports-mpp'));
    await waitFor(() => expect(screen.getByTestId('admin-events-mpp-001371')).toBeTruthy());
    fireEvent.press(screen.getByTestId('admin-events-mpp-001371'));
    expect(screen.getByTestId('admin-reports-mpp-value')).toHaveTextContent('Barsana · 001371');

    fireEvent.press(screen.getByTestId('admin-reports-run'));
    await waitFor(() => expect(urls.some(u => u.includes('mpp=001371'))).toBe(true));
  });
});

describe('AdminOtpPipelineScreen', () => {
  const steps = (
    made: string,
    gateway: string,
    typed: string,
    used: string,
    usedLabel = 'Verified',
  ) => [
    { key: 'made', label: 'Code made', state: made, at: '2026-10-24T10:00:00Z' },
    { key: 'gateway', label: 'Gateway accepted', state: gateway, at: null },
    { key: 'typed', label: 'Typed in', state: typed, at: null },
    { key: 'used', label: usedLabel, state: used, at: null },
  ];
  const VERIFIED = {
    id: 701,
    purpose: 'login',
    step: 'Sign-in',
    mobile_no: '9569061304',
    who: { kind: 'mait', name: 'Shivam Kumar', detail: 'Mait 5500000054' },
    stage: 'verified',
    stage_display: 'Verified by SMS',
    tone: 'good',
    guidance: 'Arrived and used. The pipeline worked end to end.',
    arrived: 'yes',
    steps: steps('done', 'done', 'done', 'done'),
    attempt_count: 1,
    max_attempts: 3,
    sent_at: new Date(Date.now() - 10 * 60000).toISOString(),
    expires_at: new Date(Date.now() - 5 * 60000).toISOString(),
    verified_at: new Date(Date.now() - 9 * 60000).toISOString(),
    sent_via: 'sms',
    gateway_message_id: 'MSG-1',
    blocking: null,
  };
  const LOST = {
    ...VERIFIED,
    id: 702,
    purpose: 'payment_cod',
    step: 'Cash payment',
    mobile_no: '9151809856',
    who: { kind: 'member', name: 'Amaravti Devi', detail: 'Gadauri Khurd' },
    stage: 'likely_lost',
    stage_display: 'Likely lost',
    tone: 'warn',
    guidance: 'Accepted by the gateway and never typed into before it expired.',
    arrived: 'no',
    steps: steps('done', 'done', 'failed', 'failed'),
    attempt_count: 0,
    verified_at: null,
    gateway_message_id: 'MSG-2',
    blocking: { ai_event_id: 64, amount: '300.00', mode: 'Cash', payment_status: 'pending' },
  };
  const ASK = {
    id: 31,
    purpose: 'farmer_verify',
    step: 'Farmer check',
    for_farmer: true,
    full_name: 'Shivam Kumar',
    farmer_name: 'Amaravti Devi',
    context: 'Checking her at Gadauri Khurd',
    mobile_no: '9151809856',
    state: 'used',
    status_display: 'Used to sign in',
    asked_at: new Date(Date.now() - 30 * 60000).toISOString(),
    phoned: false,
    request_count: 2,
    reason: 'No SMS',
    verdict: {
      key: 'early',
      label: 'Asked early',
      tone: 'warn',
      detail: 'Asked within a minute of the SMS being sent, while it was still inside its window.',
      note: 'For information. The office can still give them a code.',
    },
    through_by_sms_after: false,
    sms: {
      id: 9,
      sent_at: '2026-10-24T06:50:40Z',
      accepted: true,
      attempt_count: 0,
      verified: false,
      by_office: true,
      minutes_before: 0,
    },
  };
  const BODY = {
    window_days: 7,
    windows: [1, 7, 30],
    truncated: false,
    summary: {
      funnel: { made: 28, accepted: 28, arrived: 23, verified: 22 },
      arrival_rate: 88.5,
      likely_lost: 3,
      never_left: 0,
      office: 1,
      asks: 1,
      asks_justified: 0,
      asks_waiting: 0,
      people: 6,
    },
    gateway: {
      provider: 'smsfortius',
      checked: 20,
      accepted: 20,
      tone: 'good',
      last_accepted_at: '2026-10-24T10:59:42Z',
    },
    by_purpose: [
      {
        key: 'login',
        label: 'Sign-in',
        made: 20,
        accepted: 20,
        arrived: 19,
        verified: 19,
        arrival_rate: 95,
      },
      {
        key: 'payment_cod',
        label: 'Cash payment',
        made: 8,
        accepted: 8,
        arrived: 4,
        verified: 3,
        arrival_rate: 57.1,
      },
    ],
    stages: [
      { key: 'likely_lost', label: 'Likely lost', tone: 'warn', count: 3 },
      { key: 'verified', label: 'Verified by SMS', tone: 'good', count: 22 },
    ],
    verdicts: [
      { key: 'justified', label: 'Right to ask', tone: 'good', count: 0 },
      { key: 'early', label: 'Asked early', tone: 'warn', count: 1 },
    ],
    steps: [
      { key: 'login', label: 'Sign-in' },
      { key: 'payment_cod', label: 'Cash payment' },
    ],
    count: 40,
    offset: 0,
    limit: 25,
    results: [VERIFIED, LOST],
    asks: [ASK],
    asks_count: 1,
  };

  function mockPipeline(urls: string[] = [], body: object = BODY) {
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      const url = String(input.url ?? input);
      urls.push(url);
      const offset = Number(url.match(/offset=(\d+)/)?.[1] ?? 0);
      return jsonResponse({ ...body, offset });
    });
  }

  async function open(urls: string[] = [], onOpenSection = jest.fn()) {
    mockPipeline(urls);
    renderWithStore(<AdminOtpPipelineScreen onOpenSection={onOpenSection} />, {
      store: storeFor('admin'),
    });
    await waitFor(() => expect(screen.getByTestId('admin-pipeline-code-701')).toBeTruthy());
    return onOpenSection;
  }

  it('sits in the rail directly under Super OTP', () => {
    const keys = ADMIN_SECTIONS.map(section => section.key);
    expect(keys[keys.indexOf('super-otp') + 1]).toBe('otp-pipeline');
  });

  it('leads with the rule, the four tiles, the gateway and the funnel', async () => {
    await open();

    expect(screen.getByTestId('admin-pipeline-rule')).toHaveTextContent(
      /The gateway says accepted — never delivered/,
    );
    expect(screen.getByTestId('admin-pipeline-tile-sent-value')).toHaveTextContent('28');
    expect(screen.getByTestId('admin-pipeline-tile-sent-foot')).toHaveTextContent(
      '28 accepted by the gateway',
    );
    expect(screen.getByTestId('admin-pipeline-tile-arrived-value')).toHaveTextContent('88.5%');
    expect(screen.getByTestId('admin-pipeline-tile-lost-value')).toHaveTextContent('3');
    expect(screen.getByTestId('admin-pipeline-tile-never-value')).toHaveTextContent('0');
    expect(screen.getByTestId('admin-pipeline-gateway')).toHaveTextContent(
      /Gateway \(smsfortius\) accepted 20 of the last 20 sends.*Every recent send left/,
    );
    expect(screen.getByTestId('admin-pipeline-gateway')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('admin-pipeline-funnel-arrived')).toHaveTextContent(/23 · 82%/);
    expect(screen.getByTestId('admin-pipeline-step-payment_cod')).toHaveTextContent(
      /Cash payment.*8 made · 4 arrived · 3 verified.*57.1%/,
    );
  });

  it('reads each ask against the SMS before it, for information only', async () => {
    const onOpenSection = await open();

    expect(screen.getByTestId('admin-pipeline-ask-31')).toHaveTextContent(
      /Amaravti Devi.*asked by Shivam Kumar.*Asked early/,
    );
    expect(screen.getByTestId('admin-pipeline-ask-31')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('admin-pipeline-ask-asked-31')).toHaveTextContent(
      /30 min ago · 2×.*“No SMS”/,
    );
    // An SMS the office code closed is not an SMS that was used.
    expect(screen.getByTestId('admin-pipeline-ask-sms-31')).toHaveTextContent(
      /Under a minute before · gateway accepted · closed by the office code$/,
    );
    expect(screen.getByTestId('admin-pipeline-ask-31')).toHaveTextContent(
      /For information — they can still be given a code./,
    );
    fireEvent.press(screen.getByTestId('admin-pipeline-open-superotp'));
    expect(onOpenSection).toHaveBeenCalledWith('super-otp');
  });

  it('draws each code through its four stations, and opens to the rest', async () => {
    await open();

    expect(screen.getByTestId('admin-pipeline-pipe-701-typed-done')).toBeTruthy();
    expect(screen.getByTestId('admin-pipeline-pipe-702-gateway-done')).toBeTruthy();
    expect(screen.getByTestId('admin-pipeline-pipe-702-typed-failed')).toBeTruthy();
    expect(screen.getByTestId('admin-pipeline-arrived-701')).toHaveTextContent('Reached the phone');
    expect(screen.getByTestId('admin-pipeline-arrived-702')).toHaveTextContent(
      'Did not reach the phone',
    );
    expect(screen.getByTestId('admin-pipeline-code-702')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });

    fireEvent.press(screen.getByTestId('admin-pipeline-code-toggle-702'));
    expect(screen.getByTestId('admin-pipeline-code-detail-702')).toHaveTextContent(
      /never typed into.*0 of 3.*MSG-2.*AI event 64 · ₹300 Cash/,
    );
    fireEvent.press(screen.getByTestId('admin-pipeline-code-toggle-701'));
    expect(screen.queryByTestId('admin-pipeline-code-detail-702')).toBeNull();
  });

  it('asks the server for the window, step, stage, verdict and search chosen', async () => {
    const urls: string[] = [];
    await open(urls);
    expect(urls.some(u => /days=7/.test(u) && /limit=25/.test(u))).toBe(true);

    fireEvent.press(screen.getByTestId('admin-pipeline-days-1'));
    await waitFor(() => expect(urls.some(u => /days=1(&|$)/.test(u))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-pipeline-purpose-payment_cod'));
    await waitFor(() => expect(urls.some(u => u.includes('purpose=payment_cod'))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-pipeline-stage-likely_lost'));
    await waitFor(() => expect(urls.some(u => u.includes('stage=likely_lost'))).toBe(true));
    fireEvent.press(screen.getByTestId('admin-pipeline-verdict-early'));
    await waitFor(() => expect(urls.some(u => u.includes('verdict=early'))).toBe(true));
    fireEvent.changeText(screen.getByTestId('admin-pipeline-search'), '9151');
    await waitFor(() => expect(urls.some(u => u.includes('search=9151'))).toBe(true));
  });

  it('pages twenty-five at a time', async () => {
    const urls: string[] = [];
    await open(urls);
    expect(screen.getByTestId('admin-pipeline-page')).toHaveTextContent('1–25 of 40');
    fireEvent.press(screen.getByTestId('admin-pipeline-next'));
    await waitFor(() => expect(urls.some(u => u.includes('offset=25'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('admin-pipeline-page')).toHaveTextContent('26–40 of 40'),
    );
  });

  it('says so when nothing was sent and the gateway has nothing to judge', async () => {
    mockPipeline([], {
      ...BODY,
      summary: {
        ...BODY.summary,
        funnel: { made: 0, accepted: 0, arrived: 0, verified: 0 },
        arrival_rate: null,
      },
      gateway: {
        provider: 'smsfortius',
        checked: 0,
        accepted: 0,
        tone: null,
        last_accepted_at: null,
      },
      by_purpose: [],
      count: 0,
      results: [],
      asks: [],
      asks_count: 0,
    });
    renderWithStore(<AdminOtpPipelineScreen />, { store: storeFor('admin') });
    await waitFor(() => expect(screen.getByText('No codes sent in this window.')).toBeTruthy());
    expect(screen.getByTestId('admin-pipeline-tile-arrived-value')).toHaveTextContent('—');
    expect(screen.getByTestId('admin-pipeline-gateway')).toHaveTextContent(
      /No SMS sent in this window/,
    );
    expect(screen.getByText('Nobody asked the office for a code in this window.')).toBeTruthy();
    expect(screen.queryByTestId('admin-pipeline-open-superotp')).toBeNull();
  });
});
