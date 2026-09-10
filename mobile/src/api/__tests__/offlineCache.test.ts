/**
 * The read half of working with no signal (`api/offlineCache`).
 *
 * The queue has always let a Mait *finish* a capture offline. What none of it did was let one
 * *begin*: every picker in the flow is an RTK Query hook, RTK Query's cache is in memory, and
 * an app reopened in a village had nothing at all. These are the cases that decide whether a
 * round can start.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { cacheKeyFor, clearCache, readCached, writeCached } from '../offlineCache';

const MAIT = 42;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('what is worth keeping', () => {
  it('keeps the reads the capture flow cannot run without', () => {
    // The whole round: which collection points, which farmers, which animals, which breeds,
    // and what is in the flask.
    expect(cacheKeyFor('/mpp/')).toBe('/mpp/');
    expect(cacheKeyFor('/members/0906167700010001/')).toBe('/members/0906167700010001/');
    expect(cacheKeyFor('/non-members/7/')).toBe('/non-members/7/');
    expect(cacheKeyFor('/config/breeds/')).toBe('/config/breeds/');
    expect(cacheKeyFor('/inventory/summary/')).toBe('/inventory/summary/');
  });

  it('keeps nothing else', () => {
    // A payment's state and an indent's progress are answers that are wrong the moment they
    // are stale, and storing them would spend the budget on rows nobody can act on offline.
    expect(cacheKeyFor('/payments/7/')).toBeNull();
    expect(cacheKeyFor('/indents/')).toBeNull();
    expect(cacheKeyFor('/auth/me/')).toBeNull();
  });

  it('never keeps a write', () => {
    // The one thing this must not become. Writes have a queue, and replaying a stored write
    // is how one insemination becomes two.
    expect(cacheKeyFor({ url: '/ai-events/', method: 'POST', body: {} })).toBeNull();
    expect(cacheKeyFor({ url: '/non-members/', method: 'POST', body: {} })).toBeNull();
  });

  it('matches a path whole, never as a prefix', () => {
    // `/members/` is the picker and `/members/{code}/` is the roster; a pattern loose enough
    // to catch a third thing would cache whatever the API grows next without anybody deciding.
    expect(cacheKeyFor('/members/0906167700010001/animals/')).toBeNull();
    expect(cacheKeyFor('/mpp/1/reassign/')).toBeNull();
  });
});

describe('the key a request gets', () => {
  it('is the same however the parameters were spelled', () => {
    // The picker is called from two places with the same filter written two ways round. One
    // village must not occupy two entries, and must not miss its own stored copy.
    const a = cacheKeyFor({ url: '/members/', params: { limit: 50, mpp__mpp_code: '001303' } });
    const b = cacheKeyFor({ url: '/members/', params: { mpp__mpp_code: '001303', limit: 50 } });
    expect(a).toBe(b);
  });

  it('tells two villages apart', () => {
    const a = cacheKeyFor({ url: '/members/', params: { mpp__mpp_code: '001303' } });
    const b = cacheKeyFor({ url: '/members/', params: { mpp__mpp_code: '001371' } });
    expect(a).not.toBe(b);
  });

  it('reads a query string written into the url as well as one passed as params', () => {
    expect(cacheKeyFor('/members/?mpp__mpp_code=001303')).toBe(
      cacheKeyFor({ url: '/members/', params: { mpp__mpp_code: '001303' } }),
    );
  });
});

describe('storing and serving an answer', () => {
  it('gives back what the server said', async () => {
    await writeCached(MAIT, '/mpp/', { results: [{ mpp_code: '001303' }] });

    const stored = await readCached<{ results: { mpp_code: string }[] }>(MAIT, '/mpp/');
    expect(stored?.data.results[0]?.mpp_code).toBe('001303');
  });

  it('says when it was stored, so a screen can say how old it is', async () => {
    await writeCached(MAIT, '/mpp/', { results: [] });
    const stored = await readCached(MAIT, '/mpp/');
    expect(stored?.savedAt).toBeGreaterThan(0);
  });

  it('has nothing to say about a read it was never given', async () => {
    expect(await readCached(MAIT, '/config/breeds/')).toBeNull();
  });

  it('never serves one Mait the farmers another one fetched', async () => {
    // A field handset is shared and handed around. This is the whole reason the key carries a
    // user id rather than being the path alone.
    await writeCached(MAIT, '/members/', { results: [{ member_code: 'A' }] });

    expect(await readCached(99, '/members/')).toBeNull();
  });

  it('is emptied when the handset is signed out of', async () => {
    await writeCached(MAIT, '/mpp/', { results: [] });
    await writeCached(MAIT, '/config/breeds/', []);

    await clearCache();

    expect(await readCached(MAIT, '/mpp/')).toBeNull();
    expect(await readCached(MAIT, '/config/breeds/')).toBeNull();
  });

  it('survives a corrupt entry rather than failing the read it was helping', async () => {
    await AsyncStorage.setItem(`maitai.cache.v1:${MAIT}:/mpp/`, 'not json');
    expect(await readCached(MAIT, '/mpp/')).toBeNull();
  });

  it('refuses a body too large to be worth the room', async () => {
    // A response this size is a list nobody paginated, and keeping it would push out dozens
    // of the small answers the flow actually needs.
    await writeCached(MAIT, '/members/', { blob: 'x'.repeat(300 * 1024) });
    expect(await readCached(MAIT, '/members/')).toBeNull();
  });
});
