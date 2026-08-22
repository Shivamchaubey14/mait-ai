/**
 * Draining the offline queue (SRS §6.9, ADR 0003).
 *
 * Runs when the network comes back and after every write. Jobs go out in the order they were
 * queued and the drain stops at the first failure, because order is meaningful inside one
 * capture: a photo cannot attach to an event the server has not created yet.
 *
 * Nothing is dropped on failure. A job is removed only once the server has answered — which
 * is safe precisely because every request carries the capture's `client_uuid` and the server
 * replies with the record that already exists rather than making another.
 */

import { API_BASE_URL } from '@/config/env';
import { expiredJobs, QueuedJob, readQueue, recordFailure, removeJob } from './queue';

export interface SyncResult {
  sent: number;
  remaining: number;
  /** Jobs past the server's idempotency window. These need a human, not another retry. */
  expired: number;
}

/**
 * How far a drain has got, counted in captures rather than in jobs.
 *
 * A Mait thinks in inseminations, and the waiting list draws one row per capture — so a
 * progress line counting the three or four jobs behind each row would run to a total nobody
 * on the screen can see, and would move four times while one row sat there.
 */
export interface SyncProgress {
  /** Which capture is being sent, 1-based — the `2` in "Sending 2 of 3". */
  done: number;
  total: number;
  /** The capture in flight, so the list can mark that row and only that row. */
  clientUuid: string | null;
}

/** A 4xx other than 409 means the request is wrong and will be wrong every time. */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

async function send(job: QueuedJob, accessToken: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Idempotency-Key': job.clientUuid,
  };

  if (job.kind === 'createEvent') {
    return fetch(`${API_BASE_URL}/ai-events/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(job.payload),
    });
  }

  /**
   * A payment recorded in a village, with the farmer's code still to be checked.
   *
   * It is queued rather than dropped because the cash is already in the Mait's hand: the
   * event exists and the money moved, and the only thing missing is her confirmation. Sent
   * on its own so a code typed later needs no second trip through the capture.
   */
  if (job.kind === 'verifyPayment') {
    return fetch(`${API_BASE_URL}/payments/${job.payload.eventId}/initiate/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: job.payload.mode }),
    });
  }

  /**
   * What the Mait found on a pregnancy check.
   *
   * Queued rather than dropped for the same reason a payment is: the visit *happened*. She
   * was examined, the answer is known, and the only thing missing is a network. Sent on its
   * own so a result found in a village needs no second trip to the yard.
   */
  if (job.kind === 'recordPd') {
    return fetch(`${API_BASE_URL}/pregnancy-checks/${job.payload.checkId}/record/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outcome: job.payload.outcome,
        client_uuid: job.clientUuid,
        ...(job.payload.photoUrl ? { photo_url: job.payload.photoUrl } : {}),
      }),
    });
  }

  if (job.kind === 'completeEvent') {
    return fetch(`${API_BASE_URL}/ai-events/${job.payload.eventId}/complete/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // Defaulted false for a job queued by an older build, and for every ordinary capture:
      // only a close-off may ask to skip the stock movement.
      body: JSON.stringify({ close_without_stock: job.payload.closeWithoutStock === true }),
    });
  }

  // The photo is still a local file URI on the handset; multipart is built at send time so
  // the queue never holds image bytes.
  const form = new FormData();
  form.append('photo', {
    uri: job.payload.photoUri as string,
    name: 'proof.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  form.append('gps_lat', String(job.payload.gpsLat));
  form.append('gps_lng', String(job.payload.gpsLng));
  form.append('performed_at', String(job.payload.performedAt));
  // Defaulted for a job queued by an older build of the app, where the only way to get a
  // photo was to take one.
  form.append('photo_source', String(job.payload.source ?? 'camera'));
  form.append('gps_source', String(job.payload.gpsSource ?? 'device'));

  return fetch(`${API_BASE_URL}/ai-events/${job.payload.eventId}/photo/`, {
    method: 'PATCH',
    headers,
    body: form,
  });
}

/**
 * Send everything queued, oldest first.
 *
 * Returns rather than throws: a failed drain is the normal state of a phone in a village,
 * and the caller shows a count, not an error.
 */
export async function drainQueue(
  accessToken: string | null,
  /**
   * Called before each capture goes out, and once more with nothing in flight when the drain
   * stops. Optional: the queue drains on reconnect with no screen watching.
   */
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  if (!accessToken) {
    const jobs = await readQueue();
    return { sent: 0, remaining: jobs.length, expired: 0 };
  }

  const stale = await expiredJobs();
  const jobs = await readQueue();
  let sent = 0;

  // The captures this drain will actually attempt, in queue order. Expired jobs are left out
  // because they are never sent, and counting them would promise a total the drain will not
  // reach.
  const captures: string[] = [];
  jobs.forEach(job => {
    if (!stale.some(expired => expired.id === job.id) && !captures.includes(job.clientUuid)) {
      captures.push(job.clientUuid);
    }
  });

  for (const job of jobs) {
    // Past the idempotency window a resend would be read as a new request, so it is left in
    // place and reported instead.
    if (stale.some(expired => expired.id === job.id)) {
      continue;
    }

    onProgress?.({
      done: captures.indexOf(job.clientUuid) + 1,
      total: captures.length,
      clientUuid: job.clientUuid,
    });

    try {
      const response = await send(job, accessToken);

      if (response.ok) {
        await removeJob(job.id);
        sent += 1;
        continue;
      }

      if (isPermanent(response.status)) {
        // Retrying forever would hide it. It stays queued and visible so somebody looks.
        await recordFailure(job.id, `Rejected with ${response.status}`);
        break;
      }

      await recordFailure(job.id, `Server returned ${response.status}`);
      break;
    } catch (error) {
      await recordFailure(job.id, String(error));
      break; // Almost certainly the network. Stop; the next reconnect tries again.
    }
  }

  // Nothing in flight any more, whether the drain emptied the queue or stopped at a failure.
  // Said explicitly so the screen clears its "Syncing" row rather than leaving one marked as
  // in-flight until the next drain happens to start.
  onProgress?.({ done: captures.length, total: captures.length, clientUuid: null });

  const left = await readQueue();
  return { sent, remaining: left.length, expired: stale.length };
}
