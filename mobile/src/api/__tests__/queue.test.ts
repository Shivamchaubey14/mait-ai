/**
 * Offline queue and drain (SRS §6.9, ADR 0003).
 *
 * These are the tests that matter most in the app. A Mait finishes a round with no signal, and
 * the two ways this can go wrong are both unrecoverable: losing an insemination that happened,
 * or recording one twice and taking a second straw for it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQueue, enqueue, expiredJobs, pendingCount, readQueue, recordFailure } from '../queue';
import { drainQueue } from '../sync';

const TOKEN = 'access-token';

beforeEach(async () => {
  await clearQueue();
  global.fetch = jest.fn() as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

function ok() {
  return Promise.resolve({ ok: true, status: 200 } as Response);
}

function status(code: number) {
  return Promise.resolve({ ok: false, status: code } as Response);
}

describe('the queue', () => {
  it('keeps jobs in the order they were captured', async () => {
    // Order is meaningful within one capture: a photo cannot attach to an event the server
    // has not created yet.
    await enqueue('createEvent', 'uuid-1', { a: 1 });
    await enqueue('attachPhoto', 'uuid-1', { b: 2 });

    const jobs = await readQueue();
    expect(jobs.map(job => job.kind)).toEqual(['createEvent', 'attachPhoto']);
  });

  it('survives a corrupt store rather than failing every drain forever', async () => {
    await AsyncStorage.setItem('maitai.queue.v1', 'not json');
    expect(await readQueue()).toEqual([]);
  });

  it('counts what is still waiting', async () => {
    await enqueue('completeEvent', 'uuid-1', { eventId: 1 });
    await enqueue('completeEvent', 'uuid-2', { eventId: 2 });
    expect(await pendingCount()).toBe(2);
  });

  it('flags jobs the server will no longer recognise as replays', async () => {
    // Past the 24h idempotency window a resend is read as a fresh request, which is how one
    // insemination becomes two records.
    await enqueue('completeEvent', 'uuid-old', { eventId: 1 });
    const raw = JSON.parse((await AsyncStorage.getItem('maitai.queue.v1')) as string);
    raw[0].queuedAt = Date.now() - 25 * 60 * 60 * 1000;
    await AsyncStorage.setItem('maitai.queue.v1', JSON.stringify(raw));

    expect(await expiredJobs()).toHaveLength(1);
  });

  it('records why a job failed without dropping it', async () => {
    const job = await enqueue('completeEvent', 'uuid-1', { eventId: 1 });
    await recordFailure(job.id, 'Server returned 502');

    const stored = (await readQueue())[0];
    expect(stored?.attempts).toBe(1);
    expect(stored?.lastError).toContain('502');
    expect(await pendingCount()).toBe(1);
  });
});

describe('draining', () => {
  it('sends every queued job and empties the queue', async () => {
    (global.fetch as jest.Mock).mockImplementation(ok);
    await enqueue('createEvent', 'uuid-1', { mpp_code: '001371' });
    await enqueue('completeEvent', 'uuid-1', { eventId: 7 });

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(0);
  });

  it('carries the capture uuid as the idempotency key', async () => {
    // The whole guarantee rests on this header. Without it a resend is a new insemination.
    (global.fetch as jest.Mock).mockImplementation(ok);
    await enqueue('completeEvent', 'uuid-abc', { eventId: 7 });

    await drainQueue(TOKEN);

    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call[1].headers['Idempotency-Key']).toBe('uuid-abc');
  });

  it('keeps a job when the network drops mid-drain', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    await enqueue('completeEvent', 'uuid-1', { eventId: 1 });

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(1);
  });

  it('stops at the first failure rather than sending later jobs out of order', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => status(502)).mockImplementation(ok);

    await enqueue('createEvent', 'uuid-1', {});
    await enqueue('attachPhoto', 'uuid-1', { eventId: 1, photoUri: 'file:///proof.jpg' });

    const result = await drainQueue(TOKEN);

    // A photo sent before its event exists would be rejected and lost.
    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(2);
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('keeps a rejected job visible instead of retrying it forever', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => status(400));
    await enqueue('completeEvent', 'uuid-1', { eventId: 1 });

    const result = await drainQueue(TOKEN);

    expect(result.remaining).toBe(1);
    expect((await readQueue())[0]?.lastError).toContain('400');
  });

  it('does not send anything without a session', async () => {
    await enqueue('completeEvent', 'uuid-1', { eventId: 1 });

    const result = await drainQueue(null);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
  });

  it('leaves an expired job alone rather than sending it as a new request', async () => {
    (global.fetch as jest.Mock).mockImplementation(ok);
    await enqueue('completeEvent', 'uuid-old', { eventId: 1 });
    const raw = JSON.parse((await AsyncStorage.getItem('maitai.queue.v1')) as string);
    raw[0].queuedAt = Date.now() - 25 * 60 * 60 * 1000;
    await AsyncStorage.setItem('maitai.queue.v1', JSON.stringify(raw));

    const result = await drainQueue(TOKEN);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.expired).toBe(1);
    expect(result.remaining).toBe(1);
  });
});
