/**
 * The two writes that close a capture (SRS §6.9, ADR 0003).
 *
 * Both have to choose, from a failed request alone, between "the network dropped" and "the
 * server said no". Getting that wrong is not a cosmetic bug in either direction: queue a
 * refusal and the capture sits on the waiting list for ever, claiming to need a network it
 * already has; drop a timeout and an insemination that happened is gone.
 */

import { attachPhoto, completeEvent } from '../capture';
import { clearQueue, pendingCount, readQueue } from '../queue';
import type { QueuedLabel } from '../queue';
import type { CapturedPhoto } from '@/features/aiFlow/CapturePhotoScreen';

const TOKEN = 'access-token';

const LABEL: QueuedLabel = {
  farmer: 'Kavita Devi',
  kind: 'member',
  amount: null,
  at: '10:42',
  eventId: 7,
};

const PHOTO: CapturedPhoto = {
  uri: 'file:///proof.jpg',
  gpsLat: 28.367,
  gpsLng: 79.4304,
  accuracy: 12,
  performedAt: '2026-08-14T10:42:00.000Z',
  source: 'camera',
  gpsSource: 'device',
};

beforeEach(async () => {
  await clearQueue();
  global.fetch = jest.fn() as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

function status(code: number) {
  return Promise.resolve({ ok: code < 400, status: code } as Response);
}

describe('completing an event', () => {
  it('queues it when the handset has no signal', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    const outcome = await completeEvent(7, 'uuid-1', TOKEN);

    expect(outcome.sent).toBe(false);
    expect(outcome.remaining).toBe(1);
  });

  it('does not queue a completion the server refused', async () => {
    // The regression. A 4xx will be a 4xx on every retry, so queuing one put the capture on
    // the waiting list permanently — a row a Mait could neither send nor be rid of, on the one
    // screen in the app that promises nothing there is lost.
    (global.fetch as jest.Mock).mockImplementation(() => status(422));

    const outcome = await completeEvent(7, 'uuid-1', TOKEN);

    expect(outcome.sent).toBe(false);
    expect(await pendingCount()).toBe(0);
  });

  it('still queues when the server itself is broken', async () => {
    // A 500 is the server having a bad minute, not a refusal of this record. Treating the two
    // alike is how a deploy in the middle of the afternoon costs a day of inseminations.
    (global.fetch as jest.Mock).mockImplementation(() => status(502));

    await completeEvent(7, 'uuid-1', TOKEN);

    expect(await pendingCount()).toBe(1);
  });

  it('queues a throttled request rather than dropping it', async () => {
    // 429 is the server asking for a minute, and it is the one 4xx that comes good on its own.
    (global.fetch as jest.Mock).mockImplementation(() => status(429));

    await completeEvent(7, 'uuid-1', TOKEN);

    expect(await pendingCount()).toBe(1);
  });

  it('queues without a session rather than sending an unauthenticated write', async () => {
    const outcome = await completeEvent(7, 'uuid-1', null);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(outcome.remaining).toBe(1);
  });

  it('carries the capture uuid as the idempotency key', async () => {
    // Without it a resend is read as a second insemination against the same animal.
    (global.fetch as jest.Mock).mockImplementation(() => status(200));

    await completeEvent(7, 'uuid-abc', TOKEN);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].headers['Idempotency-Key']).toBe('uuid-abc');
  });
});

describe('closing a record whose straw has already gone', () => {
  /**
   * The flag that lets the server skip a stock movement, and the fact that an ordinary
   * completion never carries it.
   *
   * Both halves matter. Without the flag the stuck record cannot be closed at all; with it
   * sent by default, a completion that met a missing straw would shrug — and a straw that can
   * be shrugged at is a straw that serves two animals.
   */
  it('asks to close without a stock movement only when told to', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => status(200));

    await completeEvent(7, 'uuid-abc', TOKEN, LABEL, { withoutStock: true });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.close_without_stock).toBe(true);
  });

  it('never asks for it on an ordinary completion', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => status(200));

    await completeEvent(7, 'uuid-abc', TOKEN, LABEL);

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.close_without_stock).toBe(false);
  });

  it('carries the decision through the offline queue', async () => {
    // A close-off pressed in a village goes out hours later, and it has to still be a
    // close-off when it does — nothing on the server can work that out for itself.
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await completeEvent(7, 'uuid-1', TOKEN, LABEL, { withoutStock: true });

    expect((await readQueue())[0]?.payload.closeWithoutStock).toBe(true);
  });
});

describe('the label on a queued job', () => {
  /**
   * The waiting list is read on a handset that by definition cannot reach the server, so
   * whatever names the row has to travel with the job. A member's capture queues no payment,
   * and the payment job was the only one that used to carry a label — so a member's record
   * reached that screen with nothing on it but the word "Capture".
   */
  it('names the farmer on a queued completion', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await completeEvent(7, 'uuid-1', TOKEN, LABEL);

    expect((await readQueue())[0]?.label).toEqual(LABEL);
  });

  it('names the farmer on a queued photo', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    const [job] = await readQueue();
    expect(job?.kind).toBe('attachPhoto');
    expect(job?.label?.farmer).toBe('Kavita Devi');
  });

  it('names the farmer on a photo queued with no session at all', async () => {
    await attachPhoto(7, 'uuid-1', PHOTO, null, LABEL);

    expect((await readQueue())[0]?.label).toEqual(LABEL);
  });
});
