/**
 * Indent detail tests (SRS §6.6).
 *
 * The screen states quantities a Mait plans around, so the rule under test is that it never
 * shows a number the server has not agreed to: approval is of the whole request, and until
 * it happens the approved quantity is a dash rather than the amount asked for.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import IndentDetailScreen, { rejectionReason } from '../IndentDetailScreen';
import type { Indent } from '@api/types';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

function indent(overrides: Partial<Indent> = {}): Indent {
  return {
    id: 2291,
    breed: 'MURRAH',
    item: '25 MURRAH',
    qty_requested: 25,
    qty_issued: 0,
    status: 'requested',
    status_display: 'Requested',
    requested_at: '2026-08-04T09:12:00Z',
    issued_at: null,
    received_at: null,
    note: '',
    ...overrides,
  };
}

function mockIndent(value: Indent) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    // The config endpoints answer with a bare array and the MPPs with a page. Handing either
    // an indent makes the screen call `.find` on an object and throw, which surfaces here as
    // the screen never rendering rather than as the type error it is.
    if (url.includes('/config/')) {
      return jsonResponse([
        { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 1 },
      ]);
    }
    if (url.includes('/mpp/')) {
      return jsonResponse({ count: 0, next: null, previous: null, results: [] });
    }
    return jsonResponse(value);
  });
}

/** Exactly the shape `reject_indent` leaves behind: the Mait's note, then the office's. */
const REJECTED_NOTE = 'Need it before Friday · Rejected: No Murrah left in the depot';

describe('IndentDetailScreen', () => {
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  const renderScreen = () =>
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

  it('names the indent and its status', async () => {
    mockIndent(indent());
    renderScreen();

    await waitFor(() => expect(screen.getByText('IND-2291')).toBeTruthy());
    expect(screen.getByTestId('indent-status')).toBeTruthy();
  });

  it('withholds an approved quantity until it has been approved', async () => {
    mockIndent(indent());
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-qty-approved'));

    expect(screen.getByTestId('indent-qty-approved')).toHaveTextContent(/—/);
    expect(screen.getByTestId('indent-qty-approved')).not.toHaveTextContent(/25/);
    expect(screen.getByTestId('indent-qty-requested')).toHaveTextContent(/25/);
  });

  it('shows the approved quantity once the office has agreed', async () => {
    mockIndent(indent({ status: 'approved', status_display: 'Approved' }));
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-qty-approved'));

    expect(screen.getByTestId('indent-qty-approved')).toHaveTextContent(/25/);
  });

  it('keeps collection inert until the stock has been issued', async () => {
    mockIndent(indent({ status: 'approved', status_display: 'Approved' }));
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-confirm-collection'));

    // Shown and disabled, with the notice saying why, rather than hidden — a Mait who cannot
    // see the last step does not know one is coming.
    expect(screen.getByTestId('indent-confirm-collection')).toBeDisabled();
    expect(screen.getByTestId('indent-collection')).toBeTruthy();
  });

  it('opens collection once the stock is issued', async () => {
    mockIndent(indent({ status: 'issued', status_display: 'Issued', qty_issued: 25 }));
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-confirm-collection'));

    expect(screen.getByTestId('indent-confirm-collection')).not.toBeDisabled();
  });

  it('confirms collection and does not offer it twice', async () => {
    mockIndent(indent({ status: 'issued', status_display: 'Issued', qty_issued: 25 }));
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-confirm-collection'));

    // The confirmed indent is what the server answers with from here on.
    mockIndent(
      indent({
        status: 'issued',
        status_display: 'Issued',
        qty_issued: 25,
        received_at: '2026-08-07T10:15:00Z',
      }),
    );
    fireEvent.press(screen.getByTestId('indent-confirm-collection'));

    await waitFor(() => expect(screen.getByTestId('indent-confirm-collection')).toBeDisabled());
  });

  it('will not offer collection on an indent already confirmed', async () => {
    mockIndent(
      indent({
        status: 'issued',
        status_display: 'Issued',
        qty_issued: 25,
        received_at: '2026-08-07T10:15:00Z',
      }),
    );
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-confirm-collection'));

    expect(screen.getByTestId('indent-confirm-collection')).toBeDisabled();
    expect(screen.getByText('This is in your stock')).toBeTruthy();
  });

  it('re-reads the timeline when pulled', async () => {
    mockIndent(indent({ status: 'approved', status_display: 'Approved' }));
    renderScreen();

    await waitFor(() => screen.getByTestId('indent-scroll'));
    const before = (global.fetch as jest.Mock).mock.calls.length;

    // The timeline moves when the office acts, not when the Mait does, so the screen goes
    // stale while it is being read. Invoked through the control's own prop: a RefreshControl
    // passed to ScrollView is not mounted as a queryable element.
    await act(async () => {
      screen.getByTestId('indent-scroll').props.refreshControl.props.onRefresh();
    });

    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('parses the reason back out of the note the office appended it to', () => {
    // `reject_indent` writes "<the Mait's own note> · Rejected: <reason>" into one field
    // rather than keeping a column for it, so this is string surgery on a format owned by
    // another codebase — the kind of thing that breaks quietly when that codebase changes.
    expect(rejectionReason('Need it before Friday · Rejected: No Murrah left')).toBe(
      'No Murrah left',
    );
    expect(rejectionReason('Just a note from me')).toBeNull();
    // Rejected with no reason typed. There is nothing to show, and an empty string shown as
    // "Reason: " is worse than saying none was given.
    expect(rejectionReason('Something · Rejected:')).toBeNull();
    // The Mait wrote the word themselves. The office's copy is the last one.
    expect(rejectionReason('Rejected: mine · Rejected: theirs')).toBe('theirs');
  });

  it('stops the trail at the refusal instead of promising the rest', async () => {
    // The bug this fixes: a rejected indent still showed "Approved by store · Waiting on the
    // store" and "Issued · Not packed yet" underneath a status reading Rejected — the screen
    // telling a Mait to keep waiting for something that is never coming.
    mockIndent(indent({ status: 'rejected', status_display: 'Rejected', note: REJECTED_NOTE }));
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

    await waitFor(() => expect(screen.getByTestId('indent-status')).toHaveTextContent(/Rejected/));
    expect(screen.getByText(/Turned down by the office/)).toBeTruthy();
    expect(screen.queryByText(/Waiting on the zonal manager/)).toBeNull();
    expect(screen.queryByText(/Not packed yet/)).toBeNull();
    expect(screen.queryByText(/Confirmed when you collect/)).toBeNull();
  });

  it('puts the reason on the trail, where it can be read back to the office', async () => {
    mockIndent(indent({ status: 'rejected', status_display: 'Rejected', note: REJECTED_NOTE }));
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

    await waitFor(() => expect(screen.getByText(/No Murrah left in the depot/)).toBeTruthy());
    expect(screen.getByTestId('indent-rejected')).toBeTruthy();
    expect(screen.queryByTestId('indent-collection')).toBeNull();
  });

  it('says so plainly when a refusal carries no reason', async () => {
    mockIndent(indent({ status: 'rejected', status_display: 'Rejected', note: '' }));
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

    await waitFor(() => expect(screen.getByText(/No reason was given/)).toBeTruthy());
  });

  it('does not offer to confirm a collection that will never happen', async () => {
    mockIndent(indent({ status: 'rejected', status_display: 'Rejected', note: REJECTED_NOTE }));
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

    await waitFor(() => screen.getByTestId('indent-confirm-collection'));
    const cta = screen.getByTestId('indent-confirm-collection');
    expect(cta.props.accessibilityState.disabled).toBe(true);
    expect(cta).toHaveTextContent(/Turned down/);
    expect(cta).not.toHaveTextContent(/Confirm collection/);
  });

  it('stops promising a depot trip on a refused indent', async () => {
    // Amber and a depot name both say "go and fetch this", and there is nothing to fetch.
    mockIndent(indent({ status: 'rejected', status_display: 'Rejected', note: REJECTED_NOTE }));
    renderWithStore(<IndentDetailScreen indentId={2291} onBack={onBack} />);

    await waitFor(() => screen.getByTestId('indent-qty-issued'));
    expect(screen.getByTestId('indent-qty-issued')).toHaveTextContent(/Nothing will be issued/);
  });

  describe('stock handed over at a store', () => {
    /** 18 of 25 over the counter at Barsana, waiting for the Mait's code; 7 still owed. */
    const atCounter = indent({
      status: 'approved',
      status_display: 'Approved',
      qty_issued: 18,
      issued_at: '2026-08-20T05:50:00Z',
      store: 1,
      store_name: 'Barsana depot',
      approved_at: '2026-08-19T09:00:00Z',
      approved_by_name: 'Zonal manager',
      approved_by_zone: 'Mathura',
      qty_open: 7,
      qty_to_collect: 18,
      needs_code: true,
      handovers: [],
    });

    it('asks for the store’s code before it will confirm', async () => {
      mockIndent(atCounter);
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-code-input'));
      expect(screen.getByTestId('indent-confirm-collection')).toBeDisabled();
      expect(screen.getByTestId('indent-confirm-collection')).toHaveTextContent(
        /Confirm 18 collected/,
      );
      expect(screen.getByText('Ask Barsana depot to read you the four digits')).toBeTruthy();
      // The code never reaches this phone, so a lost one comes from the counter — and says so.
      expect(screen.getByTestId('indent-code-lost')).toHaveTextContent(
        'Lost it? The store can read it out to you again.',
      );

      fireEvent.changeText(screen.getByTestId('indent-code-input'), '4729');
      expect(screen.getByTestId('indent-confirm-collection')).not.toBeDisabled();
    });

    it('sends the code the Mait typed', async () => {
      mockIndent(atCounter);
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-code-input'));
      fireEvent.changeText(screen.getByTestId('indent-code-input'), '47a29');
      fireEvent.press(screen.getByTestId('indent-confirm-collection'));

      await waitFor(() =>
        expect(
          (global.fetch as jest.Mock).mock.calls.some(
            ([input]) => (input as Request).method === 'POST',
          ),
        ).toBe(true),
      );
      const post = (global.fetch as jest.Mock).mock.calls
        .map(([input]) => input as Request)
        .find(request => request.method === 'POST') as Request;
      expect(post.url).toMatch(/confirm-collection\/$/);
      // Digits only, four of them — a stray letter from the keyboard never reaches the server.
      expect(await post.clone().json()).toEqual({ code: '4729' });
    });

    it('says the code was wrong rather than that something failed', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
        if (input.method === 'POST') {
          return problemResponse(400, 'collection-code-invalid');
        }
        if (input.url.includes('/config/')) {
          return jsonResponse([]);
        }
        if (input.url.includes('/mpp/')) {
          return jsonResponse({ count: 0, next: null, previous: null, results: [] });
        }
        return jsonResponse(atCounter);
      });
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-code-input'));
      fireEvent.changeText(screen.getByTestId('indent-code-input'), '1111');
      fireEvent.press(screen.getByTestId('indent-confirm-collection'));

      await waitFor(() =>
        expect(
          screen.getByText('That is not the code the store read out. Ask them to read it again.'),
        ).toBeTruthy(),
      );
    });

    it('shows each batch on its own, so a second trip of 2 never reads as 5', async () => {
      mockIndent(
        indent({
          status: 'issued',
          status_display: 'Issued',
          qty_requested: 5,
          qty_issued: 5,
          store: 1,
          store_name: 'Akbarpur depot',
          qty_open: 0,
          qty_to_collect: 0,
          needs_code: false,
          received_at: '2026-09-11T06:09:14Z',
          handovers: [
            {
              id: 2,
              qty: 2,
              store_name: 'Akbarpur depot',
              issued_at: '2026-09-11T06:08:00Z',
              collected_at: '2026-09-11T06:09:14Z',
              cancelled_at: null,
              state: 'collected',
            },
            {
              id: 1,
              qty: 3,
              store_name: 'Akbarpur depot',
              issued_at: '2026-09-11T05:29:00Z',
              collected_at: '2026-09-11T05:30:06Z',
              cancelled_at: null,
              state: 'collected',
            },
          ],
        }),
      );
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-trip-1'));
      expect(screen.getByTestId('indent-trip-1')).toHaveTextContent(/\+3/);
      expect(screen.getByTestId('indent-trip-2')).toHaveTextContent(/\+2/);
      expect(screen.getByTestId('indent-trip-2')).toHaveTextContent(/From Akbarpur depot/);
    });

    it('says how many the collection just added', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
        if (input.method === 'POST') {
          return jsonResponse({ ...atCounter, qty_to_collect: 0, needs_code: false });
        }
        if (input.url.includes('/config/')) {
          return jsonResponse([
            { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 1 },
          ]);
        }
        if (input.url.includes('/mpp/')) {
          return jsonResponse({ count: 0, next: null, previous: null, results: [] });
        }
        return jsonResponse(atCounter);
      });
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-code-input'));
      fireEvent.changeText(screen.getByTestId('indent-code-input'), '4729');
      fireEvent.press(screen.getByTestId('indent-confirm-collection'));

      await waitFor(() => expect(screen.getByText('18 Murrah added to your stock.')).toBeTruthy());
    });

    it('names the store and says the rest is still open', async () => {
      mockIndent(atCounter);
      renderScreen();

      await waitFor(() => screen.getByTestId('indent-part-open'));
      expect(screen.getByTestId('indent-part-open')).toHaveTextContent(/7 still open/);
      expect(screen.getByText(/18 issued at Barsana depot/)).toBeTruthy();
      expect(screen.getByText(/25 approved · Zonal manager/)).toBeTruthy();
    });
  });
});
