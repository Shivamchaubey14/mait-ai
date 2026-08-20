/**
 * One AI event, whole (M20).
 *
 * This is the screen a dispute is settled on, so what is defended is what it says out loud to
 * a farmer standing there: what she is charged and where that money goes, and — where the
 * capture stopped — which step is actually missing and where the button leads.
 *
 * The audit trail is asserted for its default rather than its contents. On a finished event it
 * stays folded, because nothing about it is in question; on an unfinished one it opens
 * unasked, because how far the capture got is the first thing anybody looks at.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import AiEventDetailScreen from '../AiEventDetailScreen';
import type { AIEvent, AIEventTimelineEntry } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

const BREEDS = [
  {
    code: 'HF_CROSS',
    name: 'HF Cross',
    name_hi: 'एचएफ क्रॉस',
    animal_type: 'COW',
    display_order: 1,
  },
];

const TRAIL: AIEventTimelineEntry[] = [
  {
    id: 1,
    from_status: '',
    to_status: 'draft',
    note: 'Capture started',
    actor_name: 'Sunil Kumar',
    created_at: '2026-08-18T10:41:00Z',
  },
  {
    id: 2,
    from_status: 'straw_verified',
    to_status: 'photo_captured',
    note: 'AI proof photo captured',
    actor_name: 'Sunil Kumar',
    created_at: '2026-08-18T10:43:00Z',
  },
];

function event(over: Partial<AIEvent> = {}): AIEvent {
  return {
    id: 30,
    client_uuid: 'uuid-30',
    status: 'completed',
    status_display: 'Completed',
    mpp: 1,
    mpp_code: '001302',
    mpp_name: 'Barsana MPP',
    owner_type: 'member',
    member: 4,
    member_code: 'MEM00000412',
    non_member: null,
    owner_name: 'Kavita Devi',
    animal: 7,
    animal_type: 'COW',
    breed: 'HF_CROSS',
    ear_tag_no: '4821',
    semen_breed: 'HF_CROSS',
    doses: 1,
    consumables: [],
    amount_due: '50.00',
    payment: {
      amount: '50.00',
      mode: 'DEDUCTION',
      mode_display: 'Deducted from milk',
      status: 'verified',
      status_display: 'Verified',
      is_verified: true,
    },
    straw_unique_no: '',
    stock_deducted: true,
    ai_photo_url: '/media/ai-photos/30.jpg',
    photo_source: 'camera',
    gps_source: 'device',
    gps_lat: '26.7524000',
    gps_lng: '82.1408000',
    performed_at: '2026-08-18T10:43:00Z',
    completed_at: '2026-08-18T10:44:00Z',
    cancelled_reason: '',
    created_at: '2026-08-18T10:41:00Z',
    ...over,
  } as AIEvent;
}

function mockApi(value: AIEvent) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    if (url.includes('/timeline/')) {
      return jsonResponse(TRAIL);
    }
    return jsonResponse(value);
  });
}

describe('AiEventDetailScreen', () => {
  const onBack = jest.fn();
  const onResume = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  const renderScreen = () =>
    renderWithStore(<AiEventDetailScreen eventId={30} onBack={onBack} onResume={onResume} />);

  it('says what a member is charged and where that money goes', async () => {
    mockApi(event());
    renderScreen();

    await waitFor(() => expect(screen.getByText('Kavita Devi')).toBeTruthy());
    // The charge is real and it is named — but beside it, in the same tile, is the fact that
    // the dairy takes it. A figure on its own reads as cash the Mait collected.
    expect(screen.getByTestId('tile-payment')).toHaveTextContent(/₹ 50/);
    expect(screen.getByTestId('tile-payment')).toHaveTextContent(/Deducted from milk/);
    expect(screen.getByTestId('ai-event-status')).toHaveTextContent(/Completed/);
  });

  it('leaves the trail folded on a finished event and opens it on request', async () => {
    mockApi(event());
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-trail-open'));
    expect(screen.queryByTestId('ai-event-trail')).toBeNull();

    fireEvent.press(screen.getByTestId('ai-event-trail-open'));

    await waitFor(() => expect(screen.getByText('Capture started')).toBeTruthy());
    expect(screen.getByText(/cannot be edited/)).toBeTruthy();
  });

  it('opens an unfinished capture with what is missing, the trail, and the way back in', async () => {
    mockApi(
      event({
        id: 31,
        owner_type: 'non_member',
        member_code: '',
        non_member: 9,
        owner_name: 'Radha Singh',
        status: 'payment_pending',
        completed_at: null,
        amount_due: '300.00',
        payment: {
          amount: '300.00',
          mode: 'COD',
          mode_display: 'Cash',
          status: 'pending',
          status_display: 'Pending',
          is_verified: false,
        },
      }),
    );
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('ai-event-alert')).toBeTruthy());
    expect(screen.getByTestId('ai-event-alert')).toHaveTextContent(
      /Her payment code was never entered/,
    );
    // Cash she has already handed over, said in the sentence that explains why it matters.
    expect(screen.getByTestId('ai-event-alert')).toHaveTextContent(/₹ 300/);
    expect(screen.getByTestId('ai-event-status')).toHaveTextContent(/Waiting/);
    // Unrolled without being asked for.
    expect(screen.getByTestId('ai-event-trail')).toBeTruthy();

    fireEvent.press(screen.getByTestId('ai-event-resume'));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ status: 'payment_pending' }));
  });

  it('names the step a capture stopped on rather than a generic finish', async () => {
    mockApi(
      event({
        owner_type: 'non_member',
        member_code: '',
        status: 'straw_verified',
        completed_at: null,
        ai_photo_url: '',
        payment: null,
      }),
    );
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('ai-event-resume')).toBeTruthy());
    expect(screen.getByTestId('ai-event-resume')).toHaveTextContent(/Take the proof photo/);
    // No photo yet, and the card says so rather than showing an empty frame.
    expect(screen.getByTestId('ai-event-photo-empty')).toBeTruthy();
  });

  it('does not ask for a code that has already been confirmed', async () => {
    // A verified payment on an event that never completed: the connection died at the last
    // step. Reading this as "her code was never entered" sends a Mait back to a farmer to ask
    // for something the system already has.
    mockApi(
      event({
        owner_type: 'non_member',
        member_code: '',
        status: 'payment_pending',
        completed_at: null,
        payment: {
          amount: '300.00',
          mode: 'COD',
          mode_display: 'Cash',
          status: 'verified',
          status_display: 'Verified',
          is_verified: true,
        },
      }),
    );
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('ai-event-alert')).toBeTruthy());
    expect(screen.getByTestId('ai-event-alert')).toHaveTextContent(/never closed off/);
    expect(screen.queryByText(/payment code was never entered/)).toBeNull();
    expect(screen.getByTestId('ai-event-resume')).toHaveTextContent(/Close this off/);
  });

  it('says on the record when the photo was chosen rather than taken', async () => {
    // The difference between evidence and a photograph. The app accepts both — a Mait whose
    // camera will not open still has to finish the round — and somebody settling a dispute
    // six months later cannot tell them apart by looking, so the record says which.
    mockApi(event({ photo_source: 'gallery', gps_source: 'photo' }));
    renderScreen();

    await waitFor(() => expect(screen.getByText(/Chosen from the gallery/)).toBeTruthy());
    expect(screen.getByTestId('tile-location')).toHaveTextContent(/From the photo itself/);
  });

  it('says what came off the stock besides the semen', async () => {
    // The sheath and the gloves are what a month-end count actually goes missing on, and
    // until they were recorded there was nowhere to read them.
    mockApi(
      event({
        doses: 2,
        consumables: [
          { code: 'SHEATH', name: 'AI sheaths', unit: 'piece', qty: 2 },
          { code: 'GLOVES', name: 'Gloves', unit: 'pair', qty: 1 },
        ],
      }),
    );
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('ai-event-used')).toBeTruthy());
    expect(screen.getByTestId('ai-event-used')).toHaveTextContent(/AI sheaths/);
    expect(screen.getByTestId('ai-event-used')).toHaveTextContent(/2 piece/);
    expect(screen.getByTestId('ai-event-used')).toHaveTextContent(/Gloves/);
    // And the semen is counted on its own tile, in doses.
    expect(screen.getByTestId('tile-breed')).toHaveTextContent(/2 doses/);
  });

  it('shows no card at all for a capture recorded before consumables existed', async () => {
    mockApi(event());
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tile-breed')).toHaveTextContent(/1 dose/));
    expect(screen.queryByTestId('ai-event-used')).toBeNull();
  });

  it('opens the proof photo whole when the card is tapped', async () => {
    // The card crops the photograph to a 180pt band, and the ear tag a farmer is being asked
    // to recognise is as often as not in the part the crop took. Settling a dispute means
    // being able to see the whole frame.
    mockApi(event());
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-photo-open'));
    expect(screen.queryByTestId('ai-event-photo-full')).toBeNull();

    fireEvent.press(screen.getByTestId('ai-event-photo-open'));

    expect(screen.getByTestId('ai-event-photo-full')).toBeTruthy();
    // `contain`, never `cover`: a viewer that crops to fill the screen has made the same cut
    // the card already made, and opening it would have achieved nothing.
    expect(screen.getByTestId('ai-event-photo-full').props.resizeMode).toBe('contain');
  });

  it('carries the photo caption into the viewer, so proof is never shown unqualified', async () => {
    // Whether it was taken here or chosen from the gallery is the first question asked of a
    // photograph offered as proof, and the full-size view is where it is examined hardest.
    mockApi(event({ photo_source: 'gallery' }));
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-photo-open'));
    fireEvent.press(screen.getByTestId('ai-event-photo-open'));

    expect(screen.getByTestId('ai-event-photo-viewer-caption')).toHaveTextContent(
      /Chosen from the gallery/,
    );
  });

  it('closes the viewer again', async () => {
    mockApi(event());
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-photo-open'));
    fireEvent.press(screen.getByTestId('ai-event-photo-open'));
    fireEvent.press(screen.getByTestId('ai-event-photo-close'));

    expect(screen.queryByTestId('ai-event-photo-full')).toBeNull();
  });

  it('has nothing to open on a capture whose photo was never taken', async () => {
    // The frame is still there — it says the photo is missing — but tapping it must not open
    // a black screen with nothing in it.
    mockApi(event({ ai_photo_url: '', status: 'straw_verified', payment: null }));
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-photo-empty'));
    fireEvent.press(screen.getByTestId('ai-event-photo-open'));

    expect(screen.queryByTestId('ai-event-photo-full')).toBeNull();
  });

  it('goes back to the list', async () => {
    mockApi(event());
    renderScreen();

    await waitFor(() => screen.getByTestId('ai-event-back'));
    fireEvent.press(screen.getByTestId('ai-event-back'));

    expect(onBack).toHaveBeenCalled();
  });
});
