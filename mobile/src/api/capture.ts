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
import { drainQueue } from './sync';

export interface CaptureOutcome {
  /** True when the server took it now; false when it is queued on the handset. */
  sent: boolean;
  remaining: number;
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
): Promise<CaptureOutcome> {
  const payload = {
    eventId,
    photoUri: photo.uri,
    gpsLat: photo.gpsLat,
    gpsLng: photo.gpsLng,
    performedAt: photo.performedAt,
  };

  if (!accessToken) {
    await enqueue('attachPhoto', clientUuid, payload);
    return { sent: false, remaining: await pendingCount() };
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
      return { sent: true, remaining: result.remaining };
    }

    // 4xx means the server refuses this photo and will refuse it again. Queuing it would
    // retry forever; it is surfaced instead.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return { sent: false, remaining: await pendingCount() };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  await enqueue('attachPhoto', clientUuid, payload);
  return { sent: false, remaining: await pendingCount() };
}

/** Ask the server to complete the event, or queue the request. */
export async function completeEvent(
  eventId: number,
  clientUuid: string,
  accessToken: string | null,
): Promise<CaptureOutcome> {
  if (!accessToken) {
    await enqueue('completeEvent', clientUuid, { eventId });
    return { sent: false, remaining: await pendingCount() };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/ai-events/${eventId}/complete/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': clientUuid,
      },
    });

    if (response.ok) {
      const result = await drainQueue(accessToken);
      return { sent: true, remaining: result.remaining };
    }
  } catch {
    // Network. Queue it.
  }

  await enqueue('completeEvent', clientUuid, { eventId });
  return { sent: false, remaining: await pendingCount() };
}
