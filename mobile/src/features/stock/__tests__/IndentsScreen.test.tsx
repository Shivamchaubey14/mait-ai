/**
 * Indent list tests (SRS §6.6).
 *
 * The filter is the part worth covering. It narrows a list the Mait already has, so the two
 * failure modes are silent: a search that hides rows it should have matched, and an empty
 * result that reads like the requests are gone rather than like nothing matched.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import IndentsScreen from '../IndentsScreen';
import type { Indent } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

function indent(overrides: Partial<Indent> & Pick<Indent, 'id'>): Indent {
  return {
    breed: 'MURRAH',
    item: '25 MURRAH',
    qty_requested: 25,
    qty_issued: 0,
    status: 'requested',
    status_display: 'Requested',
    sync_status: 'synced',
    sync_status_display: 'Pushed to Indent Easy',
    requested_at: '2026-08-04T09:12:00Z',
    issued_at: null,
    received_at: null,
    note: '',
    ...overrides,
  };
}

const MURRAH = indent({ id: 2291 });
const SAHIWAL = indent({
  id: 2304,
  breed: 'SAHIWAL',
  item: '10 SAHIWAL',
  qty_requested: 10,
  status: 'issued',
  status_display: 'Issued',
  qty_issued: 10,
  issued_at: '2026-08-06T14:40:00Z',
});

function mockIndents(results: Indent[]) {
  (global.fetch as jest.Mock).mockResolvedValue(
    jsonResponse({ count: results.length, next: null, previous: null, results }),
  );
}

describe('IndentsScreen', () => {
  const onOpen = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  const renderScreen = () => renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

  it('lists what the Mait has asked for', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('IND-2291')).toBeTruthy());
    expect(screen.getByText('IND-2304')).toBeTruthy();
  });

  it('opens the one that was tapped', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-2291'));
    fireEvent.press(screen.getByTestId('indent-2291'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2291 }));
  });

  it('searches by breed', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-search'));
    fireEvent.changeText(screen.getByTestId('indent-search'), 'sahiwal');

    expect(screen.queryByText('IND-2291')).toBeNull();
    expect(screen.getByText('IND-2304')).toBeTruthy();
  });

  it('searches by number, with or without the IND- prefix', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-search'));

    fireEvent.changeText(screen.getByTestId('indent-search'), 'IND-2291');
    expect(screen.getByText('IND-2291')).toBeTruthy();
    expect(screen.queryByText('IND-2304')).toBeNull();

    fireEvent.changeText(screen.getByTestId('indent-search'), '2304');
    expect(screen.getByText('IND-2304')).toBeTruthy();
    expect(screen.queryByText('IND-2291')).toBeNull();
  });

  it('filters by status', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-filter-issued'));
    fireEvent.press(screen.getByTestId('indent-filter-issued'));

    expect(screen.getByText('IND-2304')).toBeTruthy();
    expect(screen.queryByText('IND-2291')).toBeNull();

    fireEvent.press(screen.getByTestId('indent-filter-all'));
    expect(screen.getByText('IND-2291')).toBeTruthy();
  });

  it('says nothing matched rather than nothing exists', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-search'));
    fireEvent.changeText(screen.getByTestId('indent-search'), 'GIR');

    // The distinction matters: "No requests yet" in front of a Mait who raised two of them
    // reads as lost data.
    expect(screen.getByTestId('indent-no-match')).toBeTruthy();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('clears the search back to the full list', async () => {
    mockIndents([MURRAH, SAHIWAL]);
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-search'));
    fireEvent.changeText(screen.getByTestId('indent-search'), 'sahiwal');
    fireEvent.press(screen.getByTestId('indent-search-clear'));

    expect(screen.getByText('IND-2291')).toBeTruthy();
    expect(screen.getByText('IND-2304')).toBeTruthy();
  });

  it('offers no filter at all when nothing has been raised', async () => {
    mockIndents([]);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    expect(screen.queryByTestId('indent-search')).toBeNull();
  });
});
