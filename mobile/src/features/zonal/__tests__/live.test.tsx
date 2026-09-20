/**
 * The zonal app's beat, held to the portal's: every half minute while the app is on screen,
 * nothing while it is in a pocket, and fresh on every screen opened.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { LIVE_MS, useLive } from '../live';

let listeners: ((state: AppStateStatus) => void)[] = [];

beforeEach(() => {
  listeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => jest.restoreAllMocks());

it('beats every half minute while the app is on screen, like the portal', () => {
  const { result } = renderHook(() => useLive());

  expect(LIVE_MS).toBe(30_000);
  expect(result.current.pollingInterval).toBe(LIVE_MS);
  // Fresh whenever a screen is opened, rather than a cache a tab-switch old.
  expect(result.current.refetchOnMountOrArgChange).toBe(true);
});

it('stops in the background and starts again on coming back', () => {
  const { result } = renderHook(() => useLive());

  act(() => listeners.forEach(listener => listener('background')));
  expect(result.current.pollingInterval).toBe(0);

  act(() => listeners.forEach(listener => listener('active')));
  expect(result.current.pollingInterval).toBe(LIVE_MS);
});
