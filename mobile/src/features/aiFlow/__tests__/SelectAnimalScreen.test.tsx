/**
 * Animal selection tests (SRS §6.3 step 3, C6).
 *
 * The cases that matter are the ones a Mait hits in a yard: two untagged cows that have to be
 * told apart, a buffalo household whose animals must not be hidden behind a Cow tab, and a
 * species switch that cannot leave a cow selected while the list shows buffaloes.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectAnimalScreen from '../SelectAnimalScreen';
import type { Animal } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

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
      <SelectAnimalScreen owner={OWNER} animals={animals} onSelect={onSelect} onBack={onBack} />,
    );
  }

  it('says how many the farmer has on record', () => {
    renderScreen([TAGGED, UNTAGGED]);

    expect(screen.getByText('KAVITA DEVI has 2 on record.')).toBeTruthy();
  });

  it('tells one cow from another by tag, and by when she was last served', async () => {
    renderScreen([TAGGED, UNTAGGED]);

    await waitFor(() => expect(screen.getByText('Cow · tag 4821')).toBeTruthy());
    expect(screen.getByText('Cow · no tag')).toBeTruthy();
    // The breed code resolves to its label once the breed list lands.
    expect(screen.getByText('Last AI 14 Mar 2026 · HF Cross')).toBeTruthy();
    expect(screen.getByText('Last AI 2 Jan 2026 · Sahiwal')).toBeTruthy();
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
  });

  it('shows the empty list and its add card, never a form the Mait did not ask for', () => {
    renderScreen([]);

    expect(screen.getByTestId('animal-none-of-type')).toBeTruthy();
    expect(screen.getByTestId('animal-add-card')).toBeTruthy();
    // The list is not a form: nothing to type into until the Mait says they are adding one.
    expect(screen.queryByTestId('animal-ear-tag')).toBeNull();
  });

  it('asks only what a Mait can see — species and tag, no breed', () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));

    expect(screen.getByTestId('animal-ear-tag')).toBeTruthy();
    expect(screen.getByTestId('animal-type-COW')).toBeTruthy();
    // The breed asked for later in the flow is the straw's, and it is a different screen.
    expect(screen.queryByTestId('breed-HF_CROSS')).toBeNull();
  });

  it('registers a new animal with the species the toggle is on', async () => {
    renderScreen([TAGGED]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.press(screen.getByTestId('animal-type-BUFF'));

    created = jsonResponse(animal({ id: 9, animal_type: 'BUFF' }), 201);
    fireEvent.press(screen.getByTestId('animal-save'));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 9 })));
    const body = await createBody();
    expect(body).toMatchObject({ member_code: OWNER.memberCode, animal_type: 'BUFF' });
    expect(body.breed).toBeUndefined();
  });

  it('says which box to fix when the server rejects the ear tag', async () => {
    renderScreen([]);

    fireEvent.press(screen.getByTestId('animal-add-card'));
    fireEvent.changeText(screen.getByTestId('animal-ear-tag'), '4821');

    created = jsonResponse(
      { errors: { ear_tag_no: ['That ear tag is already registered.'] } },
      400,
    );
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
