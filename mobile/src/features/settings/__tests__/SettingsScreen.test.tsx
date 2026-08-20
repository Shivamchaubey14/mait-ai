/**
 * Profile (M21).
 *
 * Two of the things on this screen are numbers a Mait may be asked to produce, so they are
 * what the tests defend.
 *
 * **Cash on hand** is the one that could get somebody accused. It has to count only what the
 * Mait is actually carrying: cash, taken today, confirmed by her code. A member's rate never
 * passes through their hands — the dairy deducts it from her milk payment — and a UPI payment
 * lands in the dairy's account. Either counted here would tell a Mait they are holding money
 * they have never touched.
 *
 * **This month** has to come off the server's own count rather than off the page of rows the
 * handset happens to be holding, or a busy month quietly reports itself as fifty.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../SettingsScreen';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const USER: AuthUser = {
  id: 4,
  fullName: 'Sunil Kumar',
  role: 'mait',
  mobileNo: '9999999999',
  maitId: 60,
  sahayakVendorCode: '00341',
};

function mpp(code: string, name: string) {
  return {
    id: Number(code),
    mpp_code: code,
    mpp_name: name,
    plant_code: '2001',
    plant_name: 'Barsana',
    district_code: '01',
    tehsil_code: '01',
    village_code: '01',
    mobile_no: '',
    is_active: true,
    mait: 60,
    mait_name: 'Sunil Kumar',
    member_count: 100,
  };
}

/** One of today's events, with whatever payment the case needs. */
function event(id: number, payment: Record<string, unknown> | null) {
  return {
    id,
    client_uuid: `uuid-${id}`,
    status: 'completed',
    status_display: 'Completed',
    mpp: 1,
    mpp_code: '001302',
    mpp_name: 'Barsana',
    owner_type: payment && payment.mode === 'DEDUCTION' ? 'member' : 'non_member',
    member: null,
    member_code: '',
    non_member: 9,
    owner_name: 'Radha Singh',
    animal: 7,
    animal_type: 'BUFF',
    breed: 'MURRAH',
    ear_tag_no: null,
    semen_breed: 'MURRAH',
    amount_due: '300.00',
    payment,
    straw_unique_no: '',
    stock_deducted: true,
    ai_photo_url: '',
    photo_source: 'camera',
    gps_lat: null,
    gps_lng: null,
    gps_source: 'device',
    performed_at: null,
    completed_at: null,
    cancelled_reason: '',
    created_at: new Date().toISOString(),
  };
}

const CASH = {
  amount: '300.00',
  mode: 'COD',
  mode_display: 'Cash',
  status: 'verified',
  is_verified: true,
};
const UNCONFIRMED = { ...CASH, status: 'pending', is_verified: false };
const ONLINE = { ...CASH, mode: 'ONLINE', mode_display: 'Online' };
const DEDUCTION = {
  ...CASH,
  mode: 'DEDUCTION',
  mode_display: 'Deducted from milk',
  amount: '50.00',
};

function mockApi({
  monthCount = 214,
  todays = [] as ReturnType<typeof event>[],
  indents = [] as Record<string, unknown>[],
} = {}) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;

    // The month tile's query is the one carrying `status=completed`; only its count is read.
    if (url.includes('/ai-events/') && url.includes('status=completed')) {
      return jsonResponse({ count: monthCount, next: null, previous: null, results: [] });
    }
    if (url.includes('/ai-events/')) {
      return jsonResponse({ count: todays.length, next: null, previous: null, results: todays });
    }
    if (url.includes('/mpp/')) {
      return jsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [mpp('001302', 'Barsana'), mpp('001308', 'Nandgaon'), mpp('001371', 'Kosi Kalan')],
      });
    }
    if (url.includes('/indents/')) {
      return jsonResponse({ count: indents.length, next: null, previous: null, results: indents });
    }
    return jsonResponse({ count: 0, next: null, previous: null, results: [] });
  });
}

function render(props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) {
  const store = makeStore();
  store.dispatch(loggedIn({ access: 'a', refresh: 'r', user: USER, assignedMppCodes: ['001302'] }));
  const onOpenIndents = jest.fn();
  const onSync = jest.fn();
  renderWithStore(
    <SettingsScreen
      pending={0}
      onSync={onSync}
      online
      lastSyncAt="9:48"
      onOpenIndents={onOpenIndents}
      {...props}
    />,
    { store },
  );
  return { onOpenIndents, onSync };
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('reads the month from the server count, not from the rows it holds', async () => {
    mockApi({ monthCount: 214 });
    render();

    await waitFor(() => expect(screen.getByTestId('profile-month')).toHaveTextContent(/214/));
  });

  it('counts only the cash the Mait is actually carrying', async () => {
    mockApi({
      todays: [
        event(1, CASH), // ₹300, taken and confirmed
        event(2, CASH), // ₹300, taken and confirmed
        event(3, UNCONFIRMED), // her code never came back
        event(4, ONLINE), // paid to the dairy, not to the Mait
        event(5, DEDUCTION), // a member — nothing changed hands at all
        event(6, null), // no payment yet
      ],
    });
    render();

    await waitFor(() => expect(screen.getByTestId('profile-cash')).toHaveTextContent(/₹ 600/));
    expect(screen.getByTestId('profile-cash')).toHaveTextContent(/2 collections today/);
  });

  it('holds a long name to one line rather than wrapping the card taller', async () => {
    // It used to wrap to two lines, which both grew the ink card on exactly the handsets with
    // the least room and broke one person's name across two rows. Measured to fit instead —
    // the same rule Home's hero uses, less the avatar's share of the width.
    mockApi({});
    render();

    await waitFor(() => expect(screen.getByText(USER.fullName)).toBeTruthy());
    expect(screen.getByText(USER.fullName).props.numberOfLines).toBe(1);
  });

  it('names the MPPs and opens the rest of them', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('profile-mpps')).toHaveTextContent(/3 MPPs/));
    expect(screen.queryByTestId('profile-mpp-list')).toBeNull();

    fireEvent.press(screen.getByTestId('profile-mpps'));

    expect(screen.getByTestId('profile-mpp-list')).toHaveTextContent(/Kosi Kalan/);
    expect(screen.getByTestId('profile-mpp-list')).toHaveTextContent(/001371/);
  });

  it('opens the indents, and says how many are still open', async () => {
    mockApi({
      indents: [
        { id: 1, status: 'requested' },
        { id: 2, status: 'approved' },
        { id: 3, status: 'issued' }, // issued is at the depot, not outstanding
      ],
    });
    const { onOpenIndents } = render();

    await waitFor(() =>
      expect(screen.getByTestId('profile-indents')).toHaveTextContent(/2 still open/),
    );

    fireEvent.press(screen.getByTestId('profile-indents'));
    expect(onOpenIndents).toHaveBeenCalled();
  });

  it('asks twice before signing out on top of unsent work', async () => {
    mockApi();
    render({ pending: 3 });

    fireEvent.press(await screen.findByTestId('sign-out'));

    // Nothing has been signed out yet: the warning names what would be left behind.
    expect(screen.getByTestId('signout-warning')).toHaveTextContent(/3 records/);
    expect(screen.getByTestId('sign-out')).toHaveTextContent(/Sign out anyway/);
  });

  it('signs out without asking when nothing is waiting', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('sign-out'));

    expect(screen.queryByTestId('signout-warning')).toBeNull();
  });
});
