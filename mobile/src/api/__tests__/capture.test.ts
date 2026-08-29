/**
 * The two writes that close a capture (SRS §6.9, ADR 0003).
 *
 * Both have to choose, from a failed request alone, between "the network dropped" and "the
 * server said no". Getting that wrong is not a cosmetic bug in either direction: queue a
 * refusal and the capture sits on the waiting list for ever, claiming to need a network it
 * already has; drop a timeout and an insemination that happened is gone.
 */

import { attachPhoto, completeEvent } from '../capture';
import type { CaptureProgress } from '../capture';
import { clearQueue, pendingCount, readQueue } from '../queue';
import type { QueuedLabel } from '../queue';
import type { CapturedPhoto } from '@/features/aiFlow/CapturePhotoScreen';

/**
 * The photo goes out over `XMLHttpRequest` rather than `fetch`, for `upload.onprogress` — so
 * that is what these tests stand in for. The fake answers synchronously inside `send`, which
 * is enough: every assertion here is about what the caller does with an answer, not about when
 * it arrives.
 */
interface ProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

class FakeXhr {
  static answer: (request: FakeXhr) => void = request => request.succeed(200);
  static sent: FakeXhr[] = [];

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
    FakeXhr.answer(this);
  }

  /** Bytes on the wire, as the platform would report them. */
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }

  succeed(code: number, responseText = '') {
    this.status = code;
    this.responseText = responseText;
    this.onload?.();
  }

  fail() {
    this.onerror?.();
  }
}

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
  FakeXhr.sent = [];
  FakeXhr.answer = request => request.succeed(200);
  (global as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
});

afterEach(() => {
  jest.resetAllMocks();
  delete (global as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

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
    // The photo goes out over XHR, so this is the shape a lost network takes for it.
    FakeXhr.answer = request => request.fail();

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

describe('attaching the proof photo', () => {
  /**
   * The branch a Mait never sees and that decides whether their afternoon exists: a photo the
   * server refused must not go on the waiting list, and a photo the network lost must.
   *
   * These used to run against a mocked `fetch`. The send is an `XMLHttpRequest` now, for the
   * upload progress the button shows — so the same four answers are asserted against the same
   * four outcomes, one layer down.
   */
  it('sends it, and says so', async () => {
    const outcome = await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(outcome.sent).toBe(true);
    expect(await pendingCount()).toBe(0);
    expect(FakeXhr.sent[0]?.method).toBe('PATCH');
  });

  it('carries the capture uuid as the idempotency key', async () => {
    // Without it a resend is read as a second insemination against the same animal.
    await attachPhoto(7, 'uuid-abc', PHOTO, TOKEN, LABEL);

    expect(FakeXhr.sent[0]?.headers['Idempotency-Key']).toBe('uuid-abc');
    expect(FakeXhr.sent[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('does not queue a photo the server refused, and passes on its words', async () => {
    // A 4xx will be a 4xx on every retry. Queuing one puts the capture on the waiting list
    // permanently — a row a Mait can neither send nor be rid of.
    FakeXhr.answer = request =>
      request.succeed(422, JSON.stringify({ detail: 'This event already has a photo' }));

    const outcome = await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(outcome.sent).toBe(false);
    expect(outcome.queued).toBe(false);
    expect(outcome.problem).toBe('This event already has a photo');
    expect(await pendingCount()).toBe(0);
  });

  it('still queues when the server itself is broken', async () => {
    // A 500 is the server having a bad minute, not a refusal of this record.
    FakeXhr.answer = request => request.succeed(502);

    const outcome = await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(outcome.queued).toBe(true);
    expect(await pendingCount()).toBe(1);
  });

  it('queues a throttled request rather than dropping it', async () => {
    // 429 is the server asking for a minute, and it is the one 4xx that comes good on its own.
    FakeXhr.answer = request => request.succeed(429);

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(await pendingCount()).toBe(1);
  });

  it('queues it when the request never reaches a server', async () => {
    FakeXhr.answer = request => request.fail();

    const outcome = await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(outcome.queued).toBe(true);
    expect((await readQueue())[0]?.kind).toBe('attachPhoto');
  });

  it('queues it where the handset has no XMLHttpRequest at all', async () => {
    // Belt and braces. The send is wrapped for a reason: an insemination that happened must
    // never be lost to a platform that cannot make the request.
    delete (global as { XMLHttpRequest?: unknown }).XMLHttpRequest;

    const outcome = await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL);

    expect(outcome.queued).toBe(true);
    expect(await pendingCount()).toBe(1);
  });
});

describe('what the button is told while the photo goes out', () => {
  /**
   * The point of all of this: a Mait on one bar can tell a slow upload from a stalled app.
   * A spinner cannot make that distinction, and the one they reach for when they cannot is
   * the back button, half way through a capture.
   */
  it('reports zero before the first byte is counted', async () => {
    // `onprogress` does not fire until there is something to report, which on a slow link is
    // several seconds of a button that looks like it did nothing.
    const seen: CaptureProgress[] = [];

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL, p => seen.push(p));

    expect(seen[0]).toEqual({ stage: 'uploading', fraction: 0 });
  });

  it('reports the real fraction of the photo that has gone', async () => {
    const seen: CaptureProgress[] = [];
    FakeXhr.answer = request => {
      request.progress(256, 1024);
      request.progress(1024, 1024);
      request.succeed(200);
    };

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL, p => seen.push(p));

    expect(seen).toContainEqual({ stage: 'uploading', fraction: 0.25 });
    expect(seen).toContainEqual({ stage: 'uploading', fraction: 1 });
  });

  it('says the size is unknown rather than guessing one', async () => {
    // A handset that cannot say how big the body is gets an indeterminate bar. Filling one to
    // an invented percentage is how every other number in the app stops being believed.
    const seen: CaptureProgress[] = [];
    FakeXhr.answer = request => {
      request.progress(0, 0, false);
      request.succeed(200);
    };

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL, p => seen.push(p));

    expect(seen).toContainEqual({ stage: 'uploading', fraction: null });
  });

  it('says it is being saved for later when there is no signal', async () => {
    FakeXhr.answer = request => request.fail();
    const seen: CaptureProgress[] = [];

    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL, p => seen.push(p));

    expect(seen[seen.length - 1]).toEqual({ stage: 'queueing' });
  });

  it('says it is being saved for later when there is no session either', async () => {
    const seen: CaptureProgress[] = [];

    await attachPhoto(7, 'uuid-1', PHOTO, null, LABEL, p => seen.push(p));

    expect(seen).toEqual([{ stage: 'queueing' }]);
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it('counts the backlog that goes out behind it', async () => {
    // A successful write is where the queue gets its chance, and on a handset that has been
    // out of signal all morning that is the longer half of the wait — so it is counted, in
    // captures, rather than left as a pause after the bar has filled.
    (global.fetch as jest.Mock).mockImplementation(() => status(200));
    await attachPhoto(1, 'waiting-uuid', PHOTO, null, LABEL);
    expect(await pendingCount()).toBe(1);

    const seen: CaptureProgress[] = [];
    await attachPhoto(7, 'uuid-1', PHOTO, TOKEN, LABEL, p => seen.push(p));

    expect(seen).toContainEqual({ stage: 'catchingUp', done: 1, total: 1 });
  });
});
