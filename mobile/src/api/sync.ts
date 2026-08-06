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

  if (job.kind === 'completeEvent') {
    return fetch(`${API_BASE_URL}/ai-events/${job.payload.eventId}/complete/`, {
      method: 'POST',
      headers,
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
export async function drainQueue(accessToken: string | null): Promise<SyncResult> {
  if (!accessToken) {
    const jobs = await readQueue();
    return { sent: 0, remaining: jobs.length, expired: 0 };
  }

  const stale = await expiredJobs();
  const jobs = await readQueue();
  let sent = 0;

  for (const job of jobs) {
    // Past the idempotency window a resend would be read as a new request, so it is left in
    // place and reported instead.
    if (stale.some(expired => expired.id === job.id)) {
      continue;
    }

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

  const left = await readQueue();
  return { sent, remaining: left.length, expired: stale.length };
}
