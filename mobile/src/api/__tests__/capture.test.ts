/**
 * The two writes that close a capture (SRS §6.9, ADR 0003).
 *
 * Both have to choose, from a failed request alone, between "the network dropped" and "the
 * server said no". Getting that wrong is not a cosmetic bug in either direction: queue a
 * refusal and the capture sits on the waiting list for ever, claiming to need a network it
 * already has; drop a timeout and an insemination that happened is gone.
 */

import { completeEvent } from '../capture';
import { clearQueue, pendingCount } from '../queue';

const TOKEN = 'access-token';

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
