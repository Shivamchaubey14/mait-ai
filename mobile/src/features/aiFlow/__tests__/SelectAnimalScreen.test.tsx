/**
 * Animal selection tests (SRS §6.3 step 3, C6).
 *
 * The cases that matter are the ones a Mait hits in a yard: two untagged cows that have to be
 * told apart, a buffalo household whose animals must not be hidden behind a Cow tab, and a
 * species switch that cannot leave a cow selected while the list shows buffaloes.
 */

import React from 'react';
import { Image } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectAnimalScreen from '../SelectAnimalScreen';
import { clearQueue, enqueue } from '@api/queue';
import type { Animal } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

/** The camera, reduced to what this screen cares about: a photo came back. */
jest.mock('../FlowCamera', () => {
  const Actual = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      testIDPrefix,
      onCaptured,
    }: {
      testIDPrefix: string;
      onCaptured: (uri: string) => void;
    }) =>
      Actual.createElement(
        Pressable,
        {
          testID: `${testIDPrefix}-stub`,
          onPress: () => onCaptured(`file:///${testIDPrefix}.jpg`),
        },
        Actual.createElement(Text, null, 'capture'),
      ),
  };
});

/** Photograph her in the sheet — required before she can be saved. */
function takeHerPhoto() {
  fireEvent.press(screen.getByTestId('animal-photo'));
  fireEvent.press(screen.getByTestId('animal-camera-stub'));
}

const OWNER = { name: 'KAVITA DEVI', memberCode: '0906167700010001' };

function animal(over: Partial<Animal> & { id: number }): Animal {
  return {
    owner_type: 'member',
    member: 1,
    non_member: null,
    owner_name: OWNER.name,
    animal_type: 'COW',
    animal_type_display: 'Cow',
    breed: 'HF_CROSS',
    ear_tag_no: null,
    photo_url: '',
    ai_event_count: 0,
    last_ai_at: null,
    created_at: '2026-01-02T05:00:00Z',
    ...over,
  };
}

const TAGGED = animal({ id: 1, ear_tag_no: '4821', last_ai_at: '2026-03-14T06:30:00Z' });
const UNTAGGED = animal({ id: 2, breed: 'SAHIWAL', last_ai_at: '2026-01-02T06:30:00Z' });
const BUFFALO = animal({ id: 3, animal_type: 'BUFF', breed: 'MURRAH' });

const BREEDS = [
  { id: 1, animal_type: 'COW', code: 'HF_CROSS', name: 'HF Cross', name_hi: '', rate: '0.00' },
  { id: 2, animal_type: 'COW', code: 'SAHIWAL', name: 'Sahiwal', name_hi: '', rate: '0.00' },
];

describe('SelectAnimalScreen', () => {
  const onSelect = jest.fn();
  const onBack = jest.fn();

  /** What POST /animals/ answers, when a test gets that far. */
  let created: Response | null = null;

  beforeEach(() => {
    created = null;
    // Routed rather than queued: the toggle re-asks for the breed list of whichever species
    // it lands on, so a one-shot mock for the create is taken by that instead.
    global.fetch = jest.fn().mockImplementation(async (input: string | Request) => {
      const href = typeof input === 'string' ? input : input.url;
      if (href.includes('/config/breeds/')) {
        return jsonResponse(BREEDS);
      }
      return created ?? jsonResponse({}, 500);
    }) as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen(animals: Animal[]) {
    return renderWithStore(
      <SelectAnimalScreen
        owner={OWNER}
        animals={animals}
        accessToken="test-token"
        onSelect={onSelect}
        onBack={onBack}
      />,
    );
  }

  it('says how many the farmer has on record', () => {
    renderScreen([TAGGED, UNTAGGED]);

    expect(screen.getByText('KAVITA DEVI has 2 on record.')).toBeTruthy();
  });

  it('puts the add card under the cow / buffalo switch, and the newest animal under it', () => {
    const older = animal({ id: 5, created_at: '2026-01-01T05:00:00Z' });
    const newest = animal({ id: 6, created_at: '2026-06-01T05:00:00Z' });
    const middle = animal({ id: 7, created_at: '2026-03-01T05:00:00Z' });
    renderScreen([older, newest, middle]);

    // In the order they are drawn, top to bottom.
    const order = screen
      .getAllByTestId(/^animal-(type-COW|add-card|\d+)$/)
      .map(node => String(node.props.testID));
    expect(order).toEqual([
      'animal-type-COW',
      'animal-add-card',
      'animal-6',
      'animal-7',
      'animal-5',
    ]);
  });

  it('tells one cow from another by tag, and by when she was last served', async () => {
    renderScreen([TAGGED, UNTAGGED]);

    await waitFor(() => expect(screen.getByText('Cow · tag 4821')).toBeTruthy());
    expect(screen.getByText('Cow · no tag')).toBeTruthy();
    // The breed code resolves to its label once the breed list lands.
    expect(screen.getByText('Last AI 14 Mar 2026 · HF Cross')).toBeTruthy();
    expect(screen.getByText('Last AI 2 Jan 2026 · Sahiwal')).toBeTruthy();
  });

  it('leads the row with her photograph, resolved to something a handset can fetch', () => {
    const photographed = animal({ id: 4, photo_url: '/media/animal-photos/2026/08/4/a.jpg' });
    renderScreen([photographed]);

    const row = screen.getByTestId(`animal-${photographed.id}`);
    const image = row.findByType(Image);

    expect(image.props.source.uri).toMatch(/^https?:\/\/.+\/media\/animal-photos\//);
    // Her face replaces the handle rather than sitting beside it.
    expect(screen.queryByText('C1')).toBeNull();
  });

  it('gives an untagged animal a handle of its own', () => {
    renderScreen([TAGGED, UNTAGGED]);

    expect(screen.getByText('C1')).toBeTruthy();
    expect(screen.getByText('C2')).toBeTruthy();
  });

  it('commits the choice from the footer, not from the row', () => {
    renderScreen([TAGGED, UNTAGGED]);

    fireEvent.press(screen.getByTestId(`animal-${TAGGED.id}`));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('animal-continue'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: TAGGED.id }));
  });

  it('will not continue until an animal is chosen', () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-continue'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens on the species the farmer actually keeps', () => {
    renderScreen([BUFFALO]);

    expect(screen.getByText('Buffalo · no tag')).toBeTruthy();
  });

  it('filters the list by species, and drops a selection the list no longer shows', () => {
    renderScreen([TAGGED, BUFFALO]);

    fireEvent.press(screen.getByTestId(`animal-${TAGGED.id}`));
    fireEvent.press(screen.getByTestId('animal-type-BUFF'));

    expect(screen.queryByText('Cow · tag 4821')).toBeNull();
    expect(screen.getByText('Buffalo · no tag')).toBeTruthy();

    // The cow is still chosen as far as state goes only if the switch failed to clear it.
    fireEvent.press(screen.getByTestId('animal-continue'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers to add one rather than showing a bare empty list', () => {
    renderScreen([BUFFALO]);

    fireEvent.press(screen.getByTestId('animal-type-COW'));

    expect(screen.getByTestId('animal-none-of-type')).toBeTruthy();
    expect(screen.getByTestId('animal-add-card')).toBeTruthy();
    // Named by species, and asserted as text: this line is keyed per species rather than
    // interpolated, and asking i18next for the parent key hands back the object instead.
    expect(screen.getByText('No cows on record yet')).toBeTruthy();
    expect(screen.getByText('Add the one standing in front of you.')).toBeTruthy();
  });

  it('names the buffalo half of the empty state too', () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-type-BUFF'));

    expect(screen.getByText('No buffaloes on record yet')).toBeTruthy();
  });

  it('shows the empty list and its add card, never a form the Mait did not ask for', () => {
    renderScreen([]);

    expect(screen.getByTestId('animal-none-of-type')).toBeTruthy();
    expect(screen.getByTestId('animal-add-card')).toBeTruthy();
    // The list is not a form: nothing to type into until the Mait says they are adding one.
    expect(screen.queryByTestId('animal-ear-tag')).toBeNull();
  });

  it('opens registration as a sheet, naming whose animal it will be', () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));

    expect(screen.getByText(`For ${OWNER.name} · ${OWNER.memberCode}`)).toBeTruthy();
    expect(screen.getByTestId('animal-ear-tag')).toBeTruthy();
    expect(screen.getByTestId('animal-photo')).toBeTruthy();
    // The list is still behind it, not replaced by it.
    expect(screen.getByText('Cow · tag 4821')).toBeTruthy();
  });

  it('will not save an animal with no breed against her', () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.press(screen.getByTestId('animal-save'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes without registering anything', async () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.press(screen.getByTestId('add-animal-close'));

    // Awaited, because the sheet now leaves rather than vanishes: it stays mounted for its
    // exit animation and renders nothing of its own once that has played out.
    // Awaited, because the sheet now leaves rather than vanishes: it stays mounted for its
    // exit animation and renders nothing of its own once that has played out. The window is
    // generous on purpose — what is being asserted is that it goes, not how fast.
    await waitFor(() => expect(screen.queryByTestId('animal-ear-tag')).toBeNull(), {
      timeout: 15000,
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('registers a new animal with the species and breed chosen in the sheet', async () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    // The sheet has a switch of its own, over the list's — the species of the animal being
    // registered, not the species the list is filtered to.
    fireEvent.press(screen.getByTestId('sheet-animal-type-BUFF'));

    // The breed is a closed list, opened on demand.
    fireEvent.press(screen.getByTestId('animal-breed'));
    await waitFor(() => expect(screen.getByTestId('animal-breed-HF_CROSS')).toBeTruthy());
    fireEvent.press(screen.getByTestId('animal-breed-HF_CROSS'));

    created = jsonResponse(animal({ id: 9, animal_type: 'BUFF' }), 201);
    takeHerPhoto();
    fireEvent.press(screen.getByTestId('animal-save'));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 9 })));
    expect(await createBody()).toMatchObject({
      member_code: OWNER.memberCode,
      animal_type: 'BUFF',
      breed: 'HF_CROSS',
    });
  });

  it('will not save an animal without her photo, and says so', async () => {
    renderScreen([]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.press(screen.getByTestId('animal-breed'));
    await waitFor(() => expect(screen.getByTestId('animal-breed-HF_CROSS')).toBeTruthy());
    fireEvent.press(screen.getByTestId('animal-breed-HF_CROSS'));

    expect(screen.getByTestId('animal-photo-required')).toHaveTextContent(/photo/i);
    expect(screen.getByTestId('animal-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('animal-save'));
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/animals/'),
      expect.anything(),
    );

    takeHerPhoto();
    expect(screen.queryByTestId('animal-photo-required')).toBeNull();
    expect(screen.getByTestId('animal-save')).not.toBeDisabled();
  });

  describe('one semen, then 21 days', () => {
    afterEach(() => clearQueue());

    it('holds back an animal served inside 21 days, saying from when', () => {
      const served = animal({
        id: 11,
        last_ai_at: '2026-10-20T06:30:00Z',
        next_ai_block: 'too_soon',
        next_ai_on: '2026-11-10',
      });
      renderScreen([served, TAGGED]);

      expect(screen.getByTestId('animal-11')).toHaveTextContent(/Next semen from 10 Nov 2026/);
      expect(screen.getByTestId('animal-rule')).toHaveTextContent(
        /Only one semen per animal\. The next can be given 21 days later/,
      );

      fireEvent.press(screen.getByTestId('animal-11'));
      expect(screen.getByTestId('animal-continue')).toBeDisabled();
    });

    it('holds back a pregnant animal until she calves', () => {
      renderScreen([animal({ id: 12, next_ai_block: 'pregnant', next_ai_on: '2027-06-01' })]);
      expect(screen.getByTestId('animal-12')).toHaveTextContent(/Pregnant.*1 Jun 2027/);
    });

    it('holds back an animal with an AI still unfinished', () => {
      renderScreen([animal({ id: 13, next_ai_block: 'open' })]);
      expect(screen.getByTestId('animal-13')).toHaveTextContent(/unfinished/);
    });

    it('holds back an animal served on this phone, before the server has heard', async () => {
      await enqueue('createEvent', 'capture-1', { animal_id: 14, mpp_code: '001303' });
      renderScreen([animal({ id: 14 })]);

      await waitFor(() =>
        expect(screen.getByTestId('animal-14')).toHaveTextContent(/waiting to send/),
      );
    });

    it('lets every other animal through', () => {
      renderScreen([TAGGED]);
      expect(screen.queryByTestId('animal-rule')).toBeNull();
      fireEvent.press(screen.getByTestId('animal-1'));
      expect(screen.getByTestId('animal-continue')).not.toBeDisabled();
    });
  });

  it('says which box to fix when the server rejects the ear tag', async () => {
    renderScreen([]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.press(screen.getByTestId('animal-breed'));
    await waitFor(() => expect(screen.getByTestId('animal-breed-HF_CROSS')).toBeTruthy());
    fireEvent.press(screen.getByTestId('animal-breed-HF_CROSS'));
    fireEvent.changeText(screen.getByTestId('animal-ear-tag'), '4821');

    created = jsonResponse(
      { errors: { ear_tag_no: ['That ear tag is already registered.'] } },
      400,
    );
    takeHerPhoto();
    fireEvent.press(screen.getByTestId('animal-save'));

    await waitFor(() =>
      expect(screen.getByText('That ear tag is already registered.')).toBeTruthy(),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});

/**
 * A POST to the animals collection — the create, as opposed to the breed-list reads.
 *
 * RTK Query calls fetch with a Request object rather than a url and an init, so both the
 * method and the body have to be read off that.
 */
function isCreate(call: unknown[]): boolean {
  const [input, init] = call as [string | Request, RequestInit | undefined];
  const href = typeof input === 'string' ? input : input.url;
  const method = init?.method ?? (typeof input === 'string' ? 'GET' : input.method);
  return href.includes('/animals/') && method === 'POST';
}

async function createBody(): Promise<Record<string, unknown>> {
  const call = (global.fetch as jest.Mock).mock.calls.find(isCreate);
  const [input, init] = call as [string | Request, RequestInit | undefined];
  const raw = init?.body ?? (typeof input === 'string' ? undefined : await input.text());
  return JSON.parse(String(raw));
}
