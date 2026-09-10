/**
 * The last good answer to a read, kept on the handset (SRS §6.9, ADR 0003).
 *
 * The queue in `queue.ts` is the write half of working with no signal, and it has always
 * worked. This is the read half, and it did not exist: every picker in the capture flow is an
 * RTK Query hook, RTK Query holds its cache in memory, and memory does not survive the app
 * being closed. A Mait who lost signal mid-round could finish the capture they were in; one
 * who closed the app in a village and reopened it there was shown an empty MPP list and could
 * not begin. The flow was offline-tolerant, not offline-capable.
 *
 * So every allowlisted GET writes its response here on the way past, and a GET that cannot
 * reach the server is answered from here instead. Nothing about the endpoints or the screens
 * changes: a hook that used to return `data` from the network returns the same `data` shape
 * from disk, and the loading and error states it already has are the ones that still apply
 * when there is no stored copy either.
 *
 * **Only what the flow cannot run without.** The allowlist is the MPPs a Mait covers, the
 * farmers at them, those farmers' animals, the breed catalogue and the Mait's own stock —
 * plus the two lists (events, checks) whose screens would otherwise read as a day's work
 * having vanished. Nothing organisational, nothing about other Maits, nothing the flow does
 * not open.
 *
 * The roster (`/non-members/roster/`) is on the list for a different reason from the rest: it
 * is not there so a screen can be drawn, it is there so the registration form can warn about a
 * farmer already on the books when there is no server to ask. It is a name and a number per
 * farmer and nothing else — see `FarmerRosterRowSerializer` for why it can never be more.
 *
 * **Stale is not wrong, and it is not hidden.** Nothing here is trusted as an authority: the
 * server validates every write against its own copy, so an animal sold last week is refused
 * at sync with a reason rather than accepted because the handset had it. What a stored answer
 * buys is a Mait who can work; `savedAt` says how old it is so a screen can say so.
 *
 * **Scoped to the Mait who fetched it, and gone when they sign out.** A field handset is
 * shared and handed around (`session.ts`). Every key carries the user id, so a roster fetched
 * by one Mait cannot be served to the next, and `clearCache` runs alongside `clearQueue` on
 * sign-out.
 *
 * AsyncStorage rather than SQLite, for the same reason `queue.ts` chose it: these are whole
 * JSON documents read and written whole, never queried, and a database would add a native
 * module and a migration story to a structure that has no need of either.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FetchArgs } from '@reduxjs/toolkit/query';

const PREFIX = 'maitai.cache.v1';
const INDEX_KEY = `${PREFIX}.index`;

/**
 * How many stored answers to keep, newest first.
 *
 * Members and their animals are cached per farmer, so the count grows with the size of a
 * Mait's round rather than being fixed. This is several times the largest round anybody
 * works and still small enough to stay well inside Android's per-app storage budget — past
 * it the oldest entries go, which is the right order: the villages walked longest ago are
 * the ones least likely to be walked next.
 */
const MAX_ENTRIES = 200;

/**
 * The largest body worth storing, in characters of JSON.
 *
 * A response bigger than this is a list nobody paginated, and writing it would push out
 * dozens of the small ones the flow actually needs. Skipped rather than truncated — half a
 * JSON document is not a smaller answer, it is a corrupt one.
 */
const MAX_ENTRY_CHARS = 256 * 1024;

/**
 * The reads the capture flow cannot run without, by path.
 *
 * An allowlist rather than "cache every GET": most of what the app reads is a screen that
 * can honestly say it needs a network — a payment's status, an indent's progress — and
 * storing those would spend the budget on answers that are wrong the moment they are stale.
 *
 * Anchored at both ends so a path is matched whole. `/members/` and `/members/{code}/` are
 * separate entries on purpose: the first is the picker, the second is the roster of animals
 * step 4 chooses from, and a Mait needs both in the same village.
 */
const CACHEABLE = [
  /^\/mpp\/$/,
  /^\/members\/$/,
  /^\/members\/[^/]+\/$/,
  /^\/non-members\/$/,
  /^\/non-members\/roster\/$/,
  /^\/non-members\/\d+\/$/,
  /^\/config\/breeds\/$/,
  /^\/inventory\/summary\/$/,
  /^\/ai-events\/$/,
  /^\/pregnancy-checks\/$/,
];

/** What one stored answer holds. `savedAt` is the device clock when the server answered. */
export interface CachedAnswer<T = unknown> {
  data: T;
  savedAt: number;
}

/**
 * The storage key for a request, or null when it is not one this module keeps.
 *
 * Built from the path and its query parameters with the parameters sorted, so the same read
 * asked twice hits the same entry however the object was spelled at the call site. Only GETs:
 * a write has a queue, and replaying a stored write is the one thing this must never do.
 */
export function cacheKeyFor(args: string | FetchArgs): string | null {
  const url = typeof args === 'string' ? args : args.url;
  const method = typeof args === 'string' ? 'GET' : (args.method ?? 'GET');
  if (method.toUpperCase() !== 'GET') {
    return null;
  }

  // Query strings written into the url directly, rather than passed as `params`.
  const [path = '', inlineQuery] = url.split('?');
  if (!CACHEABLE.some(pattern => pattern.test(path))) {
    return null;
  }

  const params = typeof args === 'string' ? undefined : args.params;
  const pairs: [string, string][] = [];
  if (inlineQuery) {
    inlineQuery.split('&').forEach(pair => {
      const [name = '', value = ''] = pair.split('=');
      if (name) {
        pairs.push([name, value]);
      }
    });
  }
  Object.entries(params ?? {}).forEach(([name, value]) => {
    if (value !== undefined && value !== null) {
      pairs.push([name, String(value)]);
    }
  });

  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const query = pairs.map(([name, value]) => `${name}=${value}`).join('&');
  return query ? `${path}?${query}` : path;
}

/** Where one Mait's copy of one read lives. */
function storageKey(owner: number, key: string): string {
  return `${PREFIX}:${owner}:${key}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // A corrupt index costs the cache, never the app. The entries it named are orphaned and
    // will be evicted with the rest of the store on sign-out.
    return [];
  }
}

/**
 * Record that an entry was just written, and evict what no longer fits.
 *
 * Newest first, so the cap falls on the villages walked longest ago. Failures here are
 * swallowed: a cache that cannot record its own bookkeeping must not fail the read it was
 * riding along with.
 */
async function touchIndex(full: string): Promise<void> {
  try {
    const index = [full, ...(await readIndex()).filter(entry => entry !== full)];
    const evicted = index.slice(MAX_ENTRIES);
    if (evicted.length) {
      await AsyncStorage.multiRemove(evicted);
    }
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index.slice(0, MAX_ENTRIES)));
  } catch {
    // See above.
  }
}

/**
 * Keep the server's answer.
 *
 * Never awaited by the request it belongs to — a read must not wait on a disk write to
 * return, and a write that fails costs a later fallback rather than this response.
 */
export async function writeCached(owner: number, key: string, data: unknown): Promise<void> {
  try {
    const body = JSON.stringify({ data, savedAt: Date.now() } satisfies CachedAnswer);
    if (body.length > MAX_ENTRY_CHARS) {
      return;
    }
    const full = storageKey(owner, key);
    await AsyncStorage.setItem(full, body);
    await touchIndex(full);
  } catch {
    // Storage full, or a value that will not serialise. Neither is a reason to fail a read
    // that has already succeeded.
  }
}

/** The stored answer to a read, or null where there is none. */
export async function readCached<T>(owner: number, key: string): Promise<CachedAnswer<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(owner, key));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedAnswer<T>;
    return parsed && 'data' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Drop everything, for a handset being handed to somebody else.
 *
 * Called from the session middleware on `loggedOut`, beside `clearQueue`. Sign-out is the
 * only thing that clears it: every other failure leaves the stored round in place, because
 * the whole point is that a Mait can work a village the app cannot reach the server from.
 */
export async function clearCache(): Promise<void> {
  try {
    const index = await readIndex();
    await AsyncStorage.multiRemove([...index, INDEX_KEY]);
  } catch {
    // Nothing to be done, and nothing that depends on it.
  }
}
