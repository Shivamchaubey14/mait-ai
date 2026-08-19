/**
 * Collection-point picker tests (C2, M4).
 *
 * Two collection points in neighbouring villages often share half a name, and picking the
 * wrong one puts the whole capture against the wrong roster. The row has to carry enough to
 * tell them apart before it is tapped, not after.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectMppScreen from '../SelectMppScreen';
import type { MPP } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

function mpp(overrides: Partial<MPP> = {}): MPP {
  return {
    id: 1,
    mpp_code: 'MPP0004120',
    mpp_name: 'Barsana MPP',
    plant_code: '2001',
    plant_name: 'BARSANA',
    district_code: '048',
    tehsil_code: '04803',
    village_code: '06081400',
    mobile_no: '9795402473',
    is_active: true,
    mait: 3,
    mait_name: 'SHIVKUMAR',
    member_count: 412,
    ...overrides,
  };
}

const MPPS = [
  mpp(),
  mpp({ id: 2, mpp_code: 'MPP0004135', mpp_name: 'Nandgaon MPP', member_count: 288 }),
];

function mockApi(mpps: MPP[], lastEventMpp?: string) {
  (global.fetch as jest.Mock).mockImplementation((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mpp/')) {
      return Promise.resolve(
        jsonResponse({ count: mpps.length, next: null, previous: null, results: mpps }),
      );
    }
    if (url.includes('/ai-events/') && lastEventMpp) {
      return Promise.resolve(
        jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 1, mpp_code: lastEventMpp, created_at: new Date().toISOString() }],
        }),
      );
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

describe('SelectMppScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('sizes each collection point as well as naming it', async () => {
    mockApi(MPPS);
    renderWithStore(<SelectMppScreen onSelect={jest.fn()} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('mpp-MPP0004120')).toBeTruthy());
    // The code identifies it; the member count tells two similar villages apart.
    expect(screen.getByText(/MPP0004120 · 412 members/)).toBeTruthy();
    expect(screen.getByText(/288 members/)).toBeTruthy();
  });

  it('marks where the last event was recorded', async () => {
    // Not "nearest" — the MPP master has no coordinates, so nothing here can claim distance.
    // Where a Mait worked last is a true guess at where they are standing.
    mockApi(MPPS, 'MPP0004135');
    renderWithStore(<SelectMppScreen onSelect={jest.fn()} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByText('Last used')).toBeTruthy());
  });

  it('lists them in code order, the order every printed roster uses', async () => {
    mockApi([
      mpp({ id: 3, mpp_code: 'MPP0004188', mpp_name: 'Kosi Kalan MPP' }),
      mpp({ id: 1, mpp_code: 'MPP0004120', mpp_name: 'Barsana MPP' }),
      mpp({ id: 2, mpp_code: 'MPP0004135', mpp_name: 'Nandgaon MPP' }),
    ]);
    renderWithStore(<SelectMppScreen onSelect={jest.fn()} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('mpp-MPP0004120')).toBeTruthy());
    const codes = screen.getAllByText(/MPP00041\d\d · /).map(node => node.props.children);
    expect(codes).toEqual([
      expect.stringContaining('MPP0004120'),
      expect.stringContaining('MPP0004135'),
      expect.stringContaining('MPP0004188'),
    ]);
  });

  it('names the chosen point above the button', async () => {
    // The selected row can be scrolled off screen by the time a Mait reaches Continue, so a
    // tick they cannot see is not a confirmation.
    mockApi(MPPS);
    renderWithStore(<SelectMppScreen onSelect={jest.fn()} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('mpp-MPP0004120')).toBeTruthy());
    expect(screen.queryByTestId('mpp-chosen')).toBeNull();

    fireEvent.press(screen.getByTestId('mpp-MPP0004120'));
    expect(screen.getByText('Barsana MPP selected')).toBeTruthy();
  });

  it('holds the choice until it is confirmed', async () => {
    // Tapping a row selects it; the flow only moves on Continue. A list that navigates on
    // touch turns a mis-tap into a wrong collection point three screens later.
    const onSelect = jest.fn();
    mockApi(MPPS);
    renderWithStore(<SelectMppScreen onSelect={onSelect} onBack={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('mpp-MPP0004120')).toBeTruthy());
    fireEvent.press(screen.getByTestId('mpp-MPP0004120'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('mpp-continue'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ mpp_code: 'MPP0004120' }));
  });

  it('skips itself when there is nothing to choose between', async () => {
    const onSelect = jest.fn();
    mockApi([mpp()]);
    renderWithStore(<SelectMppScreen onSelect={onSelect} onBack={jest.fn()} />);

    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(screen.queryByTestId('mpp-search')).toBeNull();
  });
});
