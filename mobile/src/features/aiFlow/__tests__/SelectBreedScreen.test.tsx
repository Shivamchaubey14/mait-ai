/**
 * Straw-breed selection tests (SRS §6.3 step 4, C7).
 *
 * This is how a straw is named now — by breed and by nothing else, because reading the number
 * printed on one means lifting the goblet out of the liquid nitrogen and warming everything
 * in it. So the cases that matter are about stock: a breed the flask is empty of cannot be
 * chosen, cannot be hidden, and cannot open an event.
 *
 * It is also the step that commits, so what it sends is asserted rather than assumed.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectBreedScreen from '../SelectBreedScreen';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

const BREEDS = [
  { code: 'HF_CROSS', name: 'HF Cross', name_hi: '', animal_type: 'COW', display_order: 1 },
  { code: 'SAHIWAL', name: 'Sahiwal', name_hi: '', animal_type: 'COW', display_order: 2 },
  { code: 'GIR', name: 'Gir', name_hi: '', animal_type: 'COW', display_order: 3 },
];

/** What POST /ai-events/ answers, when a test gets that far. */
let created: Response | null = null;

function mockApi(byBreed: Record<string, number>) {
  created = null;
  sentBody = null;
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const href = typeof input === 'string' ? input : input.url;
    if (href.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    if (href.includes('/ai-events/')) {
      return created ?? jsonResponse({ id: 51, status: 'straw_verified' }, 201);
    }
    return jsonResponse({
      total_straws: Object.values(byBreed).reduce((sum, n) => sum + n, 0),
      is_low_stock: false,
      by_breed: byBreed,
      consumables: [],
      assets: [],
    });
  });
}

/**
 * What the event was opened with.
 *
 * Read once and cached: RTK Query calls fetch with a Request, and a Request body can only be
 * consumed a single time — a second reader gets "Body is unusable".
 */
let sentBody: Record<string, unknown> | null = null;

async function createdBody(): Promise<Record<string, unknown>> {
  if (sentBody) {
    return sentBody;
  }
  const call = (global.fetch as jest.Mock).mock.calls.find(([input]) => {
    const href = typeof input === 'string' ? input : input.url;
    return href.includes('/ai-events/');
  });
  const [input, init] = call as [string | Request, RequestInit | undefined];
  const raw = init?.body ?? (typeof input === 'string' ? undefined : await input.text());
  sentBody = JSON.parse(String(raw));
  return sentBody as Record<string, unknown>;
}

const CAPTURE = {
  clientUuid: '11111111-1111-4111-8111-111111111111',
  mppCode: '001303',
  memberCode: '0906167700010001',
  animalId: 7,
};

describe('SelectBreedScreen', () => {
  const onCreated = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen(suggestedBreed?: string | null) {
    return renderWithStore(
      <SelectBreedScreen
        animalType="COW"
        suggestedBreed={suggestedBreed}
        capture={CAPTURE}
        onCreated={onCreated}
        onBack={onBack}
      />,
    );
  }

  it('says how many straws of each breed the Mait is carrying', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('18 straws with you')).toBeTruthy());
    expect(screen.getByText('12 straws with you')).toBeTruthy();
  });

  it('warns on a breed that is nearly out rather than only when it is gone', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 2 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('2 straws with you')).toBeTruthy());
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('shows a breed with no straws, blocked, instead of hiding it', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('Gir')).toBeTruthy());
    expect(screen.getByText('None in your stock')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();

    fireEvent.press(screen.getByTestId('breed-GIR'));
    fireEvent.press(screen.getByTestId('breed-continue'));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('opens the event against the chosen breed, with no straw number anywhere in it', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('breed-SAHIWAL')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-SAHIWAL'));
    fireEvent.press(screen.getByTestId('breed-continue'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((await createdBody()).semen_breed).toBe('SAHIWAL');

    // Nobody opened the flask, so nobody read a number to send.
    expect(Object.keys(await createdBody())).not.toContain('straw_unique_no');
  });

  it('says so when the last straw of a breed went while the screen was open', async () => {
    mockApi({ SAHIWAL: 1 });
    renderScreen('SAHIWAL');

    await waitFor(() => expect(screen.getByText('1 straw with you')).toBeTruthy());
    created = problemResponse(409, 'insufficient-stock');
    fireEvent.press(screen.getByTestId('breed-continue'));

    await waitFor(() => expect(screen.getByTestId('breed-rejected')).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('puts what the Mait has most of first, whatever order the catalogue is in', async () => {
    mockApi({ HF_CROSS: 4, SAHIWAL: 20 });
    renderScreen();

    await waitFor(() => expect(screen.getByText('Sahiwal')).toBeTruthy());
    const order = screen.getAllByText(/HF Cross|Sahiwal|Gir/).map(node => node.props.children);

    expect(order).toEqual(['Sahiwal', 'HF Cross', 'Gir']);
  });

  it('opens already answered with the animal’s own breed', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen('SAHIWAL');

    // No tap on a row: the step arrives answered, and agreeing is one tap on Continue.
    await waitFor(() => expect(screen.getByText('12 straws with you')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-continue'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((await createdBody()).semen_breed).toBe('SAHIWAL');
  });

  it('is a default, not a decision', async () => {
    mockApi({ HF_CROSS: 18, SAHIWAL: 12 });
    renderScreen('SAHIWAL');

    await waitFor(() => expect(screen.getByTestId('breed-HF_CROSS')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-HF_CROSS'));
    fireEvent.press(screen.getByTestId('breed-continue'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((await createdBody()).semen_breed).toBe('HF_CROSS');
  });

  it('answers nothing when the flask holds none of her breed', async () => {
    mockApi({ HF_CROSS: 18 });
    renderScreen('SAHIWAL');

    await waitFor(() => expect(screen.getByTestId('breed-SAHIWAL')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-continue'));

    // A blocked breed cannot be the answer, and no other breed may be chosen on her behalf.
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says the round cannot go ahead when the flask is empty', async () => {
    mockApi({});
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('breed-no-stock')).toBeTruthy());
    fireEvent.press(screen.getByTestId('breed-continue'));
    expect(onCreated).not.toHaveBeenCalled();
  });
});
