/**
 * The offline queue (SRS §6.9, ADR 0003).
 *
 * A Mait works where there is no signal. The flow must finish on the handset and reach the
 * server later, so every write that matters is written here first and drained when the
 * network returns.
 *
 * Two rules make that safe, and both live on the server side of the contract:
 *
 * 1. Every job carries the capture's `client_uuid`, minted once when the flow starts. The
 *    server returns the event that already exists rather than creating a second one, so a
 *    blind resend is a no-op instead of a duplicate insemination.
 * 2. Nothing is removed from the queue until the server has answered. A job whose response
 *    was lost is sent again — which is exactly the case rule 1 exists for.
 *
 * Stored in AsyncStorage rather than SQLite. The queue is a short list of small JSON objects
 * that is read whole and written whole; a database would add a native module and a migration
 * story for a structure that never needs a query.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { IDEMPOTENCY_TTL_HOURS } from '@/config/env';
import type { PdOutcome } from './types';

const STORAGE_KEY = 'maitai.queue.v1';

/**
 * Where a row's server-side id is remembered once the server has made one.
 *
 * Everything created with no signal is created twice over: once on the handset, where it gets
 * a local key, and later on the server, which gives it a real row id. Between the two, every
 * job that names that row has to name it by the local key — the photo has no event to attach
 * to, the capture has no animal to be for — and this is where the translation lives.
 *
 * Kept in storage rather than in the drain's own memory, because the two halves are routinely
 * sent by different runs of the app: the create goes out on a ridge with one bar, the handset
 * goes back in a pocket, and the photo follows an hour later from a different launch.
 *
 * Two kinds of row need it, so the key carries which: a capture's event, and an animal
 * registered in the yard before the flow could name her.
 */
const SERVER_IDS_KEY = 'maitai.queue.serverIds.v1';

/** What a remembered id belongs to. */
export type LocalRefKind = 'event' | 'animal' | 'nonMember';

/**
 * How long to wait before trying a job again, from how many times it has already failed.
 *
 * Doubling from ten seconds to a ten-minute ceiling, plus or minus a fifth. The jitter is
 * what stops a depot full of handsets that all lost the same tower from coming back in step
 * and arriving as one spike — they queue the same jobs at the same moment and would
 * otherwise retry on the same schedule for the rest of the day.
 *
 * This is a floor on retries, not a timer. The drain is driven by the connection returning
 * and by the Mait pulling to refresh; what the floor prevents is a handset with a live
 * connection and a sick server hammering it between those events.
 */
export function backoffMs(attempts: number): number {
  const base = Math.min(10_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** What the job asks the server to do. One per write in the capture flow. */
export type QueuedKind =
  /**
   * A farmer registered in the yard, ahead of everything that names her.
   *
   * Under her own local key, like the animal below and for the same reason: she outlives the
   * capture. She is on the collection point's roster from now on, and a Mait who abandons the
   * insemination has still registered her.
   */
  | 'createNonMember'
  /** Both faces of her Aadhaar card, which is the evidence behind the number that was typed. */
  | 'attachAadhaar'
  /**
   * An animal registered in the yard, ahead of the capture that needs her.
   *
   * Queued under her own local key rather than the capture's, because she outlives it: she
   * stays on the farmer's roster after this insemination is closed, and a Mait who abandons
   * the capture has still registered the cow.
   */
  | 'createAnimal'
  /** Her portrait, which is how a Mait recognises her on the next visit. */
  | 'attachAnimalPhoto'
  | 'createEvent'
  | 'attachPhoto'
  | 'completeEvent'
  | 'verifyPayment'
  /** A pregnancy check recorded in a yard with no signal — the ordinary case, not the edge. */
  | 'recordPd';

/**
 * Enough of the capture to name it on a screen the Mait comes back to.
 *
 * Held on the job rather than fetched: the whole point of a queue is that the server cannot be
 * reached, so a list that had to ask the server who these people were would be blank exactly
 * when it is needed.
 */

/**
 * The device clock, as the waiting list prints it — "09:20".
 *
 * Lives here rather than in whichever screen needed it first, because the only thing it ever
 * fills is `QueuedLabel.at` and two screens now queue jobs of their own. The device's clock
 * rather than the server's on purpose: it is the time the Mait was standing in the yard, which
 * is what they are looking for on that list, and the server may not hear about it for hours.
 */
export function clockTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export interface QueuedLabel {
  /** Whose insemination it was. */
  farmer: string;
  kind: 'member' | 'nonMember';
  /** What was collected, where anything was. Members hand over nothing. */
  amount?: string | null;
  mode?: 'COD' | 'ONLINE';
  /** The device clock when the capture happened — "9:20" on the row. */
  at: string;
  /** The event this job belongs to, for the screens that need to reopen it. */
  eventId?: number;
  /**
   * A pregnancy check waiting to send, and what the visit produced.
   *
   * `PdOutcome` rather than the union spelled out again: a refusal queues like any other
   * answer — an owner is at least as likely to decline in a yard with no signal as anywhere
   * else — and a second copy of the list is a second place to forget to add to.
   */
  checkId?: number;
  outcome?: PdOutcome;
  /**
   * What this row *is*, where it is not an insemination.
   *
   * The waiting list draws one row per queued thing and names it after the farmer. That reads
   * correctly for a capture and misleadingly for anything else: a Mait scanning the list for
   * the insemination they are afraid they lost should not have to work out that the row
   * bearing the same farmer's name is her registration. Absent means a capture, which is what
   * every job queued before this field existed was.
   */
  kindOfRow?: 'registration' | 'animal';
}

export interface QueuedJob {
  /** Unique per job. The capture's uuid is in `clientUuid`, and several jobs share it. */
  id: string;
  kind: QueuedKind;
  /** The capture this job belongs to — the idempotency key the server dedupes on. */
  clientUuid: string;
  /** Request body, or the photo's local file URI for an upload. */
  payload: Record<string, unknown>;
  /** Milliseconds since epoch, so a stale job can be recognised. */
  queuedAt: number;
  attempts: number;
  lastError?: string;
  label?: QueuedLabel;

  /**
   * The device clock when this job was last put on the wire.
   *
   * Every field below is optional, and every reader treats its absence as "never tried".
   * Jobs written by an earlier build are already sitting on handsets in the field, and this
   * build reads them unchanged — a queue that needed migrating would be a queue that could
   * be lost in the migrating, which is the one outcome none of this may risk.
   */
  lastAttemptAt?: number;
  /** Not before this. Set from `backoffMs` on every failure; absent means "now". */
  nextAttemptAt?: number;
  /**
   * The server considered this and refused it, and will refuse it again.
   *
   * Kept rather than deleted, and stood aside rather than retried. A rejected job is a record
   * a Mait has to be told about — an animal sold since the round was planned, a straw already
   * spent — and deleting it would make a day's work disappear with no account of where it
   * went. `lastError` carries the server's own words.
   */
  failed?: boolean;
  /** The status the refusal came back with, for the row that has to explain it. */
  failedStatus?: number;
}

function newJobId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function readQueue(): Promise<QueuedJob[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedJob[]) : [];
  } catch {
    // A corrupt queue is worse than an empty one: it would fail on every drain forever.
    return [];
  }
}

async function writeQueue(jobs: QueuedJob[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

/**
 * Add a job, in order.
 *
 * Order matters within one capture — a photo cannot attach to an event the server has not
 * created — so the queue is a list rather than a set, and draining stops at the first
 * failure rather than skipping ahead.
 */
export async function enqueue(
  kind: QueuedKind,
  clientUuid: string,
  payload: Record<string, unknown>,
  label?: QueuedLabel,
): Promise<QueuedJob> {
  const job: QueuedJob = {
    id: newJobId(),
    kind,
    clientUuid,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
    ...(label ? { label } : {}),
  };
  const jobs = await readQueue();
  jobs.push(job);
  await writeQueue(jobs);
  return job;
}

export async function removeJob(id: string): Promise<void> {
  const jobs = await readQueue();
  await writeQueue(jobs.filter(job => job.id !== id));
}

/**
 * Note that a job did not go through, and when it may be tried again.
 *
 * `permanent` is the difference between a village with no signal and a server that has
 * considered the request and said no. The first is retried forever, because the network
 * always comes back; the second is marked and stood aside, because no number of retries will
 * change the answer and every one of them delays the captures behind it.
 */
export async function recordFailure(
  id: string,
  message: string,
  { permanent = false, status }: { permanent?: boolean; status?: number } = {},
): Promise<void> {
  const jobs = await readQueue();
  await writeQueue(
    jobs.map(job => {
      if (job.id !== id) {
        return job;
      }
      const attempts = job.attempts + 1;
      return {
        ...job,
        attempts,
        lastError: message,
        lastAttemptAt: Date.now(),
        nextAttemptAt: Date.now() + backoffMs(attempts),
        ...(permanent ? { failed: true, ...(status ? { failedStatus: status } : {}) } : {}),
      };
    }),
  );
}

/** Whether a job is due — never tried, or past the backoff its last failure set. */
export function isDue(job: QueuedJob, now: number = Date.now()): boolean {
  return !job.failed && (job.nextAttemptAt ?? 0) <= now;
}

/**
 * Put a refused job back in the queue for another try.
 *
 * The one way out of `failed`, and it takes a person: the Mait taps *Try again* on the row
 * once the office has fixed whatever the server objected to. Nothing does this on its own —
 * a refusal that un-refused itself would be back to retrying forever.
 */
export async function retryFailed(id: string): Promise<void> {
  const jobs = await readQueue();
  await writeQueue(
    jobs.map(job =>
      job.id === id ? { ...job, failed: false, failedStatus: undefined, nextAttemptAt: 0 } : job,
    ),
  );
}

/**
 * Remember the id the server gave a row, so the jobs behind it can name it.
 *
 * Written the moment a create comes back — including a create that came back as a replay of
 * one the server already had, which is the case this exists for.
 */
export async function rememberServerId(kind: LocalRefKind, ref: string, id: number): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SERVER_IDS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[`${kind}:${ref}`] = id;
    await AsyncStorage.setItem(SERVER_IDS_KEY, JSON.stringify(map));
  } catch {
    // The id is lost and the jobs behind it stay queued until a later drain re-sends the
    // create, which replays and returns the same id. Slower, never wrong.
  }
}

/** The server's id for a row, or null while it has none. */
export async function serverIdFor(kind: LocalRefKind, ref: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(SERVER_IDS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return map[`${kind}:${ref}`] ?? null;
  } catch {
    return null;
  }
}

/** The event id for a capture, by its `client_uuid`. The commonest use of the map above. */
export async function eventIdFor(clientUuid: string): Promise<number | null> {
  return serverIdFor('event', clientUuid);
}

/** Keep the event id a capture's create came back with. */
export async function rememberEventId(clientUuid: string, eventId: number): Promise<void> {
  await rememberServerId('event', clientUuid, eventId);
}

/** Jobs the server has refused. These need a person, and the waiting list shows them. */
export async function failedJobs(): Promise<QueuedJob[]> {
  return (await readQueue()).filter(job => job.failed);
}

/**
 * Mark everything that was waiting on a registration the server refused.
 *
 * Without this a capture whose farmer or whose animal was rejected sits on the waiting list
 * saying *Waiting* forever — truthfully, in that it is waiting, and uselessly, in that what it
 * waits for is never coming. A Mait reading the list would see one red row and assume the rest
 * were fine.
 *
 * The reason is carried across rather than restated, because the reason is the server's and it
 * is the same one: the farmer this capture is for is a farmer the office would not accept.
 */
export async function blockDependentsOf(
  kind: LocalRefKind,
  ref: string,
  reason: string,
): Promise<void> {
  const payloadKey = kind === 'animal' ? 'animal_client_uuid' : 'non_member_client_uuid';
  const jobs = await readQueue();
  await writeQueue(
    jobs.map(job =>
      job.payload[payloadKey] === ref && !job.failed
        ? { ...job, failed: true, lastError: reason }
        : job,
    ),
  );
}

/**
 * Jobs whose idempotency key the server will no longer recognise.
 *
 * After the TTL a resend would be treated as a fresh request rather than a replay, which is
 * how one insemination becomes two records. Past that point the safe answer is to stop
 * sending and surface it to a human, never to try anyway.
 */
export async function expiredJobs(): Promise<QueuedJob[]> {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000;
  return (await readQueue()).filter(job => job.queuedAt < cutoff);
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Only for tests and a signed-out device — never as a way to clear a failing job.
 *
 * Called from the session persistence middleware on `loggedOut`, so the queue leaves with the
 * Mait it belongs to. A job that will not send needs a person to look at it, not a wipe.
 */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_KEY, SERVER_IDS_KEY]);
}
