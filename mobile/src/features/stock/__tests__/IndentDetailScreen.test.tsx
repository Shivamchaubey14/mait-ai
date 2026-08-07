/**
 * Indent detail tests (SRS §6.6).
 *
 * The screen states quantities a Mait plans around, so the rule under test is that it never
 * shows a number the server has not agreed to: approval is of the whole request, and until
 * it happens the approved quantity is a dash rather than the amount asked for.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import IndentDetailScreen from '../IndentDetailScreen';
import type { Indent } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

function indent(overrides: Partial<Indent> = {}): Indent {
  return {
    id: 2291,
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

function mockIndent(value: Indent) {
  (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(value));
}

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

  it('flags an indent Indent Easy never received', async () => {
    mockIndent(indent({ sync_status: 'failed', sync_status_display: 'Push failed' }));
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('indent-not-synced')).toBeTruthy());
  });
});
