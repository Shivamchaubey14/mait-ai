/**
 * The three writes that must survive no signal (SRS §6.9).
 *
 * All three follow the same shape: try the network, and if anything at all goes wrong put the
 * job on the queue instead of showing the Mait an error. The insemination has already happened
 * by this point — refusing to record it because a village has no bars would be the app failing
 * at the one thing it exists to do.
 *
 * Everything carries the capture's `client_uuid`, so a job that in fact reached the server
 * before the connection dropped is recognised as a replay rather than repeated.
 *
 * **Opening the event is one of them now, and it was the gap that mattered.** The photo and
 * the completion have always queued; the create did not, and it is the first write in the
 * flow — so a Mait who reached step 5 with no signal was stopped there, at the moment the
 * straw was already drawn. The queue had a `createEvent` job kind the whole time and nothing
 * ever put one on it.
 *
 * A capture opened this way has no server id yet, so it carries a *provisional* one: a
 * negative number, minted here, that the network never sees. `sync.ts` swaps in the real id
 * the moment the create lands, and `isProvisional` is what every caller checks before it
 * tries to put an id in a URL.
 */

import type { CapturedPhoto } from '@/features/aiFlow/CapturePhotoScreen';
import { API_BASE_URL } from '@/config/env';

import { idempotencyHeaders, newClientUuid } from './client';
import { clockTime, enqueue, pendingCount, rememberEventId, rememberServerId } from './queue';
import type { QueuedLabel } from './queue';
import { drainQueue } from './sync';
import type {
  AadhaarImages,
  AIEvent,
  AIEventDraft,
  Animal,
  AnimalDraft,
  NonMember,
  NonMemberDraft,
  ProblemDetails,
} from './types';

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
  /**
   * The whole refusal, for a caller that has boxes to put it in.
   *
   * `problem` is the sentence; this is the RFC 7807 body it came out of, `errors` map and all
   * (SRS §9.11). A form that can show "that ear tag belongs to another animal" *under the tag
   * field* should, and `splitRejection` is what does it — but it needs the map, and a
   * sentence cannot be turned back into one.
   */
  problemBody?: ProblemDetails;
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
function problemDetail(body: string | null): { problem?: string; problemBody?: ProblemDetails } {
  try {
    const parsed = JSON.parse(body ?? '') as ProblemDetails;
    // The body is carried whole even when it has no `detail` — a validation failure often has
    // only an `errors` map, and that is the half a form can actually put somewhere.
    return parsed
      ? { ...(parsed.detail ? { problem: parsed.detail } : {}), problemBody: parsed }
      : {};
  } catch {
    return {};
  }
}

async function refusal(
  response: Response,
): Promise<{ problem?: string; problemBody?: ProblemDetails }> {
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
 * An id for a row the server has not made yet — a capture, or an animal.
 *
 * Negative, and that is the whole design: every real row id is positive, so one number tells
 * any caller whether this thing exists on the server. Nothing negative is ever put in a URL —
 * `attachPhoto`, `completeEvent` and the payment step all check `isProvisional` first and go
 * straight to the queue, where the job names the row by its `client_uuid` instead and the
 * drain fills in the real id once the create has landed.
 *
 * Counted down from the clock so two rows made in the same minute cannot collide, and so the
 * number is stable for as long as the flow holds it.
 */
export function provisionalId(): number {
  return -Date.now();
}

/** Whether this is a row the server has not seen. */
export function isProvisional(id: number): boolean {
  return id < 0;
}

export interface RegisteredFarmer extends CaptureOutcome {
  /**
   * The farmer the rest of the flow works with — the server's, or a provisional one.
   *
   * Null only where the server refused, which here is nearly always the Aadhaar belonging to
   * somebody already on file. That is a fact about who she is, not a network problem, and the
   * form shows it rather than queuing a registration that can never be accepted.
   */
  nonMember: NonMember | null;
}

/**
 * Register a farmer, or queue the registration and carry on with a provisional one.
 *
 * **This is the one queued write that can cost a farmer money, and the business has said yes
 * to it deliberately.** Everything else on the queue is a record of something that already
 * happened; this one is a record the office may still refuse — and by the time it does, the
 * Mait will have taken cash, because a non-member pays in the yard. The alternative was worse:
 * a Mait who meets an unregistered farmer in a village with no signal could not serve her at
 * all, and those are the villages where most of them are.
 *
 * Three things keep the risk small, and none of them is optional:
 *
 * 1. Her Aadhaar is checked live wherever there is any signal at all, before the money
 *    (`AddNonMemberScreen`), so the queued case is only ever the genuinely disconnected one.
 * 2. Her mobile number is checked against the roster on the handset even with no signal, which
 *    catches the common shape of this mistake — a farmer already on the collection point's
 *    books.
 * 3. A refusal is never silent. It lands on the waiting list in the server's own words, and
 *    everything queued behind her is marked with it, so the office learns of it that day
 *    rather than from a farmer's complaint months later.
 *
 * Her key is her own, not the capture's: she stays on the roster after this insemination is
 * closed, and a Mait who abandons the capture has still registered her.
 */
export async function registerNonMember(
  draft: Omit<NonMemberDraft, 'client_uuid'>,
  provisional: Omit<NonMember, 'id' | 'client_uuid'>,
  accessToken: string | null,
  /** Both faces of her card, which are queued as a job of their own. */
  card?: AadhaarImages | null,
  /** What the waiting list needs in order to name her row. */
  label?: QueuedLabel,
): Promise<RegisteredFarmer> {
  const clientUuid = newClientUuid();
  const body: NonMemberDraft = { ...draft, client_uuid: clientUuid };

  const queueCard = async (nonMemberId: number | null) => {
    if (card?.front && card?.back) {
      await enqueue('attachAadhaar', clientUuid, {
        nonMemberId,
        front: card.front,
        back: card.back,
      });
    }
  };

  const queueIt = async (): Promise<RegisteredFarmer> => {
    await enqueue('createNonMember', clientUuid, { ...body }, label);
    await queueCard(null);
    return {
      sent: false,
      queued: true,
      nonMember: {
        ...provisional,
        id: provisionalId(),
        client_uuid: clientUuid,
      } as NonMember,
      remaining: await pendingCount(),
    };
  };

  if (!accessToken) {
    return queueIt();
  }

  try {
    const response = await fetch(`${API_BASE_URL}/non-members/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...idempotencyHeaders(clientUuid),
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const nonMember = (await response.json()) as NonMember;
      await rememberServerId('nonMember', clientUuid, nonMember.id);
      await queueCard(nonMember.id);
      // The card is allowed to fail and must not hold the step: she is registered and the
      // flow needs her, not her photographs. Drained now so on a working connection it goes
      // immediately rather than waiting for the next tick.
      const drained = await drainQueue(accessToken);
      return { sent: true, queued: false, nonMember, remaining: drained.remaining };
    }

    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        nonMember: null,
        remaining: await pendingCount(),
        ...(await refusal(response)),
      };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  return queueIt();
}

export interface RegisteredAnimal extends CaptureOutcome {
  /**
   * The animal to carry into the rest of the step.
   *
   * The server's own where it could be reached, and a provisional one otherwise. Null only
   * where the server refused — an ear tag already registered to a different animal is the
   * commonest, and it is a fact about the yard that the Mait has to resolve rather than a
   * network problem to wait out.
   */
  animal: Animal | null;
}

/**
 * Register an animal, or queue the registration and carry on with a provisional one.
 *
 * A farmer whose cow is not on her roster yet is the ordinary case in a young deployment, not
 * an edge — and it happens in the same villages as everything else. This used to be a live
 * POST that simply failed there, which stopped the capture two steps before the straw.
 *
 * She gets her own `client_uuid`, not the capture's: she outlives it. She stays on the
 * farmer's roster after this insemination is closed, and a Mait who abandons the capture has
 * still registered the cow. It also means the server can recognise a replay of *her* — the
 * key is what stops one dropped response leaving the farmer with two identical rows.
 *
 * Her portrait follows on its own job and is allowed to fail exactly as it does online: the
 * flow needs the animal, not the photograph.
 */
export async function registerAnimal(
  draft: Omit<AnimalDraft, 'client_uuid'>,
  provisional: Omit<Animal, 'id' | 'client_uuid'>,
  accessToken: string | null,
  /** Her portrait, where the Mait took one. */
  photoUri?: string | null,
  /** Whose animal she is, so the waiting list can name the row rather than say "Capture". */
  ownerName?: string,
): Promise<RegisteredAnimal> {
  const clientUuid = newClientUuid();
  const body: AnimalDraft = { ...draft, client_uuid: clientUuid };

  const queueIt = async (): Promise<RegisteredAnimal> => {
    await enqueue(
      'createAnimal',
      clientUuid,
      { ...body },
      {
        farmer: ownerName ?? '',
        kind: body.member_code ? 'member' : 'nonMember',
        at: clockTime(),
        kindOfRow: 'animal',
      },
    );
    if (photoUri) {
      await enqueue('attachAnimalPhoto', clientUuid, { animalId: null, photoUri });
    }
    return {
      sent: false,
      queued: true,
      animal: { ...provisional, id: provisionalId(), client_uuid: clientUuid } as Animal,
      remaining: await pendingCount(),
    };
  };

  if (!accessToken) {
    return queueIt();
  }

  try {
    const response = await fetch(`${API_BASE_URL}/animals/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...idempotencyHeaders(clientUuid),
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const animal = (await response.json()) as Animal;
      await rememberServerId('animal', clientUuid, animal.id);
      if (photoUri) {
        // Queued rather than sent inline, and never blocking the step: it is the same bargain
        // the online path already struck — she is registered and the Mait can go on; her
        // portrait follows. Drained straight away, so on a working connection it goes now
        // rather than waiting for the next tick.
        await enqueue('attachAnimalPhoto', clientUuid, { animalId: animal.id, photoUri });
        const drained = await drainQueue(accessToken);
        return { sent: true, queued: false, animal, remaining: drained.remaining };
      }
      return { sent: true, queued: false, animal, remaining: await pendingCount() };
    }

    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        animal: null,
        remaining: await pendingCount(),
        ...(await refusal(response)),
      };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  return queueIt();
}

export interface CreatedEvent extends CaptureOutcome {
  /**
   * The event the rest of the flow works with.
   *
   * The server's own on a capture that reached it, and the provisional one otherwise. Null
   * only where the server refused — there is no capture to carry on with, and the screen says
   * why rather than moving on.
   */
  event: AIEvent | null;
}

/**
 * Open the capture, or queue it and carry on with a provisional one.
 *
 * This is the step that commits: the straw is drawn and the animal is served, and from here
 * the flow has something it must not lose. Refusing to go on because a village has no bars
 * would strand a Mait exactly where the work has already been done — so a create that cannot
 * reach the server goes on the queue and the flow continues against `provisional`.
 *
 * A refusal is different and is passed back as one. `insufficient-stock` means the flask
 * cannot cover the doses and no amount of signal will change that; queuing it would put a
 * capture on the waiting list that can never be sent. The screen shows the reason instead.
 */
export async function createEvent(
  draft: AIEventDraft,
  provisional: AIEvent,
  accessToken: string | null,
  /** As on the other two: what the waiting list needs in order to name this capture. */
  label?: QueuedLabel,
): Promise<CreatedEvent> {
  const queueIt = async (): Promise<CreatedEvent> => {
    await enqueue('createEvent', draft.client_uuid, { ...draft }, label);
    return { sent: false, queued: true, event: provisional, remaining: await pendingCount() };
  };

  if (!accessToken) {
    return queueIt();
  }

  try {
    const response = await fetch(`${API_BASE_URL}/ai-events/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...idempotencyHeaders(draft.client_uuid),
      },
      body: JSON.stringify(draft),
    });

    if (response.ok) {
      const event = (await response.json()) as AIEvent;
      // Remembered even on the path where nothing was queued: a completion that fails later
      // in this same capture queues a job naming this event, and the drain reads the id from
      // here rather than from a screen that may be long gone.
      await rememberEventId(draft.client_uuid, event.id);
      return { sent: true, queued: false, event, remaining: await pendingCount() };
    }

    // As on the photo and the completion: a 4xx is the server having considered this and said
    // no. It will say no again, so it is surfaced rather than queued.
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return {
        sent: false,
        queued: false,
        event: null,
        remaining: await pendingCount(),
        ...(await refusal(response)),
      };
    }
  } catch {
    // Network. Fall through to the queue.
  }

  return queueIt();
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

  // No token, or an event the server has never heard of. The second is not a failure to send
  // — there is nothing to send it *to* yet — so it goes straight to the queue, where the job
  // names the capture and the drain fills in the id the create comes back with. Queued with
  // `eventId` left out entirely rather than set to the negative placeholder: a job carrying a
  // number that means nothing on the server is a job somebody will one day send.
  if (!accessToken || isProvisional(eventId)) {
    onProgress?.({ stage: 'queueing' });
    await enqueue('attachPhoto', clientUuid, { ...payload, eventId: null }, label);
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

  // See `attachPhoto`: a capture the server has not made yet has no id to complete, so this
  // is queued against the capture and resolved when the create lands.
  if (!accessToken || isProvisional(eventId)) {
    await enqueue(
      'completeEvent',
      clientUuid,
      { eventId: isProvisional(eventId) ? null : eventId, closeWithoutStock: withoutStock },
      label,
    );
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
