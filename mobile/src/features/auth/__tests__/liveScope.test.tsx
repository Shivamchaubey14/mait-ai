/**
 * Keeping the Mait's scope current.
 *
 * The bug this exists to close: `assigned_mpp_codes` was read once at sign-in and never again,
 * so an admin assigning a collection point changed nothing on the handset until the Mait
 * signed out and back in — and signing back in needs an OTP over SMS, in a village, on one
 * bar. The whole of `persistence.ts` exists so that never has to happen.
 *
 * What is defended here is that the re-read actually lands in the store, that a change is
 * noticed rather than applied in silence, and — the one that could hurt — that losing signal
 * never costs a Mait the scope they already had.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, screen } from '@testing-library/react-native';

import { diffScope, useLiveScope } from '../liveScope';
import { loggedIn } from '../authSlice';
import type { AuthUser } from '../authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

const USER: AuthUser = {
  id: 4,
  fullName: 'Sunil Kumar',
  role: 'mait',
  mobileNo: '9999999999',
  maitId: 60,
  sahayakVendorCode: '00341',
};

/** What `/auth/me/` answers, with whatever scope the case needs. */
function me(codes: string[]) {
  return {
    id: 4,
    username: 'sunil',
    full_name: 'Sunil Kumar',
    email: '',
    mobile_no: '9999999999',
    role: 'mait',
    role_display: 'Mait',
    is_active: true,
    last_login_at: null,
    mait_id: 60,
    sahayak_vendor_code: '00341',
    assigned_mpp_codes: codes,
  };
}

function Harness({ onReady }: { onReady: (scope: ReturnType<typeof useLiveScope>) => void }) {
  const scope = useLiveScope();
  onReady(scope);
  return <Text testID="change">{scope.change ? JSON.stringify(scope.change) : 'none'}</Text>;
}

function mount(startingScope: string[]) {
  const store = makeStore();
  store.dispatch(
    loggedIn({ access: 'a', refresh: 'r', user: USER, assignedMppCodes: startingScope }),
  );
  let scope: ReturnType<typeof useLiveScope> | null = null;
  renderWithStore(<Harness onReady={value => (scope = value)} />, { store });
  return { store, get: () => scope as ReturnType<typeof useLiveScope> };
}

describe('diffScope', () => {
  it('says nothing changed when nothing did', () => {
    expect(diffScope(['001302', '001308'], ['001302', '001308'])).toBeNull();
  });

  it('does not mistake a reordering for a change', () => {
    // The server promises no order, and a toast on every poll saying the scope changed would
    // train a Mait to ignore the one that matters.
    expect(diffScope(['001302', '001308'], ['001308', '001302'])).toBeNull();
  });

  it('reports what was given and what was taken', () => {
    expect(diffScope(['001302', '001308'], ['001302', '001371'])).toEqual({
      added: ['001371'],
      removed: ['001308'],
    });
  });
});

describe('useLiveScope', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });
  afterEach(() => jest.resetAllMocks());

  it('puts a newly assigned MPP into the store without a sign-out', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(me(['001302', '001308', '001371'])),
    );

    const { store, get } = mount(['001302', '001308']);
    await act(async () => {
      await get().refresh();
    });

    expect(store.getState().auth.assignedMppCodes).toEqual(['001302', '001308', '001371']);
  });

  it('notices the change rather than applying it in silence', async () => {
    // A silent refetch turns "3 MPPs" into "4 MPPs" under the Mait's own name with nothing
    // to say why, and grows the capture flow a collection point nobody told them about.
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(me(['001302', '001371'])),
    );

    const { get } = mount(['001302']);
    await act(async () => {
      await get().refresh();
    });

    expect(screen.getByTestId('change')).toHaveTextContent(/001371/);
    expect(get().change).toEqual({ added: ['001371'], removed: [] });
  });

  it('reports an MPP taken away, which is the one that costs a morning', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => jsonResponse(me(['001302'])));

    const { get } = mount(['001302', '001308']);
    await act(async () => {
      await get().refresh();
    });

    expect(get().change).toEqual({ added: [], removed: ['001308'] });
  });

  it('says nothing when the scope is unchanged', async () => {
    (global.fetch as jest.Mock).mockImplementation(async () => jsonResponse(me(['001302'])));

    const { get } = mount(['001302']);
    await act(async () => {
      await get().refresh();
    });

    expect(get().change).toBeNull();
  });

  it('keeps the scope already in hand when the network cannot be reached', async () => {
    // The dangerous failure. Treating an unreachable server as "you have no MPPs" would
    // empty the capture flow in the middle of a round, in exactly the place — no signal —
    // where a Mait can do nothing about it.
    (global.fetch as jest.Mock).mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });

    const { store, get } = mount(['001302', '001308']);
    await act(async () => {
      await get().refresh();
    });

    expect(store.getState().auth.assignedMppCodes).toEqual(['001302', '001308']);
    expect(get().change).toBeNull();
  });

  it('hands back the same object until something actually changes', async () => {
    // The bug this closes: a fresh object render made every callback depending on this hook
    // fresh too, so the shell's netinfo effect re-ran on every render — re-subscribing,
    // draining, and re-reading the scope in a circle. The visible symptom was the
    // scope-change notice flickering on and off continuously.
    (global.fetch as jest.Mock).mockImplementation(async () => jsonResponse(me(['001302'])));

    const { get } = mount(['001302']);
    const first = get();

    // A render caused by something else entirely must not hand back a new object.
    await act(async () => {
      await first.refresh();
    });

    expect(get().refresh).toBe(first.refresh);
    expect(get()).toBe(first);
  });

  it('keeps `refresh` stable even when the scope does change', async () => {
    // `refresh` is the half the shell's `sync` is allowed to depend on, so it has to survive
    // the one event that moves everything else.
    (global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(me(['001302', '001371'])),
    );

    const { get } = mount(['001302']);
    const before = get().refresh;

    await act(async () => {
      await get().refresh();
    });

    expect(get().change).not.toBeNull();
    expect(get().refresh).toBe(before);
  });

  it('does nothing at all when nobody is signed in', async () => {
    // A signed-out handset polling the API is a handset asking a question it has no right to
    // ask, and on a metered village connection somebody pays for the asking.
    let scope: ReturnType<typeof useLiveScope> | null = null;
    renderWithStore(<Harness onReady={value => (scope = value)} />, { store: makeStore() });

    await act(async () => {
      await (scope as unknown as ReturnType<typeof useLiveScope>).refresh();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
