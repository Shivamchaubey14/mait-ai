/**
 * The two writes that must survive no signal (SRS §6.9).
 *
 * Both follow the same shape: try the network, and if anything at all goes wrong put the job
 * on the queue instead of showing the Mait an error. The insemination has already happened by
 * this point — refusing to record it because a village has no bars would be the app failing at
 * the one thing it exists to do.
 *
 * Everything carries the capture's `client_uuid`, so a job that in fact reached the server
 * before the connection dropped is recognised as a replay rather than repeated.
 */

import type { CapturedPhoto } from '@/features/aiFlow/CapturePhotoScreen';
import { API_BASE_URL } from '@/config/env';

import { enqueue, pendingCount } from './queue';
import type { QueuedLabel } from './queue';
import { drainQueue } from './sync';

export interface CaptureOutcome {
  /** True when the server took it now. */
  sent: boolean;
  /**
   * True when it went onto the queue instead, because there was no network.
   *
   * `sent: false, queued: false` is the third outcome and the one that used to be
   * indistinguishable from the second: the server was reached and it *refused*. Nothing is
   * waiting, no retry will help, and a caller that reads the pair as "it will go later" tells
   * a Mait their work is safe when it is nowhere at all.
   */
  queued: boolean;
  /** The server's own words when it refused. Only ever set on a refusal. */
  problem?: string;
  remaining: number;
}

/**
 * Why the server said no, in its own words.
 *
 * Every refusal here is RFC 7807 (SRS §9.11), and `detail` is written to be read by the person
 * holding the phone — "This breed has no rate set for this kind of farmer" tells a Mait what to
 * do; "could not save" tells them to tap again. Absent or unreadable, the caller falls back to
 * its own sentence rather than showing an empty one.
 */
async function refusal(response: Response): Promise<{ problem?: string }> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body?.detail ? { problem: body.detail } : {};
  } catch {
    return {};
  }
}

/**
 * Attach the proof photo, or queue it.
 *
 * The photo stays where the camera wrote it and only its URI is queued — holding image bytes
 * in AsyncStorage would put several megabytes of base64 into a store meant for small values.
 */
export async function attachPhoto(
  eventId: number,
  clientUuid: string,
  photo: CapturedPhoto,
  accessToken: string | null,
  /**
   * Who this capture was for, written onto the job so the waiting list can name it.
   *
   * Optional only because the queue tolerates its absence — pass it. A job queued without one
   * shows up on the waiting list as the word "Capture" and nothing else, which is the one
   * thing that screen must never say to a Mait looking for a record they are afraid they lost.
   */
  label?: QueuedLabel,
): Promise<CaptureOutcome> {
  const payload = {
    eventId,
    photoUri: photo.uri,
    gpsLat: photo.gpsLat,
    gpsLng: photo.gpsLng,
    performedAt: photo.performedAt,
    // Carried through the queue as well as the live send. A photo chosen from the gallery
    // that syncs three hours later must still arrive marked as chosen — the one thing the
    // server cannot work out for itself.
    source: photo.source,
    gpsSource: photo.gpsSource,
  };

  if (!accessToken) {
    await enqueue('attachPhoto', clientUuid, payload, label);
    return { sent: false, queued: true, remaining: await pendingCount() };
  }

  const form = new FormData();
  form.append('photo', {
    uri: photo.uri,
    name: 'proof.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  if (photo.gpsLat != null) {
    form.append('gps_lat', String(photo.gpsLat));
    form.append('gps_lng', String(photo.gpsLng));
  }
  form.append('performed_at', photo.performedAt);
  form.append('photo_source', photo.source);
  form.append('gps_source', photo.gpsSource);

  try {
    const response = await fetch(`${API_BASE_URL}/ai-events/${eventId}/photo/`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': clientUuid,
      },
      body: form,
    });

    if (response.ok) {
      // A successful write is the best signal there is that the network is back, so this is
      // where the backlog gets its chance.
      const result = await drainQueue(accessToken);
      return { sent: true, queued: false, remaining: result.remaining };
    }

    // 4xx means the server refuses this photo and will refuse it again. Queuing it would
    // retry forever; it is surfaced instead.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        remaining: await pendingCount(),
        ...(await refusal(response)),
      };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  await enqueue('attachPhoto', clientUuid, payload, label);
  return { sent: false, queued: true, remaining: await pendingCount() };
}

/**
 * Ask the server to complete the event, or queue the request.
 *
 * `withoutStock` is only ever set by *Close this off* — the button offered on a record whose
 * straw has already left the Mait's holding. The insemination happened and that straw is
 * spent; deducting a different one would charge the flask twice for one animal, so the server
 * is told it may close this without a stock movement. It is a permission rather than an
 * instruction: a straw still in stock is deducted exactly as always.
 *
 * The ordinary completion at the end of a capture never sends it, and must not — a completion
 * that shrugged at a missing straw is how one straw comes to serve two animals.
 */
export async function completeEvent(
  eventId: number,
  clientUuid: string,
  accessToken: string | null,
  /** As on `attachPhoto`: what the waiting list needs to name this record. */
  label?: QueuedLabel,
  { withoutStock = false }: { withoutStock?: boolean } = {},
): Promise<CaptureOutcome> {
  const body = { close_without_stock: withoutStock };

  if (!accessToken) {
    await enqueue('completeEvent', clientUuid, { eventId, closeWithoutStock: withoutStock }, label);
    return { sent: false, queued: true, remaining: await pendingCount() };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/ai-events/${eventId}/complete/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': clientUuid,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const result = await drainQueue(accessToken);
      return { sent: true, queued: false, remaining: result.remaining };
    }

    // As on the photo: a 4xx is a refusal, not a dropped connection, and it will be refused
    // again on every retry. Queuing one put the capture on the waiting list for good — it sat
    // there claiming to need a network it already had, and no amount of signal could clear it.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        remaining: await pendingCount(),
        ...(await refusal(response)),
      };
    }
  } catch {
    // Network. Queue it.
  }

  await enqueue('completeEvent', clientUuid, { eventId, closeWithoutStock: withoutStock }, label);
  return { sent: false, queued: true, remaining: await pendingCount() };
}
