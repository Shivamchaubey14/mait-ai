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

const REJECTED = indent({
  id: 2188,
  status: 'rejected',
  status_display: 'Rejected',
  note: 'Need it before Friday · Rejected: No Murrah left in the depot',
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

  it('calls a collected indent collected, not issued', async () => {
    // The server is still right to call it `issued` — issuing is the last thing it did. But
    // the row was showing "Issued" over a line reading "Collected 12 Aug · it is in your
    // stock", and the status word is what gets scanned down a list of twenty.
    mockIndents([COLLECTED]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-2210')).toBeTruthy());
    expect(screen.getByTestId('indent-2210')).toHaveTextContent(/Collected/);
    expect(screen.getByTestId('indent-2210')).not.toHaveTextContent(/Issued/);
  });

  it('filters the list down to one status', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE, COLLECTED]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-2291')).toBeTruthy());

    fireEvent.press(screen.getByTestId('indent-filter-collected'));

    expect(screen.getByTestId('indent-2210')).toBeTruthy();
    expect(screen.queryByTestId('indent-2291')).toBeNull();
    expect(screen.queryByTestId('indent-2304')).toBeNull();
  });

  it('counts each status on its own chip, so the common question needs no tap', async () => {
    // "Was anything turned down" is the reason to reach for a status filter at all, and a
    // chip that answers it without being tapped has saved the tap.
    mockIndents([WAITING, STILL_WITH_THE_STORE, COLLECTED]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-filter-all')).toBeTruthy());
    expect(screen.getByTestId('indent-filter-all')).toHaveTextContent(/3/);
    expect(screen.getByTestId('indent-filter-collected')).toHaveTextContent(/1/);
    // Nothing was rejected, so the chip carries no nought — a row of greyed zeroes beside
    // every unused status is a report nobody asked for.
    expect(screen.getByTestId('indent-filter-rejected')).not.toHaveTextContent(/0/);
  });

  it('offers the way back when a filter empties the list', async () => {
    // "You have never raised one" and "none of yours are in this state" are different
    // nothings, and only one of them has a way out.
    mockIndents([WAITING]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-2291')).toBeTruthy());
    fireEvent.press(screen.getByTestId('indent-filter-rejected'));

    expect(screen.getByTestId('empty-state')).toHaveTextContent(/Tap All/);
  });

  it('counts the headline off the whole list, not the chip in force', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE, COLLECTED]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indents-headline')).toBeTruthy());
    fireEvent.press(screen.getByTestId('indent-filter-collected'));

    expect(screen.getByTestId('indents-headline')).toHaveTextContent(/waiting for you to collect/);
  });

  it('opens the one that was tapped', async () => {
    mockIndents([WAITING, STILL_WITH_THE_STORE]);
    render();

    await waitFor(() => screen.getByTestId('indent-2304'));
    fireEvent.press(screen.getByTestId('indent-2304'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2304 }));
  });

  it('shows a turned-down request as refused rather than as still coming', async () => {
    mockIndents([REJECTED]);
    renderWithStore(<IndentsScreen onOpen={onOpen} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-2188')).toBeTruthy());
    expect(screen.getByTestId('indent-2188')).toHaveTextContent(/Rejected/);
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
