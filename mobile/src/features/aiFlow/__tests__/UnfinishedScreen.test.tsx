/**
 * The Unfinished list's discard action (SRS §11 `cancelled`).
 *
 * A capture stranded at `straw_verified` — the straw was scanned, the photo never taken — can
 * be resumed to finish it or discarded when it never will be. These tests cover the discard:
 * the row offers it, the confirm has to be accepted, and accepting POSTs the cancel to the
 * server. The straw release and the status rules are the server's, tested there.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import UnfinishedScreen from '../UnfinishedScreen';
import { clearQueue, enqueue } from '@api/queue';
import { jsonResponse, renderWithStore } from '@/test-utils';

/** One abandoned capture at `straw_verified`, shaped the way the API sends it. */
const STRANDED = {
  id: 1727,
  client_uuid: '22222222-2222-4222-8222-222222222222',
  status: 'straw_verified',
  owner_type: 'member',
  owner_name: 'ANJU',
  member_code: '0924144159010010',
  animal_type: 'COW',
  ear_tag_no: 'TAG-9',
  straw_unique_no: 'RED_SINDHI-0003',
  ai_photo_url: '',
  completed_at: null,
  created_at: '2026-11-04T12:33:00+05:30',
  payment: null,
};

/** The list GET returns the stranded capture; the cancel POST is recorded and answered. */
function mockApi(cancelCalls: string[]) {
  (global.fetch as jest.Mock) = jest.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/cancel/')) {
      cancelCalls.push(url);
      return jsonResponse({ ...STRANDED, status: 'cancelled' });
    }
    if (url.includes('/ai-events/')) {
      return jsonResponse({ count: 1, next: null, previous: null, results: [STRANDED] });
    }
    return jsonResponse({ count: 0, next: null, previous: null, results: [] });
  });
}

describe('UnfinishedScreen discard', () => {
  const onResume = jest.fn();
  const onBack = jest.fn();
  let cancelCalls: string[];

  beforeEach(async () => {
    cancelCalls = [];
    await clearQueue(); // an empty phone queue, so the stranded row is genuinely "photo not taken"
    mockApi(cancelCalls);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await clearQueue();
  });

  function renderScreen() {
    return renderWithStore(<UnfinishedScreen onResume={onResume} onBack={onBack} />);
  }

  it('offers a discard on the stranded row', async () => {
    renderScreen();
    await waitFor(() => screen.getByTestId(`unfinished-discard-${STRANDED.id}`));
  });

  it('asks for confirmation and POSTs the cancel once accepted', async () => {
    // Auto-accept: fire the dialog's destructive button (the second one) immediately.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirm = buttons?.[1];
      confirm?.onPress?.();
    });

    renderScreen();
    fireEvent.press(await screen.findByTestId(`unfinished-discard-${STRANDED.id}`));

    await waitFor(() => expect(cancelCalls).toHaveLength(1));
    expect(cancelCalls[0]).toContain(`/ai-events/${STRANDED.id}/cancel/`);
  });

  it('does not POST anything when the confirmation is dismissed', async () => {
    // Dismiss: fire the cancel button (the first one), which has no onPress.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const dismiss = buttons?.[0];
      dismiss?.onPress?.();
    });

    renderScreen();
    fireEvent.press(await screen.findByTestId(`unfinished-discard-${STRANDED.id}`));

    await waitFor(() => screen.getByText('ANJU'));
    expect(cancelCalls).toHaveLength(0);
  });

  it('hides a capture whose photo is already queued — it is waiting, not "photo not taken"', async () => {
    // The reported bug: the photo WAS taken and the finalize is queued on the phone, yet the row
    // read "photo not taken". With the capture queued, it must not appear here at all.
    await enqueue('finalize', STRANDED.client_uuid, {
      eventId: STRANDED.id,
      photoUri: 'file://proof.jpg',
    });

    renderScreen();

    await waitFor(() => screen.getByTestId('unfinished-empty'));
    expect(screen.queryByText('ANJU')).toBeNull();
  });
});
