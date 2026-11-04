/**
 * The offline pack (SRS §6.9) — a Mait's working set, kept on the phone.
 *
 * The cases that matter are the ones a Mait meets in a village: an MPP never opened with signal
 * still lists its farmers, a search never typed with signal still finds her, a farmer the office
 * removed goes, a farmer registered on this phone with no signal stays through a refresh until
 * the server has her, and a refresh that gets garbage back leaves the phone as able to work as
 * it was.
 */

import { loggedIn } from '@/features/auth/authSlice';
import { jsonResponse, makeStore } from '@/test-utils';
import { maitaiApi } from '@api/endpoints';
import type { Animal, MemberDetail, MPP } from '@api/types';

import {
  answerFromPack,
  clearPack,
  configurePackSync,
  fieldCheckFor,
  refreshPack,
  rememberLocalAnimal,
  rememberLocalNonMember,
  resetPackMemory,
} from '../offlinePack';
import { clearQueue, rememberServerId } from '../queue';

const files: Map<string, string> = require('@/api/packFiles').__files;

const OWNER = 7;

const MPP_ROW = {
  id: 11,
  mpp_code: '001303',
  mpp_name: 'Barsana',
  member_count: 2,
} as MPP;

function member(code: string, name: string, mobile = '9811100000'): MemberDetail {
  return {
    id: Number(code),
    member_code: code,
    member_name: name,
    father_husband_name: '',
    mobile_no: mobile,
    mpp_code: '001303',
    mpp_name: 'Barsana',
    activation_status: 'active',
    can_receive_otp: true,
    animals: [],
  } as unknown as MemberDetail;
}

const KAVITA = member('100001', 'Kavita Devi', '9811100001');
const SUNITA = member('100002', 'Sunita Yadav', '9811100002');

const BREEDS = [
  { code: 'GIR', name: 'Gir', animal_type: 'COW', display_order: 2 },
  { code: 'MUR', name: 'Murrah', animal_type: 'BUFF', display_order: 1 },
];

/** A server that answers the pack's two calls, and records what it was asked. */
function server(mppBody: (since: string | null) => object) {
  const asked: string[] = [];
  global.fetch = jest.fn(async (input: string) => {
    asked.push(input);
    if (input.endsWith('/mait/offline-pack/')) {
      return jsonResponse({ server_time: '2026-10-28T10:00:00Z', mpps: [MPP_ROW], breeds: BREEDS });
    }
    const since = /since=([^&]+)/.exec(input)?.[1] ?? null;
    return jsonResponse({
      server_time: '2026-10-28T10:00:00Z',
      ...mppBody(since ? decodeURIComponent(since) : null),
    });
  }) as jest.Mock;
  return asked;
}

const full = () => ({
  members: [KAVITA, SUNITA],
  non_members: [],
  member_codes: [KAVITA.member_code, SUNITA.member_code],
  non_member_ids: [],
});

beforeEach(async () => {
  files.clear();
  resetPackMemory();
  await clearQueue();
  configurePackSync({ accessToken: () => 'token', online: () => false });
});

afterAll(() => configurePackSync(null));

describe('downloading the pack', () => {
  it('answers every picker in steps 1–6 from the phone', async () => {
    server(full);
    expect(await refreshPack(OWNER)).toEqual({ ok: true, refreshed: 1, failed: 0 });

    const mpps = (await answerFromPack(OWNER, { url: '/mpp/', params: { limit: 100 } })) as {
      results: MPP[];
    };
    expect(mpps.results.map(row => row.mpp_code)).toEqual(['001303']);

    const members = (await answerFromPack(OWNER, {
      url: '/members/',
      params: { mpp__mpp_code: '001303', limit: 50 },
    })) as { count: number; results: MemberDetail[] };
    expect(members.count).toBe(2);

    expect(await answerFromPack(OWNER, '/members/100002/')).toMatchObject({
      member_name: 'Sunita Yadav',
    });

    const breeds = (await answerFromPack(OWNER, {
      url: '/config/breeds/',
      params: { animal_type: 'COW' },
    })) as { code: string }[];
    expect(breeds.map(row => row.code)).toEqual(['GIR']);
  });

  it('searches by name, code or number with no signal', async () => {
    server(full);
    await refreshPack(OWNER);

    const search = async (text: string) =>
      (
        (await answerFromPack(OWNER, {
          url: '/members/',
          params: { mpp__mpp_code: '001303', search: text },
        })) as { results: MemberDetail[] }
      ).results.map(row => row.member_name);

    expect(await search('kavita')).toEqual(['Kavita Devi']);
    expect(await search('100002')).toEqual(['Sunita Yadav']);
    expect(await search('9811100001')).toEqual(['Kavita Devi']);
    expect(await search('devi kav')).toEqual(['Kavita Devi']);
    expect(await search('nobody')).toEqual([]);
  });

  it('survives the app being closed — the next launch reads it off the phone', async () => {
    server(full);
    await refreshPack(OWNER);
    resetPackMemory();
    global.fetch = jest.fn(() => Promise.reject(new Error('no signal'))) as jest.Mock;

    expect(await answerFromPack(OWNER, '/members/100001/')).toMatchObject({
      member_name: 'Kavita Devi',
    });
  });

  it('leaves an MPP it has not downloaded to the network', async () => {
    server(full);
    await refreshPack(OWNER);
    expect(
      await answerFromPack(OWNER, { url: '/members/', params: { mpp__mpp_code: '009999' } }),
    ).toBeUndefined();
  });
});

describe('refreshing it', () => {
  it('asks only for what changed, and drops a farmer the office removed', async () => {
    const asked = server(since =>
      since
        ? { members: [], non_members: [], member_codes: [SUNITA.member_code], non_member_ids: [] }
        : full(),
    );
    await refreshPack(OWNER);
    await refreshPack(OWNER);

    expect(asked.some(url => url.includes('/001303/?since='))).toBe(true);
    expect(await answerFromPack(OWNER, '/members/100001/')).toBeUndefined();
    expect(await answerFromPack(OWNER, '/members/100002/')).toMatchObject({
      member_name: 'Sunita Yadav',
    });
  });

  it('keeps the copy it had when the server answers with something that is not a pack', async () => {
    server(full);
    await refreshPack(OWNER);
    global.fetch = jest.fn(async () => jsonResponse({ count: 0, results: [] })) as jest.Mock;

    expect((await refreshPack(OWNER)).ok).toBe(false);
    expect(await answerFromPack(OWNER, '/members/100001/')).toMatchObject({
      member_name: 'Kavita Devi',
    });
  });
});

describe('what the Mait registered on this phone', () => {
  it('lists a farmer registered with no signal, through a refresh, until the server has her', async () => {
    server(full);
    await refreshPack(OWNER);

    await rememberLocalNonMember({
      id: -5,
      client_uuid: 'uuid-kamla',
      name: 'Kamla Devi',
      father_husband_name: '',
      relation: '',
      mobile_no: '9811100009',
      address: '',
      masked_aadhar: '',
      aadhar_front_captured: false,
      aadhar_back_captured: false,
      mpp: MPP_ROW.id,
      created_by_mait: 1,
      created_at: '2026-10-28T09:00:00Z',
    });

    const names = async () =>
      (
        (await answerFromPack(OWNER, {
          url: '/non-members/',
          params: { mpp__mpp_code: '001303' },
        })) as { results: { name: string }[] }
      ).results.map(row => row.name);

    expect(await names()).toEqual(['Kamla Devi']);
    await refreshPack(OWNER);
    // The server does not know her yet, and she is still on the phone's roster.
    expect(await names()).toEqual(['Kamla Devi']);

    // Her registration lands; the provisional row gives way to the server's.
    await rememberServerId('nonMember', 'uuid-kamla', 501);
    await refreshPack(OWNER);
    expect(await names()).toEqual([]);
  });

  it('puts an animal registered offline on her owner, and keeps her there through a refresh', async () => {
    server(full);
    await refreshPack(OWNER);

    await rememberLocalAnimal(
      { id: -9, client_uuid: 'uuid-cow', breed: 'GIR', animal_type: 'COW' } as Animal,
      { member_code: KAVITA.member_code },
    );
    server(() => ({ ...full(), members: [KAVITA] }));
    await refreshPack(OWNER);

    const kavita = (await answerFromPack(OWNER, '/members/100001/')) as MemberDetail;
    expect(kavita.animals.map(animal => animal.id)).toEqual([-9]);
  });
});

describe('through the app', () => {
  it('answers a Mait’s member search with no signal at all', async () => {
    server(full);
    await refreshPack(OWNER);
    global.fetch = jest.fn(() => Promise.reject(new Error('no signal'))) as jest.Mock;

    const store = makeStore();
    store.dispatch(
      loggedIn({
        access: 'a',
        refresh: 'r',
        user: {
          id: OWNER,
          fullName: 'Rohit',
          role: 'mait',
          mobileNo: '',
          maitId: 1,
          sahayakVendorCode: null,
        },
        assignedMppCodes: ['001303'],
      }),
    );

    const result = await store.dispatch(
      maitaiApi.endpoints.listMembers.initiate({ mppCode: '001303', search: 'sunita' }),
    );
    expect(result.data?.results.map(row => row.member_name)).toEqual(['Sunita Yadav']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the office’s keys, for a farmer check with no signal', () => {
  const KEYS = [
    { day: '2026-10-28', key: 'a2V5LW9uZQ==' },
    { day: '2026-10-29', key: 'a2V5LXR3bw==' },
  ];

  function serverWithKeys(keys: object | undefined) {
    global.fetch = jest.fn(async (input: string) => {
      if (input.endsWith('/mait/offline-pack/')) {
        return jsonResponse({
          server_time: '2026-10-28T10:00:00Z',
          mpps: [MPP_ROW],
          breeds: BREEDS,
          ...(keys ? { field_keys: keys, office_phone: '01234567890' } : {}),
        });
      }
      return jsonResponse({ server_time: '2026-10-28T10:00:00Z', ...full() });
    }) as jest.Mock;
  }

  it('keeps one per day, with the number to ring', async () => {
    serverWithKeys(KEYS);
    await refreshPack(OWNER);

    expect(await fieldCheckFor(OWNER, '2026-10-29')).toEqual({
      key: 'a2V5LXR3bw==',
      officePhone: '01234567890',
    });
    expect((await fieldCheckFor(OWNER, '2026-11-30')).key).toBeNull();
  });

  it('keeps them when an older server answers without any', async () => {
    serverWithKeys(KEYS);
    await refreshPack(OWNER);
    serverWithKeys(undefined);
    await refreshPack(OWNER);

    expect((await fieldCheckFor(OWNER, '2026-10-28')).key).toBe('a2V5LW9uZQ==');
  });
});

describe('signing out', () => {
  it('takes the whole pack with it', async () => {
    server(full);
    await refreshPack(OWNER);
    await clearPack(OWNER);
    resetPackMemory();

    expect(files.size).toBe(0);
    expect(await answerFromPack(OWNER, '/members/100001/')).toBeUndefined();
  });
});
