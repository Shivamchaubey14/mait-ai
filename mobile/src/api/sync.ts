/**
 * Draining the offline queue (SRS §6.9, ADR 0003).
 *
 * Runs when the network comes back and after every write. Jobs go out in the order they were
 * queued, because order is meaningful inside one capture: a photo cannot attach to an event
 * the server has not created yet.
 *
 * Nothing is dropped on failure. A job is removed only once the server has answered — which
 * is safe precisely because every request carries the capture's `client_uuid` and the server
 * replies with the record that already exists rather than making another.
 *
 * Three rules are what make a day's work survive a bad afternoon:
 *
 * 1. **The capture is the unit, not the queue.** A failure stops that capture's own jobs,
 *    because they depend on each other, and nothing else. The drain used to `break` on the
 *    first failure — so one refused record held up every insemination queued behind it, and a
 *    Mait watching the count sit still had no way to know that nine of the ten were fine.
 * 2. **A refusal is not a retry.** A 4xx is the server having considered the request and said
 *    no; it will say no again next time. Those jobs are marked `failed`, stood aside, and
 *    shown to the Mait with the server's own words. They are never deleted — a rejected
 *    insemination is a record somebody has to deal with, not one to make disappear.
 * 3. **A capture with no server id waits for one.** An event opened with no signal is queued
 *    before it exists anywhere, so its photo and its completion name nothing. The create
 *    returns the id, `rememberEventId` stores it, and everything behind it is filled in from
 *    there — including across a restart, because it is on disk rather than in this function.
 */

import { API_BASE_URL } from '@/config/env';
import {
  blockDependentsOf,
  eventIdFor,
  expiredJobs,
  isDue,
  LocalRefKind,
  QueuedJob,
  readQueue,
  recordFailure,
  rememberServerId,
  removeJob,
  serverIdFor,
} from './queue';

export interface SyncResult {
  sent: number;
  remaining: number;
  /** Jobs past the server's idempotency window. These need a human, not another retry. */
  expired: number;
  /**
   * Jobs the server refused.
   *
   * Counted apart from `remaining` because they are a different kind of waiting: the rest are
   * waiting on a network, and these are waiting on a person.
   */
  failed: number;
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

/**
 * The server's own words for a refusal, or the fallback.
 *
 * Worth reading the body for: this string is what the waiting list shows a Mait, and "Rejected
 * with 400" tells them to try again while "Kavita Devi is already a member at Barsana MPP"
 * tells them what to ring the office about.
 */
async function refusalDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body?.detail || fallback;
  } catch {
    return fallback;
  }
}

/** A 4xx other than 409 means the request is wrong and will be wrong every time. */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

/**
 * The event this job is for, or null while its capture has no id yet.
 *
 * A job queued online carries the id on its payload. One queued before the event existed
 * carries nothing, and the answer comes from what the create wrote down — which may have been
 * written by an entirely different run of the app.
 */
async function resolveEventId(job: QueuedJob): Promise<number | null> {
  const onJob = job.payload.eventId;
  if (typeof onJob === 'number' && onJob > 0) {
    return onJob;
  }
  return eventIdFor(job.clientUuid);
}

/**
 * Thrown when a job needs its capture's event id and there is not one yet.
 *
 * Not an error and not a failure: the create is ahead of this job in the queue and has not
 * gone through. The right answer is to leave the whole capture alone until it has, and to
 * count nothing against the job for waiting.
 */
class AwaitingEventId extends Error {}

/**
 * The capture's payload with a provisional animal turned into a real one.
 *
 * A *negative* `animal_id` is the handset's own placeholder for a cow registered in the same
 * yard a moment earlier — her create is ahead of this one in the queue, keyed by her own uuid,
 * and until it lands there is no number to send. Sending the placeholder would open the
 * capture against an animal that does not exist.
 *
 * Every other payload passes through untouched, which includes one with no `animal_id` on it
 * at all: this resolves a placeholder, it does not decide whether the field is required. That
 * is the serializer's job, and a job queued by an older build must reach it to be told so.
 */
/**
 * One provisional id on a capture's payload, turned into a real one.
 *
 * A *negative* id is the handset's own placeholder for something registered in the same yard
 * minutes earlier — a cow, or the farmer herself. Its create is ahead of this job in the
 * queue, keyed by its own uuid, and until that lands there is no number to send. Sending the
 * placeholder would open the capture against a row that does not exist.
 *
 * Anything else passes through untouched, which includes a payload with no such field at all:
 * this resolves a placeholder, it does not decide whether the field is required. That is the
 * serializer's job, and a job queued by an older build has to reach it to be told so.
 */
async function resolveOne(
  body: Record<string, unknown>,
  idField: string,
  refField: string,
  kind: LocalRefKind,
): Promise<Record<string, unknown>> {
  const current = body[idField];
  if (typeof current !== 'number' || current > 0) {
    return body;
  }

  const ref = body[refField];
  const real = typeof ref === 'string' ? await serverIdFor(kind, ref) : null;
  if (real === null) {
    throw new AwaitingEventId();
  }

  // The ref is handset bookkeeping and means nothing on the server, so it is dropped here
  // rather than sent and ignored.
  const next: Record<string, unknown> = { ...body, [idField]: real };
  delete next[refField];
  return next;
}

/**
 * The capture's payload with everything the handset made up replaced by what the server gave.
 *
 * Both can be provisional at once, and routinely are: a Mait meets a farmer who is on nobody's
 * roster, registers her, registers her cow, and inseminates it — three rows the server has
 * never seen, in one yard, with no signal.
 */
async function withResolvedRefs(job: QueuedJob): Promise<Record<string, unknown>> {
  const withFarmer = await resolveOne(
    job.payload,
    'non_member_id',
    'non_member_client_uuid',
    'nonMember',
  );
  return resolveOne(withFarmer, 'animal_id', 'animal_client_uuid', 'animal');
}

async function send(job: QueuedJob, accessToken: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Idempotency-Key': job.clientUuid,
    // Without it ngrok's free tier answers with an HTML interstitial, which arrives as a
    // parse failure and reads as a server fault. Same note as on `idempotencyHeaders`.
    'ngrok-skip-browser-warning': 'true',
  };

  /**
   * A farmer registered in the yard, ahead of everything that names her.
   *
   * Under her own key, so a replay after a dropped response comes back as the farmer who
   * already exists rather than a second one who can be asked for cash again.
   */
  if (job.kind === 'createNonMember') {
    return fetch(`${API_BASE_URL}/non-members/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(job.payload),
    });
  }

  if (job.kind === 'attachAadhaar') {
    const nonMemberId =
      typeof job.payload.nonMemberId === 'number' && job.payload.nonMemberId > 0
        ? job.payload.nonMemberId
        : await serverIdFor('nonMember', job.clientUuid);
    if (nonMemberId === null) {
      throw new AwaitingEventId();
    }
    const card = new FormData();
    card.append('aadhar_front', {
      uri: job.payload.front as string,
      name: 'aadhaar-front.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
    card.append('aadhar_back', {
      uri: job.payload.back as string,
      name: 'aadhaar-back.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
    return fetch(`${API_BASE_URL}/non-members/${nonMemberId}/aadhaar/`, {
      method: 'PATCH',
      headers,
      body: card,
    });
  }

  /**
   * An animal registered in the yard before the capture that needs her.
   *
   * Keyed by her own uuid rather than the capture's, so a replay after a dropped response is
   * recognised as one and the farmer is not left with two identical cows on her roster. Ahead
   * of the capture in the queue, because the capture cannot name her until this has landed.
   */
  if (job.kind === 'createAnimal') {
    return fetch(`${API_BASE_URL}/animals/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(job.payload),
    });
  }

  if (job.kind === 'attachAnimalPhoto') {
    const animalId =
      typeof job.payload.animalId === 'number' && job.payload.animalId > 0
        ? job.payload.animalId
        : await serverIdFor('animal', job.clientUuid);
    if (animalId === null) {
      throw new AwaitingEventId();
    }
    const portrait = new FormData();
    portrait.append('photo', {
      uri: job.payload.photoUri as string,
      name: 'animal.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
    return fetch(`${API_BASE_URL}/animals/${animalId}/photo/`, {
      method: 'PATCH',
      headers,
      body: portrait,
    });
  }

  /**
   * Opening the capture, for a Mait who reached step 5 with no signal.
   *
   * The one everything else in the capture waits on: the response carries the event id the
   * photo and the completion need. A repeat comes back as the event that already exists
   * rather than a second insemination — which is what the `client_uuid` in the body and the
   * key in the header are both for.
   */
  if (job.kind === 'createEvent') {
    return fetch(`${API_BASE_URL}/ai-events/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(await withResolvedRefs(job)),
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
    const eventId = await resolveEventId(job);
    if (eventId === null) {
      throw new AwaitingEventId();
    }
    return fetch(`${API_BASE_URL}/payments/${eventId}/initiate/`, {
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
        // Absent on a job queued by a build that had no remark box, and on every check where
        // the Mait wrote nothing.
        ...(job.payload.note ? { note: job.payload.note } : {}),
      }),
    });
  }

  if (job.kind === 'completeEvent') {
    const eventId = await resolveEventId(job);
    if (eventId === null) {
      throw new AwaitingEventId();
    }
    return fetch(`${API_BASE_URL}/ai-events/${eventId}/complete/`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // Defaulted false for a job queued by an older build, and for every ordinary capture:
      // only a close-off may ask to skip the stock movement.
      body: JSON.stringify({ close_without_stock: job.payload.closeWithoutStock === true }),
    });
  }

  const eventId = await resolveEventId(job);
  if (eventId === null) {
    throw new AwaitingEventId();
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

  return fetch(`${API_BASE_URL}/ai-events/${eventId}/photo/`, {
    method: 'PATCH',
    headers,
    body: form,
  });
}

/**
 * Keep the id a create came back with — an event's, or an animal's.
 *
 * Read off the response body rather than guessed. A create that replayed — the server had it
 * already and answered `200` with the existing event — carries the same id the first attempt
 * would have, which is exactly why this is safe to run on every success.
 */
const CREATES: Partial<Record<QueuedJob['kind'], LocalRefKind>> = {
  createEvent: 'event',
  createAnimal: 'animal',
  createNonMember: 'nonMember',
};

async function rememberCreated(job: QueuedJob, response: Response): Promise<void> {
  const kind = CREATES[job.kind];
  if (!kind) {
    return;
  }
  try {
    const body = (await response.json()) as { id?: number };
    if (typeof body?.id === 'number') {
      await rememberServerId(kind, job.clientUuid, body.id);
    }
  } catch {
    // An unreadable body on a 2xx. The create landed, so the event exists; the next drain
    // sends the create again, the server replays it, and the id arrives then.
  }
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
    return {
      sent: 0,
      remaining: jobs.length,
      expired: 0,
      failed: jobs.filter(job => job.failed).length,
    };
  }

  const stale = await expiredJobs();
  const jobs = await readQueue();
  const now = Date.now();
  let sent = 0;

  const isStale = (job: QueuedJob) => stale.some(expired => expired.id === job.id);

  /**
   * The captures this drain will actually attempt, in queue order.
   *
   * Left out: jobs past the idempotency window, jobs the server has already refused, and jobs
   * still inside the backoff their last failure set. Counting any of them would promise a
   * total the drain has no intention of reaching, and this line is read by somebody deciding
   * whether it is worth standing still a moment longer.
   */
  const captures: string[] = [];
  jobs.forEach(job => {
    if (!isStale(job) && isDue(job, now) && !captures.includes(job.clientUuid)) {
      captures.push(job.clientUuid);
    }
  });

  /**
   * Captures whose earlier job did not go through.
   *
   * The rest of that capture is skipped — a photo cannot attach to an event that was refused,
   * and a completion cannot deduct a straw for a capture that was never opened — while every
   * other capture in the queue carries on regardless.
   */
  const stopped = new Set<string>();

  for (const job of jobs) {
    // Past the idempotency window a resend would be read as a new request, so it is left in
    // place and reported instead.
    if (isStale(job) || !isDue(job, now) || stopped.has(job.clientUuid)) {
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
        await rememberCreated(job, response);
        await removeJob(job.id);
        sent += 1;
        continue;
      }

      if (isPermanent(response.status)) {
        // Retrying forever would hide it, and would hold up everything queued behind it. It
        // is marked, stood aside, and shown to the Mait with the server's own reason.
        const reason = await refusalDetail(response, `Rejected with ${response.status}`);
        await recordFailure(job.id, reason, {
          permanent: true,
          status: response.status,
        });

        // And so is everything that was waiting on it. A capture whose farmer the office
        // refused would otherwise sit on the waiting list saying *Waiting* forever —
        // truthfully, and uselessly, because what it waits for is never coming. A Mait
        // reading one red row would take the rest of the list to be fine.
        const created = CREATES[job.kind];
        if (created && created !== 'event') {
          await blockDependentsOf(created, job.clientUuid, reason);
        }

        stopped.add(job.clientUuid);
        continue;
      }

      await recordFailure(job.id, `Server returned ${response.status}`);
      stopped.add(job.clientUuid);
    } catch (error) {
      if (error instanceof AwaitingEventId) {
        // Its create has not gone through yet. Nothing is wrong and nothing is counted
        // against the job — the rest of this capture simply waits for the id.
        stopped.add(job.clientUuid);
        continue;
      }
      await recordFailure(job.id, String(error));
      // Almost certainly the network, so the rest of this capture will fail the same way.
      // Every other capture is still tried: on a connection that comes and goes, one that
      // fails now and one that succeeds a second later are both ordinary.
      stopped.add(job.clientUuid);
    }
  }

  // Nothing in flight any more, whether the drain emptied the queue or stopped at a failure.
  // Said explicitly so the screen clears its "Syncing" row rather than leaving one marked as
  // in-flight until the next drain happens to start.
  onProgress?.({ done: captures.length, total: captures.length, clientUuid: null });

  const left = await readQueue();
  return {
    sent,
    remaining: left.length,
    expired: stale.length,
    failed: left.filter(job => job.failed).length,
  };
}
