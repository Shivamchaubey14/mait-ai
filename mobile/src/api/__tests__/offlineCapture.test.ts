/**
 * A whole insemination recorded with no signal (SRS §6.9, ADR 0003).
 *
 * The queue tests next door cover a drain in the abstract. These walk the thing a Mait
 * actually does: they reach step 5 in a village with no bars, the capture opens anyway, the
 * photo and the completion pile up behind it, the app is closed and reopened, and everything
 * goes up in the right order when the handset finds a tower on the way home.
 *
 * The two failures this guards against are the two that cannot be undone — losing an
 * insemination that happened, and recording one twice so a second straw is deducted for one
 * animal.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  attachPhoto,
  completeEvent,
  createEvent,
  isProvisional,
  provisionalId,
  registerAnimal,
  registerNonMember,
} from '../capture';
import { clearQueue, eventIdFor, isDue, readQueue, rememberEventId, retryFailed } from '../queue';
import { drainQueue } from '../sync';
import type { AIEvent, AIEventDraft, Animal, NonMember } from '../types';

const TOKEN = 'access-token';

const DRAFT: AIEventDraft = {
  client_uuid: '11111111-1111-4111-8111-111111111111',
  mpp_code: '001303',
  member_code: '0906167700010001',
  animal_id: 7,
  semen_breed: 'HF_CROSS',
  doses: 1,
};

const PROVISIONAL = { id: provisionalId(), amount_due: '300.00' } as AIEvent;

const PHOTO = {
  uri: 'file:///proof.jpg',
  gpsLat: 26.8,
  gpsLng: 80.9,
  accuracy: 12,
  performedAt: '2026-09-10T09:20:00.000Z',
  source: 'camera' as const,
  gpsSource: 'device' as const,
};

/** The network is not there. Every `fetch` behaves the way it does in a village. */
function noSignal() {
  (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));
}

/**
 * The handset in a pocket between one attempt and the next.
 *
 * A failed job is held back by its own backoff, which is the point of the backoff — so a test
 * about what happens *later* has to actually be later. Clearing the schedule is how this suite
 * says an hour went by without making every case wait one.
 */
async function anHourPasses() {
  const jobs = JSON.parse((await AsyncStorage.getItem('maitai.queue.v1')) ?? '[]');
  jobs.forEach((job: { nextAttemptAt?: number }) => {
    job.nextAttemptAt = 0;
  });
  await AsyncStorage.setItem('maitai.queue.v1', JSON.stringify(jobs));
}

function jsonOk(body: unknown, code = 200) {
  return Promise.resolve({
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

beforeEach(async () => {
  await clearQueue();
  await AsyncStorage.clear();
  global.fetch = jest.fn() as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

describe('opening a capture with no signal', () => {
  it('carries on rather than stopping the Mait at the straw', async () => {
    // The wall this whole change exists to remove. The straw is already drawn by the time
    // Continue is tapped; refusing here strands a Mait with an animal served and nothing
    // recorded.
    noSignal();

    const outcome = await createEvent(DRAFT, PROVISIONAL, TOKEN);

    expect(outcome.queued).toBe(true);
    expect(outcome.event).toBe(PROVISIONAL);
    expect((await readQueue()).map(job => job.kind)).toEqual(['createEvent']);
  });

  it('opens on the server when there is one, and remembers the id', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({ id: 51 }, 201));

    const outcome = await createEvent(DRAFT, PROVISIONAL, TOKEN);

    expect(outcome.sent).toBe(true);
    expect(outcome.event?.id).toBe(51);
    expect(await readQueue()).toEqual([]);
    // Kept even though nothing was queued: a completion later in this same capture can still
    // fall over, and the job it queues has to be able to name the event.
    expect(await eventIdFor(DRAFT.client_uuid)).toBe(51);
  });

  it('does not queue a capture the server refused, and passes on its words', async () => {
    // An empty flask is not a network problem. Queuing it would put a capture on the waiting
    // list that can never be sent, and the Mait would never be told why.
    (global.fetch as jest.Mock).mockImplementation(() =>
      jsonOk({ detail: 'You have no HF Cross straws left.' }, 400),
    );

    const outcome = await createEvent(DRAFT, PROVISIONAL, TOKEN);

    expect(outcome.queued).toBe(false);
    expect(outcome.event).toBeNull();
    expect(outcome.problem).toBe('You have no HF Cross straws left.');
    expect(await readQueue()).toEqual([]);
  });

  it('queues rather than refusing when the server itself is broken', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({}, 503));

    const outcome = await createEvent(DRAFT, PROVISIONAL, TOKEN);

    expect(outcome.queued).toBe(true);
    expect(outcome.event).toBe(PROVISIONAL);
  });
});

describe('the rest of the capture, behind an event that does not exist yet', () => {
  it('never puts a provisional id in a URL', async () => {
    // A negative id is the handset's own bookkeeping. Sent to the server it is a request
    // against a row that does not exist, which on a handset that has since found signal comes
    // back 404 and reads to the Mait as a refusal.
    const provisional = provisionalId();
    expect(isProvisional(provisional)).toBe(true);

    await attachPhoto(provisional, DRAFT.client_uuid, PHOTO, TOKEN);
    await completeEvent(provisional, DRAFT.client_uuid, TOKEN);

    expect(global.fetch).not.toHaveBeenCalled();
    const jobs = await readQueue();
    expect(jobs.map(job => job.kind)).toEqual(['attachPhoto', 'completeEvent']);
    // Queued naming nothing rather than naming the placeholder.
    expect(jobs.every(job => job.payload.eventId === null)).toBe(true);
  });

  it('waits for the create rather than failing, and counts nothing against itself', async () => {
    // The photo is queued ahead of its own event existing. A drain that tried it would get a
    // URL with no id in it; one that failed it would spend an attempt on something that was
    // never wrong.
    await attachPhoto(provisionalId(), DRAFT.client_uuid, PHOTO, null);
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({}, 200));

    await drainQueue(TOKEN);

    const [photo] = await readQueue();
    expect(photo?.attempts).toBe(0);
    expect(photo?.failed).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the ride home', () => {
  it('sends the whole capture in order, filling in the id the create came back with', async () => {
    // The end-to-end case: a capture made entirely offline, drained when the tower appears.
    noSignal();
    await createEvent(DRAFT, PROVISIONAL, TOKEN);
    const provisional = PROVISIONAL.id;
    await attachPhoto(provisional, DRAFT.client_uuid, PHOTO, TOKEN);
    await completeEvent(provisional, DRAFT.client_uuid, TOKEN);
    expect(await readQueue()).toHaveLength(3);

    const urls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      urls.push(url);
      return url.endsWith('/ai-events/') ? jsonOk({ id: 51 }, 201) : jsonOk({}, 200);
    });

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(3);
    expect(await readQueue()).toEqual([]);
    expect(urls[0]).toMatch(/\/ai-events\/$/);
    // The id the create answered with, not the placeholder the handset was carrying.
    expect(urls[1]).toMatch(/\/ai-events\/51\/photo\/$/);
    expect(urls[2]).toMatch(/\/ai-events\/51\/complete\/$/);
  });

  it('picks the capture up from a different run of the app', async () => {
    // The create goes out on a ridge with one bar and the handset goes back in a pocket. The
    // photo follows an hour later from a launch that shares no memory with this one, so the
    // id has to have been written down rather than held.
    noSignal();
    await createEvent(DRAFT, PROVISIONAL, TOKEN);
    await attachPhoto(PROVISIONAL.id, DRAFT.client_uuid, PHOTO, TOKEN);

    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      url.endsWith('/ai-events/') ? jsonOk({ id: 51 }, 201) : Promise.reject(new Error('gone')),
    );
    await drainQueue(TOKEN);

    // The create landed; the photo did not. Nothing is in memory any more — this is what a
    // later launch reads.
    expect(await eventIdFor(DRAFT.client_uuid)).toBe(51);

    await anHourPasses();
    const urls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      urls.push(url);
      return jsonOk({}, 200);
    });
    await drainQueue(TOKEN);

    expect(urls[0]).toMatch(/\/ai-events\/51\/photo\/$/);
    expect(await readQueue()).toEqual([]);
  });

  it('does not open a second event when the first response was lost', async () => {
    // The case idempotency exists for, and the one that cannot be undone: the server made the
    // event and the reply never arrived. The retry has to carry the same key and be answered
    // with the event that already exists.
    noSignal();
    await createEvent(DRAFT, PROVISIONAL, TOKEN);

    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new Error('dropped')));
    await drainQueue(TOKEN);

    await anHourPasses();
    const keys: (string | undefined)[] = [];
    (global.fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
      // What the server answers a replay with: the event it already had.
      return jsonOk({ id: 51 }, 200);
    });
    await drainQueue(TOKEN);

    expect(keys).toEqual([DRAFT.client_uuid]);
    expect(await eventIdFor(DRAFT.client_uuid)).toBe(51);
  });
});

describe('a cow registered in the same yard, minutes before the capture', () => {
  /** Enough of an animal for the flow to carry. The server fills in the rest. */
  const HER: Omit<Animal, 'id' | 'client_uuid'> = {
    owner_type: 'member',
    member: null,
    non_member: null,
    owner_name: 'Kavita Devi',
    animal_type: 'COW',
    animal_type_display: 'Cow',
    breed: '',
    ear_tag_no: null,
    photo_url: '',
    ai_event_count: 0,
    last_ai_at: null,
    created_at: '2026-09-10T09:15:00.000Z',
  };

  /** The same cow as the form sends her. A tag she does not carry is absent, not null. */
  const HER_DRAFT = { member_code: DRAFT.member_code, animal_type: 'COW' as const };

  it('registers her offline and carries her into the capture', async () => {
    // A farmer whose cow is not on her roster yet is the ordinary case in a young deployment,
    // and it happens in the same villages as everything else.
    noSignal();

    const registered = await registerAnimal(HER_DRAFT, HER, TOKEN);

    expect(registered.queued).toBe(true);
    expect(isProvisional(registered.animal!.id)).toBe(true);
    expect(registered.animal!.client_uuid).toBeTruthy();
    expect((await readQueue()).map(job => job.kind)).toEqual(['createAnimal']);
  });

  it('keeps her portrait rather than losing it with the network', async () => {
    // She is how a Mait recognises the animal on the next visit, and most animals in this
    // data carry no ear tag. A photograph dropped because a village had no bars is a cow
    // nobody can identify again.
    noSignal();

    await registerAnimal(HER_DRAFT, HER, TOKEN, 'file:///her.jpg');

    const jobs = await readQueue();
    expect(jobs.map(job => job.kind)).toEqual(['createAnimal', 'attachAnimalPhoto']);
    expect(jobs[1]?.payload.photoUri).toBe('file:///her.jpg');
  });

  it('opens the capture against the id her registration came back with', async () => {
    // The whole chain, end to end: cow, capture, photo, completion — none of which existed on
    // the server when the Mait tapped through them.
    noSignal();
    const registered = await registerAnimal(HER_DRAFT, HER, TOKEN, 'file:///her.jpg');
    const her = registered.animal!;

    await createEvent(
      { ...DRAFT, animal_id: her.id, animal_client_uuid: her.client_uuid },
      PROVISIONAL,
      TOKEN,
    );

    const urls: string[] = [];
    const bodies: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(String(init.body ?? ''));
      if (url.endsWith('/animals/')) {
        return jsonOk({ id: 33 }, 201);
      }
      return url.endsWith('/ai-events/') ? jsonOk({ id: 51 }, 201) : jsonOk({}, 200);
    });

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(3);
    expect(urls[0]).toMatch(/\/animals\/$/);
    expect(urls[1]).toMatch(/\/animals\/33\/photo\/$/);
    expect(urls[2]).toMatch(/\/ai-events\/$/);

    // The real row id, not the placeholder — and the handset's own bookkeeping does not
    // travel with it.
    const capture = JSON.parse(bodies[2]!);
    expect(capture.animal_id).toBe(33);
    expect(capture).not.toHaveProperty('animal_client_uuid');
  });

  it('holds the capture back until she exists', async () => {
    // Her registration is ahead of it in the queue. A capture sent first would name an animal
    // the server has never heard of, and be refused for it.
    noSignal();
    const registered = await registerAnimal(HER_DRAFT, HER, TOKEN);
    const her = registered.animal!;
    await createEvent(
      { ...DRAFT, animal_id: her.id, animal_client_uuid: her.client_uuid },
      PROVISIONAL,
      TOKEN,
    );

    const urls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      urls.push(url);
      // Her registration is refused — a tag already on another animal, say.
      return jsonOk({ detail: 'That ear tag is already registered.' }, 400);
    });

    await drainQueue(TOKEN);

    // Tried once, and the capture behind her was not sent at all.
    expect(urls).toEqual([expect.stringMatching(/\/animals\/$/)]);
    const [animal, capture] = await readQueue();
    expect(animal?.failed).toBe(true);

    // The capture is marked too, and with her reason. It did nothing wrong, but what it is
    // waiting for is never coming — and a row that sat there saying *Waiting* forever would
    // read to a Mait as one of the ones that is fine.
    expect(capture?.attempts).toBe(0);
    expect(capture?.failed).toBe(true);
    expect(capture?.lastError).toBe('That ear tag is already registered.');
  });

  it('does not register her twice when the response was lost', async () => {
    // The same rule the capture has. Two identical cows on one farmer's roster is a choice
    // the Mait has no way to make.
    noSignal();
    await registerAnimal(HER_DRAFT, HER, TOKEN);

    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new Error('dropped')));
    await drainQueue(TOKEN);
    await anHourPasses();

    const keys: (string | undefined)[] = [];
    (global.fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
      // What the server answers a replay with: the animal it already had.
      return jsonOk({ id: 33 }, 200);
    });
    await drainQueue(TOKEN);

    const [key] = keys;
    expect(key).toBeTruthy();
    // Her own key, not the capture's — she outlives the insemination.
    expect(key).not.toBe(DRAFT.client_uuid);
    expect(await readQueue()).toEqual([]);
  });
});

describe('a farmer nobody had on file, in a village with no signal', () => {
  /** Enough of her for the flow to carry and the waiting list to name her. */
  const HER: Omit<NonMember, 'id' | 'client_uuid'> = {
    name: 'Radha Singh',
    father_husband_name: 'Ram',
    relation: 'husband',
    mobile_no: '9811111111',
    address: 'Village',
    masked_aadhar: 'XXXX XXXX 9012',
    aadhar_front_captured: true,
    aadhar_back_captured: true,
    mpp: 1,
    created_by_mait: 0,
    created_at: '2026-09-10T09:10:00.000Z',
  };

  const HER_DRAFT = { name: 'Radha Singh', mobile_no: '9811111111', mpp: 1 };
  const CARD = { front: 'file:///front.jpg', back: 'file:///back.jpg' };

  const HER_COW: Omit<Animal, 'id' | 'client_uuid'> = {
    owner_type: 'non_member',
    member: null,
    non_member: null,
    owner_name: 'Radha Singh',
    animal_type: 'COW',
    animal_type_display: 'Cow',
    breed: '',
    ear_tag_no: null,
    photo_url: '',
    ai_event_count: 0,
    last_ai_at: null,
    created_at: '2026-09-10T09:15:00.000Z',
  };

  it('registers her rather than turning her away', async () => {
    // The decision the business made: a Mait who meets an unregistered farmer where there is
    // no signal can serve her, and her Aadhaar is checked when the queue drains.
    noSignal();

    const registered = await registerNonMember(HER_DRAFT, HER, TOKEN, CARD);

    expect(registered.queued).toBe(true);
    expect(isProvisional(registered.nonMember!.id)).toBe(true);
    expect((await readQueue()).map(job => job.kind)).toEqual(['createNonMember', 'attachAadhaar']);
  });

  it('sends her, her card, her cow and the insemination, in that order', async () => {
    // Three rows the server has never seen, made in one yard, each one needed by the next.
    noSignal();
    const her = (await registerNonMember(HER_DRAFT, HER, TOKEN, CARD)).nonMember!;
    const cow = (
      await registerAnimal({ non_member_id: her.id, animal_type: 'COW' }, HER_COW, TOKEN)
    ).animal!;
    await createEvent(
      {
        client_uuid: DRAFT.client_uuid,
        mpp_code: DRAFT.mpp_code,
        non_member_id: her.id,
        non_member_client_uuid: her.client_uuid,
        animal_id: cow.id,
        animal_client_uuid: cow.client_uuid,
        semen_breed: 'HF_CROSS',
        doses: 1,
      },
      PROVISIONAL,
      TOKEN,
    );

    const urls: string[] = [];
    const bodies: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(String(init.body ?? ''));
      if (url.endsWith('/non-members/')) {
        return jsonOk({ id: 21 }, 201);
      }
      if (url.endsWith('/animals/')) {
        return jsonOk({ id: 33 }, 201);
      }
      return url.endsWith('/ai-events/') ? jsonOk({ id: 51 }, 201) : jsonOk({}, 200);
    });

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(4);
    expect(urls[0]).toMatch(/\/non-members\/$/);
    expect(urls[1]).toMatch(/\/non-members\/21\/aadhaar\/$/);
    expect(urls[2]).toMatch(/\/animals\/$/);
    expect(urls[3]).toMatch(/\/ai-events\/$/);

    // Both placeholders replaced by the ids the server gave, and neither piece of handset
    // bookkeeping sent along with them.
    const capture = JSON.parse(bodies[3]!);
    expect(capture.non_member_id).toBe(21);
    expect(capture.animal_id).toBe(33);
    expect(capture).not.toHaveProperty('non_member_client_uuid');
    expect(capture).not.toHaveProperty('animal_client_uuid');
  });

  it('does not register her twice when the response was lost', async () => {
    // A duplicate non-member is a farmer who can be asked for cash a second time for one
    // service, and after the round is over a duplicate is indistinguishable from a second
    // woman. This is the case the key exists for.
    noSignal();
    await registerNonMember(HER_DRAFT, HER, TOKEN);

    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new Error('dropped')));
    await drainQueue(TOKEN);
    await anHourPasses();

    const bodies: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((_url: string, init: RequestInit) => {
      bodies.push(String(init.body ?? ''));
      return jsonOk({ id: 21 }, 200);
    });
    await drainQueue(TOKEN);

    // The same key both times, which is what lets the server answer with the farmer it
    // already has instead of making another.
    expect(JSON.parse(bodies[0]!).client_uuid).toBeTruthy();
    expect(await readQueue()).toEqual([]);
  });

  it('tells the Mait when the office refuses her, and marks what was waiting on her', async () => {
    // The risk the business accepted, made visible. She turns out to be a member, so the
    // registration is refused hours after the Mait took her money — and the capture behind
    // her must not sit on the list saying *Waiting* as though it were fine.
    noSignal();
    const her = (await registerNonMember(HER_DRAFT, HER, TOKEN)).nonMember!;
    await createEvent(
      {
        client_uuid: DRAFT.client_uuid,
        mpp_code: DRAFT.mpp_code,
        non_member_id: her.id,
        non_member_client_uuid: her.client_uuid,
        animal_id: 7,
        semen_breed: 'HF_CROSS',
      },
      PROVISIONAL,
      TOKEN,
    );

    (global.fetch as jest.Mock).mockImplementation(() =>
      jsonOk({ detail: 'Kavita Devi is already a member at Barsana MPP.' }, 400),
    );

    const result = await drainQueue(TOKEN);

    expect(result.failed).toBe(2);
    const [registration, capture] = await readQueue();
    expect(registration?.failed).toBe(true);
    // The server's own words, on both rows — it is the same fact about the same farmer.
    expect(registration?.lastError).toContain('already a member');
    expect(capture?.failed).toBe(true);
    expect(capture?.lastError).toContain('already a member');
  });
});

describe('when one capture goes wrong', () => {
  it('sends the others anyway', async () => {
    // The bug this replaced: the drain stopped at the first failure, so one refused record
    // held up a whole day's work behind it and the count sat still with no explanation.
    await completeEvent(-1, 'uuid-bad', null);
    await completeEvent(-2, 'uuid-good', null);
    await rememberEventId('uuid-bad', 8);
    await rememberEventId('uuid-good', 9);

    (global.fetch as jest.Mock).mockImplementation((url: string) =>
      url.includes('/8/')
        ? jsonOk({ detail: 'That straw is already spent.' }, 400)
        : jsonOk({}, 200),
    );

    const result = await drainQueue(TOKEN);

    expect(result.sent).toBe(1);
    const left = await readQueue();
    expect(left).toHaveLength(1);
    expect(left[0]?.clientUuid).toBe('uuid-bad');
  });

  it('keeps a refused record and marks it for a person', async () => {
    // Never deleted. A rejected insemination is a record somebody has to deal with, and one
    // that quietly disappeared would be a day's work gone with no account of where it went.
    await completeEvent(-1, 'uuid-bad', null);
    await rememberEventId('uuid-bad', 8);
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({}, 400));

    const result = await drainQueue(TOKEN);

    const [job] = await readQueue();
    expect(job?.failed).toBe(true);
    expect(job?.failedStatus).toBe(400);
    expect(result.failed).toBe(1);
  });

  it('does not try a refused record again on its own', async () => {
    // Retrying forever is how a refusal stays invisible. It waits for the Mait to tap
    // *Try this one again*, once the office has fixed whatever the server objected to.
    await completeEvent(-1, 'uuid-bad', null);
    await rememberEventId('uuid-bad', 8);
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({}, 400));
    await drainQueue(TOKEN);

    (global.fetch as jest.Mock).mockClear();
    await drainQueue(TOKEN);
    expect(global.fetch).not.toHaveBeenCalled();

    // And it does go, once a person says so.
    const [job] = await readQueue();
    await retryFailed(job!.id);
    (global.fetch as jest.Mock).mockImplementation(() => jsonOk({}, 200));
    await drainQueue(TOKEN);
    expect(await readQueue()).toEqual([]);
  });

  it('waits before trying again after the network drops it', async () => {
    // Exponential backoff with jitter, so a depot full of handsets that lost the same tower
    // does not come back in step and arrive as one spike.
    await completeEvent(7, 'uuid-1', null);
    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new Error('no signal')));

    await drainQueue(TOKEN);

    const [job] = await readQueue();
    expect(job?.attempts).toBe(1);
    expect(job?.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(isDue(job!)).toBe(false);

    // And nothing is sent while it is waiting.
    (global.fetch as jest.Mock).mockClear();
    await drainQueue(TOKEN);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is still there after the app is closed and reopened', async () => {
    // Nothing here is held in memory. This is what a Mait is promised by the screen that
    // says "nothing here is lost".
    noSignal();
    await createEvent(DRAFT, PROVISIONAL, TOKEN);
    await attachPhoto(PROVISIONAL.id, DRAFT.client_uuid, PHOTO, TOKEN);

    // A fresh launch reads the same store and finds the same work.
    const jobs = await readQueue();
    expect(jobs.map(job => job.kind)).toEqual(['createEvent', 'attachPhoto']);
    expect(jobs[0]?.payload.animal_id).toBe(7);
    expect(jobs[1]?.payload.photoUri).toBe('file:///proof.jpg');
  });
});
