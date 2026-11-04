/**
 * The offline pack — a Mait's whole working set, kept on the handset (SRS §6.9, ADR 0003).
 *
 * `offlineCache.ts` keeps the last answer to each read a screen happened to make. That is
 * enough to finish a round already begun and not enough to begin one: an MPP never opened with
 * signal was an empty list in the village, a search never typed with signal found nobody, and
 * a list stopped at fifty farmers. This keeps everything instead — the MPPs a Mait covers, every
 * member and non-member at them with their animals, and the breeds — downloaded whenever there
 * is signal and answered from the phone whether there is or not.
 *
 * **The phone answers first.** Steps 1–6 read from here before the network (`client.ts`), so a
 * picker opens at once on one bar as well as on none, and a search is a filter over what is on
 * the handset. The network's job is to keep this fresh: on sign-in, whenever the connection
 * returns, when the app comes to the front, every thirty minutes while it is open, and — at
 * most every couple of minutes — whenever a picker reads from it.
 *
 * **Only what changed.** The first download of an MPP is whole; every one after it sends
 * `since` and gets back only the farmers touched since, plus the list of who is still there,
 * so a farmer the office removed is removed here too. One MPP at a time, each written as it
 * lands, so a connection that drops mid-refresh costs the village it was on and no more.
 *
 * **What the Mait made here shows here at once.** A farmer or animal registered on this phone
 * goes straight into the pack — the server's row where there was signal, the provisional one
 * where there was not — so the next capture can pick her before she has reached the server. A
 * provisional row is kept through refreshes until the queue has her real id; after that the
 * server's copy, which the next refresh brings, replaces it.
 *
 * **Never an authority.** The server checks every write against its own records, so an animal
 * sold last week is refused at sync with a reason, not accepted because the phone had her.
 *
 * **One Mait's, on a shared handset.** Every file carries the owner's user id, a deliberate
 * sign-out deletes them, and nothing here answers for anybody else.
 */

import type { FetchArgs } from '@reduxjs/toolkit/query';

import { apiBaseUrl } from '@/config/env';

import { listPackFiles, readPackFile, removePackFile, writePackFile } from './packFiles';
import { serverIdFor } from './queue';
import type {
  Animal,
  BreedConfig,
  MemberDetail,
  MPP,
  NonMember,
  NonMemberDetail,
  NonMemberSummary,
} from './types';

// --------------------------------------------------------------------------------------
// Shapes
// --------------------------------------------------------------------------------------
type PackNonMember = NonMemberDetail & { relation_display?: string };

interface PackIndex {
  owner: number;
  serverTime: string;
  savedAt: number;
  mpps: MPP[];
  breeds: BreedConfig[];
  /**
   * This Mait's keys for the week ahead, one per day — for checking a farmer with no signal
   * against a code the office phoned her (`api/fieldCode`). Absent from a pack saved by an
   * older server.
   */
  fieldKeys?: FieldKey[];
  /** The number to ring for that code. Blank where the dairy has not set one. */
  officePhone?: string;
}

export interface FieldKey {
  /** The local day it is good for, `YYYY-MM-DD`. */
  day: string;
  /** Base64. */
  key: string;
}

interface MppPack {
  mppCode: string;
  serverTime: string;
  savedAt: number;
  members: Record<string, MemberDetail>;
  nonMembers: Record<string, PackNonMember>;
}

interface Loaded {
  owner: number;
  index: PackIndex | null;
  mpps: Map<string, MppPack>;
}

// --------------------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------------------
/** The index is a few rows; a refresh of one MPP is the farmers that changed. */
const SMALL_CAP_MS = 30_000;
/** A whole MPP the first time — hundreds of farmers, on a 2G link. */
const FULL_CAP_MS = 120_000;
/** How stale the pack may be before a picker reading it asks for a refresh in the background. */
const READ_REFRESH_AFTER_MS = 2 * 60_000;

// --------------------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------------------
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
let refreshing: Promise<RefreshResult> | null = null;

/** How the pack reaches the server — set by the navigator, which owns the session. */
export interface PackSync {
  accessToken: () => string | null;
  /** A fresh access token after a 401, or null when the session is over or unreachable. */
  reauth?: () => Promise<string | null>;
  online: () => boolean;
}
let sync: PackSync | null = null;

export function configurePackSync(next: PackSync | null): void {
  sync = next;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Told every time the pack changes, so the screens reading it can read it again. */
export function subscribePack(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  listeners.forEach(listener => listener());
}

const indexName = (owner: number) => `index-${owner}.json`;
const mppPrefix = (owner: number) => `mpp-${owner}-`;
const mppName = (owner: number, code: string) => `${mppPrefix(owner)}${code}.json`;

function parse<T>(text: string | null): T | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // Half a document is not a smaller one. Treated as absent; the next refresh rebuilds it.
    return null;
  }
}

// --------------------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------------------
/** The owner's pack, read off disk once and held in memory after. */
export async function loadPack(owner: number): Promise<Loaded> {
  if (loaded?.owner === owner) {
    return loaded;
  }
  if (loading) {
    const pending = await loading;
    if (pending.owner === owner) {
      return pending;
    }
  }
  loading = (async () => {
    const index = parse<PackIndex>(await readPackFile(indexName(owner)));
    const mpps = new Map<string, MppPack>();
    for (const name of await listPackFiles(mppPrefix(owner))) {
      const pack = parse<MppPack>(await readPackFile(name));
      if (pack) {
        mpps.set(pack.mppCode, pack);
      }
    }
    loaded = { owner, index: index?.owner === owner ? index : null, mpps };
    return loaded;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * What a farmer check with no signal needs: the key for `day`, and the office's number.
 *
 * Null key when the phone has none for that day — the pack was never downloaded, or not in the
 * last week — and the screen then says to find signal instead of offering a check it cannot do.
 */
export async function fieldCheckFor(
  owner: number,
  day: string,
): Promise<{ key: string | null; officePhone: string }> {
  const pack = await loadPack(owner);
  const key = pack.index?.fieldKeys?.find(entry => entry.day === day)?.key ?? null;
  return { key, officePhone: pack.index?.officePhone ?? '' };
}

/** When the pack last heard from the server, or null when it never has. */
export function packSavedAt(): number | null {
  return loaded?.index?.savedAt ?? null;
}

// --------------------------------------------------------------------------------------
// Answering reads
// --------------------------------------------------------------------------------------
function requestOf(args: string | FetchArgs): { path: string; params: Record<string, string> } {
  const url = typeof args === 'string' ? args : args.url;
  const [path = '', inline] = url.split('?');
  const params: Record<string, string> = {};
  inline?.split('&').forEach(pair => {
    const [name = '', value = ''] = pair.split('=');
    if (name) {
      params[name] = decodeURIComponent(value);
    }
  });
  if (typeof args !== 'string') {
    Object.entries(args.params ?? {}).forEach(([name, value]) => {
      if (value !== undefined && value !== null) {
        params[name] = String(value);
      }
    });
  }
  return { path, params };
}

/** The server's search, on the phone: every word must be found in one of the fields. */
function matches(search: string | undefined, fields: (string | null | undefined)[]): boolean {
  const terms = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const haystack = fields.map(field => (field ?? '').toLowerCase());
  return terms.every(term => haystack.some(field => field.includes(term)));
}

function page<T>(rows: T[], limit: string | undefined) {
  const cap = Number(limit) > 0 ? Number(limit) : rows.length;
  return { count: rows.length, next: null, previous: null, results: rows.slice(0, cap) };
}

const byText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

function summaryOf(farmer: PackNonMember): NonMemberSummary {
  const animals = farmer.animals ?? [];
  const lastAi = animals
    .map(animal => animal.last_ai_at)
    .filter((when): when is string => !!when)
    .sort()
    .pop();
  return {
    id: farmer.id,
    name: farmer.name,
    father_husband_name: farmer.father_husband_name,
    relation: farmer.relation,
    relation_display: farmer.relation_display ?? '',
    mobile_no: farmer.mobile_no,
    animal_count: animals.length,
    ai_event_count: animals.reduce((sum, animal) => sum + (animal.ai_event_count ?? 0), 0),
    last_ai_at: lastAi ?? null,
    created_at: farmer.created_at,
  };
}

/**
 * The answer to a read from the pack, or `undefined` when the pack cannot give it.
 *
 * Undefined is the common case for anything outside steps 1–6, and for an MPP whose farmers
 * have not been downloaded yet: the caller goes to the network exactly as it always did.
 */
export async function answerFromPack(
  owner: number,
  args: string | FetchArgs,
): Promise<unknown | undefined> {
  const method = typeof args === 'string' ? 'GET' : (args.method ?? 'GET');
  if (method.toUpperCase() !== 'GET') {
    return undefined;
  }
  const { path, params } = requestOf(args);
  const pack = await loadPack(owner);
  const answer = answer_(pack, path, params);
  if (answer !== undefined) {
    refreshIfStale();
  }
  return answer;
}

function answer_(pack: Loaded, path: string, params: Record<string, string>): unknown {
  if (path === '/mpp/' && pack.index) {
    const rows = pack.index.mpps.filter(mpp =>
      matches(params.search, [mpp.mpp_code, mpp.mpp_name]),
    );
    return page(rows, params.limit);
  }

  if (path === '/config/breeds/' && pack.index) {
    return pack.index.breeds
      .filter(breed => !params.animal_type || breed.animal_type === params.animal_type)
      .sort((a, b) => a.display_order - b.display_order);
  }

  if (path === '/members/' && params.mpp__mpp_code) {
    const mpp = pack.mpps.get(params.mpp__mpp_code);
    if (!mpp) {
      return undefined;
    }
    const rows = Object.values(mpp.members)
      .filter(member =>
        matches(params.search, [member.member_name, member.member_code, member.mobile_no]),
      )
      .sort((a, b) => byText(a.member_name, b.member_name));
    return page(rows, params.limit);
  }

  if (path === '/non-members/' && params.mpp__mpp_code) {
    const mpp = pack.mpps.get(params.mpp__mpp_code);
    if (!mpp) {
      return undefined;
    }
    const rows = Object.values(mpp.nonMembers)
      .filter(farmer =>
        matches(params.search, [farmer.name, farmer.mobile_no, farmer.father_husband_name]),
      )
      .sort((a, b) => byText(a.name, b.name))
      .map(summaryOf);
    return page(rows, params.limit);
  }

  const member = /^\/members\/([^/]+)\/$/.exec(path);
  if (member?.[1]) {
    const code = decodeURIComponent(member[1]);
    for (const mpp of pack.mpps.values()) {
      if (mpp.members[code]) {
        return mpp.members[code];
      }
    }
    return undefined;
  }

  const nonMember = /^\/non-members\/(-?\d+)\/$/.exec(path);
  if (nonMember?.[1]) {
    for (const mpp of pack.mpps.values()) {
      if (mpp.nonMembers[nonMember[1]]) {
        return mpp.nonMembers[nonMember[1]];
      }
    }
  }
  return undefined;
}

// --------------------------------------------------------------------------------------
// Refreshing
// --------------------------------------------------------------------------------------
export interface RefreshResult {
  ok: boolean;
  /** MPPs brought up to date this run. */
  refreshed: number;
  /** MPPs that could not be, and kept the copy they had. */
  failed: number;
}

async function get(path: string, capMs: number): Promise<Response> {
  const attempt = async (token: string | null) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), capMs);
    try {
      return await fetch(`${apiBaseUrl()}${path}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'ngrok-skip-browser-warning': 'true',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const response = await attempt(sync?.accessToken() ?? null);
  if (response.status === 401 && sync?.reauth) {
    const fresh = await sync.reauth();
    if (fresh) {
      return attempt(fresh);
    }
  }
  return response;
}

/** A provisional row the server has not given an id to yet — kept until it has. */
async function stillLocal(kind: 'nonMember' | 'animal', row: { id: number; client_uuid?: string }) {
  return row.id < 0 && !!row.client_uuid && (await serverIdFor(kind, row.client_uuid)) === null;
}

/** The server's farmer, with any animal registered on this phone and not yet sent kept on her. */
async function withLocalAnimals<T extends { animals?: Animal[] }>(
  before: T | undefined,
  fresh: T,
): Promise<T> {
  const local: Animal[] = [];
  const known = new Set((fresh.animals ?? []).map(animal => animal.id));
  for (const animal of before?.animals ?? []) {
    if (!known.has(animal.id) && (await stillLocal('animal', animal))) {
      local.push(animal);
    }
  }
  return local.length ? { ...fresh, animals: [...(fresh.animals ?? []), ...local] } : fresh;
}

async function refreshMpp(owner: number, pack: Loaded, code: string): Promise<boolean> {
  const before = pack.mpps.get(code);
  const query = before ? `?since=${encodeURIComponent(before.serverTime)}` : '';
  const response = await get(
    `/mait/offline-pack/${encodeURIComponent(code)}/${query}`,
    before ? SMALL_CAP_MS : FULL_CAP_MS,
  );
  if (!response.ok) {
    return false;
  }
  const body = (await response.json()) as {
    server_time: string;
    members: MemberDetail[];
    non_members: PackNonMember[];
    member_codes: string[];
    non_member_ids: number[];
  };
  if (
    !body ||
    !body.server_time ||
    ![body.members, body.non_members, body.member_codes, body.non_member_ids].every(Array.isArray)
  ) {
    return false;
  }

  const members: Record<string, MemberDetail> = {};
  const stillThere = new Set(body.member_codes);
  for (const [memberCode, member] of Object.entries(before?.members ?? {})) {
    if (stillThere.has(memberCode)) {
      members[memberCode] = member;
    }
  }
  for (const member of body.members) {
    members[member.member_code] = await withLocalAnimals(
      before?.members[member.member_code],
      member,
    );
  }

  const nonMembers: Record<string, PackNonMember> = {};
  const nonMemberIds = new Set(body.non_member_ids.map(String));
  for (const [id, farmer] of Object.entries(before?.nonMembers ?? {})) {
    if (nonMemberIds.has(id) || (await stillLocal('nonMember', farmer))) {
      nonMembers[id] = farmer;
    }
  }
  for (const farmer of body.non_members) {
    nonMembers[String(farmer.id)] = await withLocalAnimals(
      before?.nonMembers[String(farmer.id)],
      farmer,
    );
  }

  const next: MppPack = {
    mppCode: code,
    serverTime: body.server_time,
    savedAt: Date.now(),
    members,
    nonMembers,
  };
  await writePackFile(mppName(owner, code), JSON.stringify(next));
  pack.mpps.set(code, next);
  return true;
}

async function refreshOnce(owner: number): Promise<RefreshResult> {
  const pack = await loadPack(owner);
  let response: Response;
  try {
    response = await get('/mait/offline-pack/', SMALL_CAP_MS);
  } catch {
    return { ok: false, refreshed: 0, failed: 0 };
  }
  if (!response.ok) {
    return { ok: false, refreshed: 0, failed: 0 };
  }
  const body = (await response.json()) as {
    server_time: string;
    mpps: MPP[];
    breeds: BreedConfig[];
    field_keys?: FieldKey[];
    office_phone?: string;
  };
  // Anything else — a proxy's error page, an older server — is not a pack, and storing it
  // would replace a good copy with nothing.
  if (!body || !Array.isArray(body.mpps) || !Array.isArray(body.breeds) || !body.server_time) {
    return { ok: false, refreshed: 0, failed: 0 };
  }
  const index: PackIndex = {
    owner,
    serverTime: body.server_time,
    savedAt: Date.now(),
    mpps: body.mpps,
    breeds: body.breeds,
    // An answer without keys keeps the ones already here: they are still good for their days.
    fieldKeys: Array.isArray(body.field_keys) ? body.field_keys : pack.index?.fieldKeys,
    officePhone: body.office_phone ?? pack.index?.officePhone ?? '',
  };
  await writePackFile(indexName(owner), JSON.stringify(index));
  pack.index = index;
  announce();

  // A village the Mait no longer covers leaves the handset with the assignment.
  const covered = new Set(body.mpps.map(mpp => mpp.mpp_code));
  for (const code of [...pack.mpps.keys()]) {
    if (!covered.has(code)) {
      pack.mpps.delete(code);
      await removePackFile(mppName(owner, code));
    }
  }

  let refreshed = 0;
  let failed = 0;
  // One at a time, each written as it lands: a dropped connection costs one village.
  for (const mpp of body.mpps) {
    try {
      if (await refreshMpp(owner, pack, mpp.mpp_code)) {
        refreshed += 1;
        announce();
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { ok: failed === 0, refreshed, failed };
}

/**
 * Bring the pack up to date with the server. One run at a time; a second caller shares it.
 *
 * Never throws and never empties anything on failure — a refresh that cannot reach the server
 * leaves the phone exactly as able to work as it was.
 */
export function refreshPack(owner: number): Promise<RefreshResult> {
  if (!refreshing) {
    refreshing = refreshOnce(owner)
      .catch(() => ({ ok: false, refreshed: 0, failed: 0 }))
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function refreshIfStale(): void {
  const savedAt = loaded?.index?.savedAt ?? 0;
  if (!loaded || !sync?.online() || refreshing || Date.now() - savedAt < READ_REFRESH_AFTER_MS) {
    return;
  }
  refreshPack(loaded.owner);
}

// --------------------------------------------------------------------------------------
// What the Mait registered on this phone
// --------------------------------------------------------------------------------------
async function persist(owner: number, mpp: MppPack): Promise<void> {
  mpp.savedAt = Date.now();
  await writePackFile(mppName(owner, mpp.mppCode), JSON.stringify(mpp));
  announce();
}

/**
 * A farmer registered on this phone — the server's row, or the provisional one.
 *
 * Into the pack straight away, so she is on the roster for the next capture whether or not
 * her registration has reached the server.
 */
export async function rememberLocalNonMember(record: NonMember | NonMemberDetail): Promise<void> {
  const pack = loaded;
  const code = pack?.index?.mpps.find(mpp => mpp.id === record.mpp)?.mpp_code;
  const mpp = code ? pack?.mpps.get(code) : undefined;
  if (!pack || !mpp) {
    return;
  }
  const before = mpp.nonMembers[String(record.id)];
  mpp.nonMembers[String(record.id)] = {
    ...record,
    animals: 'animals' in record ? record.animals : (before?.animals ?? []),
    relation_display: before?.relation_display ?? '',
  };
  await persist(pack.owner, mpp);
}

/** An animal registered on this phone, put on her owner's record in the pack. */
export async function rememberLocalAnimal(
  animal: Animal,
  owner: { member_code?: string; non_member_id?: number },
): Promise<void> {
  const pack = loaded;
  if (!pack) {
    return;
  }
  for (const mpp of pack.mpps.values()) {
    // Replaced, never edited in place: the pack's rows are shared with whatever read them last.
    const place = (animals: Animal[] | undefined) => [
      ...(animals ?? []).filter(row => row.id !== animal.id),
      animal,
    ];
    if (owner.member_code && mpp.members[owner.member_code]) {
      const farmer = mpp.members[owner.member_code]!;
      mpp.members[owner.member_code] = { ...farmer, animals: place(farmer.animals) };
      await persist(pack.owner, mpp);
      return;
    }
    const key = owner.non_member_id !== undefined ? String(owner.non_member_id) : null;
    if (key && mpp.nonMembers[key]) {
      const farmer = mpp.nonMembers[key]!;
      mpp.nonMembers[key] = { ...farmer, animals: place(farmer.animals) };
      await persist(pack.owner, mpp);
      return;
    }
  }
}

/** Gone with a deliberate sign-out, like the queue and the read cache. */
export async function clearPack(owner: number): Promise<void> {
  await removePackFile(indexName(owner));
  for (const name of await listPackFiles(mppPrefix(owner))) {
    await removePackFile(name);
  }
  if (loaded?.owner === owner) {
    loaded = null;
  }
  announce();
}

/** Tests only: forget what is in memory, so the next read comes off "disk". */
export function resetPackMemory(): void {
  loaded = null;
  loading = null;
  refreshing = null;
}
