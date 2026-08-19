/**
 * Raise an indent (M18).
 *
 * What is defended here is the reading of the list rather than the form mechanics. A Mait
 * sends this to a store where nobody can ask them what they meant, so the two failure modes
 * are both silent: a screen that says it is ready when a line is still unanswered, and a
 * folded row that names the wrong thing or the wrong amount.
 *
 * The unit totals get their own test because they are the one number a store reads first,
 * and adding straws to litres would produce a total that is true of nothing.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import RequestStockScreen from '../RequestStockScreen';
import { jsonResponse, renderWithStore } from '@/test-utils';

const BREEDS = [
  { code: 'HF_CROSS', name: 'HF Cross', name_hi: '', animal_type: 'COW', display_order: 1 },
  { code: 'MURRAH', name: 'Murrah', name_hi: '', animal_type: 'BUFF', display_order: 2 },
];

const PRODUCTS = [
  {
    id: 3,
    code: 'LN2',
    name: 'Liquid nitrogen',
    category: 'consumable',
    category_display: 'Consumable',
    unit: 'litre',
    display_order: 1,
  },
  {
    id: 4,
    code: 'AI_GUN',
    name: 'AI gun',
    category: 'asset',
    category_display: 'Equipment',
    unit: 'piece',
    display_order: 2,
  },
];

const SUMMARY = {
  total_straws: 12,
  is_low_stock: true,
  by_breed: { HF_CROSS: 8, MURRAH: 4 },
  straws: [],
  consumables: [],
  assets: [],
};

/** Two MPPs reporting into one plant — the ordinary case, and the one that names the store. */
function mpp(id: number, code: string, plantName = 'BARSANA') {
  return {
    id,
    mpp_code: code,
    mpp_name: `${code} MPP`,
    plant_code: '2001',
    plant_name: plantName,
    district_code: '01',
    tehsil_code: '01',
    village_code: '01',
    mobile_no: '',
    is_active: true,
    mait: 1,
    mait_name: 'Rohit Kumar',
    member_count: 100,
  };
}

function mockApi(mpps = [mpp(1, '001302'), mpp(2, '001308')]) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/config/breeds/')) {
      return jsonResponse(BREEDS);
    }
    if (url.includes('/config/products/')) {
      return jsonResponse(PRODUCTS);
    }
    if (url.includes('/mpp/')) {
      return jsonResponse({ count: mpps.length, next: null, previous: null, results: mpps });
    }
    if (url.includes('/indents/')) {
      return jsonResponse({ id: 1 }, 201);
    }
    return jsonResponse(SUMMARY);
  });
}

function render() {
  return renderWithStore(<RequestStockScreen onDone={jest.fn()} />);
}

/** Opens the picker on the given line and taps one of its options. */
async function choose(lineIndex: number, label: string) {
  fireEvent.press(screen.getByTestId(`indent-prod-${lineIndex}`));
  fireEvent.press(await screen.findByText(label));
}

describe('RequestStockScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('carries the mark, so a phone handed to a farmer says whose app it is', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByText('MAIT AI')).toBeTruthy());
  });

  it('starts on one open line and will not send it unanswered', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());

    // The straw count is knowable before the breed is, so the total is already honest.
    expect(screen.getByTestId('indent-count')).toHaveTextContent('1 line · 25 straws');
    // And the reason the button is grey names the line rather than saying "finish each line".
    expect(screen.getByTestId('indent-state')).toHaveTextContent('Choose a breed to finish line 1');
    expect(screen.getByTestId('indent-submit')).toBeDisabled();
  });

  it('keeps the line open after the breed is chosen, so the quantity can still be set', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');

    // Still a form: the stepper is the next thing a Mait reaches for.
    await waitFor(() => expect(screen.getByTestId('indent-plus-0')).toBeTruthy());
    fireEvent.press(screen.getByTestId('indent-plus-0'));

    expect(screen.getByTestId('indent-count')).toHaveTextContent('1 line · 30 straws');
  });

  it('folds a finished line down to what it is and how much', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');
    fireEvent.press(await screen.findByTestId('indent-done-0'));

    const row = await screen.findByTestId('indent-row-0');
    expect(row).toHaveTextContent(/Murrah/);
    // Species rather than the breed code: the breed is already the name above it.
    expect(row).toHaveTextContent(/Straws · buffalo/);
    expect(row).toHaveTextContent(/25straws/);
  });

  it('counts each unit on its own, because straws and litres do not add up', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');
    fireEvent.press(await screen.findByTestId('indent-done-0'));

    fireEvent.press(screen.getByTestId('indent-add-line'));
    fireEvent.press(await screen.findByTestId('indent-cat-consumable-1'));
    await choose(1, 'Liquid nitrogen');
    fireEvent.changeText(screen.getByTestId('indent-qty-1'), '10');

    await waitFor(() =>
      expect(screen.getByTestId('indent-count')).toHaveTextContent(
        '2 lines · 25 straws · 10 litres',
      ),
    );
  });

  it('names the store the indent goes to once every line is answered', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');

    // Read back as a place rather than the shout SAP stores it as.
    await waitFor(() =>
      expect(screen.getByTestId('indent-state')).toHaveTextContent('Barsana store'),
    );
    expect(screen.getByTestId('indent-submit')).not.toBeDisabled();
  });

  it('says nothing about a store when the MPPs report into more than one', async () => {
    mockApi([mpp(1, '001302', 'BARSANA'), mpp(2, '001308', 'AKBARPUR')]);
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');

    // A destination guessed from the first row would be wrong for the other village.
    await waitFor(() =>
      expect(screen.getByTestId('indent-state')).toHaveTextContent('Ready to send'),
    );
  });

  it('warns that approval is not issue, once there is something to send', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    expect(screen.queryByTestId('indent-approval-note')).toBeNull();

    await choose(0, 'Murrah');

    await waitFor(() => expect(screen.getByTestId('indent-approval-note')).toBeTruthy());
  });

  it('posts one indent per line, each with its own idempotency key', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByTestId('indent-prod-0')).toBeTruthy());
    await choose(0, 'Murrah');
    fireEvent.press(await screen.findByTestId('indent-done-0'));

    fireEvent.press(screen.getByTestId('indent-add-line'));
    fireEvent.press(await screen.findByTestId('indent-cat-consumable-1'));
    await choose(1, 'Liquid nitrogen');

    fireEvent.press(screen.getByTestId('indent-submit'));
    fireEvent.press(await screen.findByTestId('indent-confirm'));

    await waitFor(() => expect(screen.getByTestId('indent-sent')).toBeTruthy());

    const posts = (global.fetch as jest.Mock).mock.calls
      .map(([input]) => input as Request)
      .filter(request => request.method === 'POST');
    expect(posts).toHaveLength(2);

    const bodies = await Promise.all(posts.map(request => request.clone().json()));
    expect(bodies[0]).toMatchObject({ product_type: 'straw', breed: 'MURRAH', qty_requested: 25 });
    // A consumable travels by catalogue id — the code alone cannot name it at the depot.
    expect(bodies[1]).toMatchObject({ product_type: 'consumable', product_ref_id: 3 });

    const keys = posts.map(request => request.headers.get('Idempotency-Key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toEqual(keys[1]);
  });
});
