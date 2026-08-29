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
function problemDetail(body: string | null): { problem?: string } {
  try {
    const parsed = JSON.parse(body ?? '') as { detail?: string };
    return parsed?.detail ? { problem: parsed.detail } : {};
  } catch {
    return {};
  }
}

async function refusal(response: Response): Promise<{ problem?: string }> {
  try {
    return problemDetail(await response.text());
  } catch {
    return {};
  }
}

/**
 * How far the work behind the Continue button has got.
 *
 * Two phases, reported separately rather than blended into one number. Sending the photograph
 * is measured in bytes and catching up is measured in captures, and there is no honest
 * exchange rate between them — weighting the two to make a single bar move smoothly would be
 * inventing a figure the handset never measured. So the bar restarts and relabels itself
 * instead, which is also what a Mait wants to know: whether it is still the photo.
 */
export type CaptureProgress =
  /** Bytes on their way to the server. `fraction` is null where the handset cannot count them. */
  | { stage: 'uploading'; fraction: number | null }
  /** No network. Being written to the queue, which takes no measurable time. */
  | { stage: 'queueing' }
  /** The backlog going out behind this capture — the `2` and the `3` in "Sending 2 of 3". */
  | { stage: 'catchingUp'; done: number; total: number };

/**
 * The photo PATCH, as an upload this screen can watch.
 *
 * `fetch` is the transport everywhere else in this module and stays so. It is used here
 * through `XMLHttpRequest` — the same network stack one layer down, which is what React
 * Native implements `fetch` on top of — for one reason: `upload.onprogress`. A Mait standing
 * in a yard with one bar needs to know whether the photo is moving or the handset has stalled,
 * and a spinner cannot tell them apart.
 *
 * Rejects only where `fetch` would: the request never reached a server. Every answer,
 * including a refusal, resolves — the caller decides what a status means.
 */
function putPhoto(
  url: string,
  accessToken: string,
  clientUuid: string,
  form: FormData,
  onProgress?: (fraction: number | null) => void,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PATCH', url);
    request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    request.setRequestHeader('Idempotency-Key', clientUuid);

    // Absent on an implementation that does not support it, which is not a reason to fail the
    // send — it is a reason to say the size is unknown and carry on.
    if (request.upload) {
      request.upload.onprogress = event => {
        onProgress?.(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
      };
    } else {
      onProgress?.(null);
    }

    request.onload = () => resolve({ status: request.status, body: request.responseText });
    request.onerror = () => reject(new Error('Network request failed'));
    request.ontimeout = () => reject(new Error('Upload timed out'));
    request.onabort = () => reject(new Error('Upload aborted'));

    request.send(form);
  });
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
  /**
   * How far the send has got, for the button the Mait is watching.
   *
   * Optional: the queue drains on reconnect with no screen open, and the sync worker passes
   * nothing.
   */
  onProgress?: (progress: CaptureProgress) => void,
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
    onProgress?.({ stage: 'queueing' });
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

  // Said before the first byte moves. `onprogress` does not fire until the handset has
  // something to report, and on a slow link that is several seconds of a button that looks
  // like it did nothing.
  onProgress?.({ stage: 'uploading', fraction: 0 });

  try {
    const response = await putPhoto(
      `${API_BASE_URL}/ai-events/${eventId}/photo/`,
      accessToken,
      clientUuid,
      form,
      fraction => onProgress?.({ stage: 'uploading', fraction }),
    );

    if (response.status >= 200 && response.status < 300) {
      // A successful write is the best signal there is that the network is back, so this is
      // where the backlog gets its chance.
      const result = await drainQueue(accessToken, sync =>
        onProgress?.({ stage: 'catchingUp', done: sync.done, total: sync.total }),
      );
      return { sent: true, queued: false, remaining: result.remaining };
    }

    // 4xx means the server refuses this photo and will refuse it again. Queuing it would
    // retry forever; it is surfaced instead.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        remaining: await pendingCount(),
        ...problemDetail(response.body),
      };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  onProgress?.({ stage: 'queueing' });
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
