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

/** What the job asks the server to do. One per write in the capture flow. */
export type QueuedKind =
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

export async function recordFailure(id: string, message: string): Promise<void> {
  const jobs = await readQueue();
  await writeQueue(
    jobs.map(job =>
      job.id === id ? { ...job, attempts: job.attempts + 1, lastError: message } : job,
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
  await AsyncStorage.removeItem(STORAGE_KEY);
}
