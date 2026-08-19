/**
 * Your indents (M22).
 *
 * The screen exists to answer one question — is anything waiting for me to collect — and to
 * stop a Mait reading "issued" as "in my flask". That is the failure this list is built
 * around: the dairy marks an indent issued when the depot packs it, the stock becomes the
 * Mait's only when they collect and confirm, and a Mait who confuses the two starts a round
 * on straws that are still sitting at the depot.
 *
 * So every row says what to do about it in words, the headline counts only what can actually
 * be fetched today, and the difference is spelled out at the foot.
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

const WAITING = indent({
  id: 2291,
  status: 'issued',
  status_display: 'Issued',
  qty_issued: 25,
  issued_at: '2026-08-19T09:12:00Z',
});

const STILL_WITH_THE_STORE = indent({ id: 2304, breed: 'SAHIWAL', item: '10 SAHIWAL' });

const COLLECTED = indent({
  id: 2210,
  status: 'issued',
  status_display: 'Issued',
  qty_issued: 25,
  issued_at: '2026-08-11T09:12:00Z',
  received_at: '2026-08-12T09:12:00Z',
});

const BREEDS = [
  { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 1 },
];

function mockIndents(results: Indent[]) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    return jsonResponse({ count: results.length, next: null, previous: null, results });
  });
}

describe('IndentsScreen', () => {
  const onOpen = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  const render = () => renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

  it('counts only what can actually be collected today', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE, COLLECTED]);
    render();

    // Three indents, one trip to the depot. A headline counting all three would send a Mait
    // to fetch something the store has not even approved.
    await waitFor(() =>
      expect(screen.getByTestId('indents-headline')).toHaveTextContent(
        /One issued and waiting for you to collect/,
      ),
    );
  });

  it('says what each one needs, not just where it is', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE, COLLECTED]);
    render();

    await waitFor(() => expect(screen.getByTestId('indent-2291')).toBeTruthy());

    expect(screen.getByTestId('indent-2291')).toHaveTextContent(/collect it from the depot/);
    expect(screen.getByTestId('indent-2304')).toHaveTextContent(/waiting for the store/);
    expect(screen.getByTestId('indent-2210')).toHaveTextContent(/it is in your stock/);
  });

  it('names the breed the way the rest of the app does', async () => {
    mockIndents([WAITING]);
    render();

    // "Murrah" from the admin's own breed list, not the MURRAH code off the indent row.
    await waitFor(() => expect(screen.getByTestId('indent-2291')).toHaveTextContent(/Murrah/));
  });

  it('warns that issued is not received', async () => {
    mockIndents([WAITING]);
    render();

    await waitFor(() =>
      expect(screen.getByTestId('indents-footnote')).toHaveTextContent(
        /stock rises only when you confirm collection/,
      ),
    );
  });

  it('opens the one that was tapped', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE]);
    render();

    await waitFor(() => screen.getByTestId('indent-2304'));
    fireEvent.press(screen.getByTestId('indent-2304'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2304 }));
  });

  it('says nothing has been raised rather than showing an empty page', async () => {
    mockIndents([]);
    render();

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeTruthy());
    // No footnote either: there is nothing for it to be a warning about.
    expect(screen.queryByTestId('indents-footnote')).toBeNull();
  });

  it('goes back to where it was opened from', async () => {
    mockIndents([WAITING]);
    render();

    fireEvent.press(await screen.findByTestId('indents-back'));

    expect(onBack).toHaveBeenCalled();
  });
});
