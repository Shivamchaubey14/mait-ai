/**
 * The store keeper's three screens.
 *
 * What is under test is what the keeper would act on wrongly if it were wrong: the word on a
 * row (*Ready*, *Short 7*, *Waiting 4d*), the number the stepper opens at, the flask check
 * holding the button, and the code on the handover screen — the one thing the Mait's side of
 * the handover depends on.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { StoreHandover, StoreHome, StoreIndent } from '@api/types';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';
import { colors } from '@theme/tokens';

import IssueScreen, { mostThatCanGo } from '../IssueScreen';
import IssuedScreen from '../IssuedScreen';
import StoreProfileScreen from '../StoreProfileScreen';
import StoreStockScreen from '../StoreStockScreen';
import ToIssueScreen, { matches } from '../ToIssueScreen';

function indent(overrides: Partial<StoreIndent> = {}): StoreIndent {
  return {
    id: 13,
    mait_name: 'Sunil Kumar',
    mait_code: '5500000054',
    product_type: 'straw',
    breed: 'MURRAH',
    product_ref_id: null,
    item_name: 'Murrah',
    item_name_hi: 'मुर्रा',
    unit: 'straw',
    qty_requested: 25,
    qty_issued: 0,
    qty_open: 25,
    in_store: 18,
    readiness: 'short',
    short_by: 7,
    waiting_days: 0,
    requested_at: '2026-08-18T09:00:00Z',
    approved_at: '2026-08-19T09:00:00Z',
    approved_by_name: 'Zonal manager',
    approved_by_zone: 'Mathura',
    note: '',
    ...overrides,
  };
}

function handover(overrides: Partial<StoreHandover> = {}): StoreHandover {
  return {
    id: 501,
    indent_id: 13,
    mait_name: 'Sunil Kumar',
    product_type: 'straw',
    breed: 'MURRAH',
    item_name: 'Murrah',
    item_name_hi: 'मुर्रा',
    qty: 18,
    qty_requested: 25,
    qty_open: 7,
    collection_code: '4729',
    flask_checked: true,
    issued_at: '2026-08-20T05:50:00Z',
    collected_at: null,
    cancelled_at: null,
    state: 'waiting',
    locked: false,
    ...overrides,
  };
}

const HOME: StoreHome = {
  store: { id: 1, code: 'BARSANA', name: 'Barsana depot', zone_name: 'Mathura', plant_names: [] },
  waiting: 5,
  ready: 2,
  short: 1,
  empty: 2,
  issued_today: 12,
  not_collected: 3,
};

const QUEUE = [
  indent(),
  indent({ id: 14, mait_name: 'Ramesh Yadav', readiness: 'ready', short_by: 0, in_store: 40 }),
  indent({ id: 11, mait_name: 'Devi Prasad', readiness: 'waiting', in_store: 0, waiting_days: 4 }),
];

type Route = (request: Request) => Response | undefined;

function mockApi(route: Route) {
  (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
    const answer = route(input);
    if (answer) {
      return answer;
    }
    const url = input.url;
    if (url.includes('/store/handovers/')) {
      return jsonResponse([handover()]);
    }
    if (url.includes('/store/indents/')) {
      return jsonResponse(QUEUE);
    }
    if (url.endsWith('/store/')) {
      return jsonResponse(HOME);
    }
    return jsonResponse({});
  });
}

beforeEach(() => {
  global.fetch = jest.fn() as jest.Mock;
});

afterEach(() => jest.resetAllMocks());

describe('ToIssueScreen', () => {
  const render = () =>
    renderWithStore(
      <ToIssueScreen
        storeName="Barsana depot"
        onOpenIndent={jest.fn()}
        onOpenHandover={jest.fn()}
      />,
    );

  it('answers what is waiting before a row is read', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => expect(screen.getByText('5 waiting · 1 short')).toBeTruthy());
    expect(screen.getByTestId('store-pill')).toHaveTextContent('Barsana depot');
    expect(screen.getByTestId('store-issued-today')).toHaveTextContent(/12/);
    expect(screen.getByTestId('store-not-collected')).toHaveTextContent(/3/);
  });

  it('says in one word what the shelf can do for each', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-indent-13'));
    expect(screen.getByTestId('store-indent-13-pill')).toHaveTextContent('Short 7');
    expect(screen.getByTestId('store-indent-14-pill')).toHaveTextContent('Ready');
    expect(screen.getByTestId('store-indent-11-pill')).toHaveTextContent('Waiting 4d');
    expect(screen.getByTestId('store-indent-13')).toHaveTextContent(/Sunil Kumar · 25 Murrah/);
  });

  it('colours every row by its shelf, and says in a sentence what the shelf can do', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-indent-13'));
    expect(screen.getByTestId('store-indent-14')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('store-indent-13')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('store-indent-11')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('store-indent-13')).toHaveTextContent(
      /The shelf has 18 of the 25 owed/,
    );
    expect(screen.getByTestId('store-indent-13')).toHaveTextContent(/Approved by Zonal manager/);
    expect(screen.getByTestId('store-indent-11')).toHaveTextContent(/Nothing on the shelf/);
    // Three figures, the first new: what the shelf can hand over right now.
    expect(screen.getByTestId('store-ready-now')).toHaveTextContent(/Ready now\s*2/);
  });

  it('finds an indent by its number', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-indent-13'));
    fireEvent.changeText(screen.getByTestId('store-find-input'), 'IND-14');

    expect(screen.queryByTestId('store-indent-13')).toBeNull();
    expect(screen.getByTestId('store-indent-14')).toBeTruthy();
  });

  it('lists what has not been collected, with the code to read out again', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-not-collected'));
    fireEvent.press(screen.getByTestId('store-not-collected'));

    await waitFor(() => expect(screen.getByTestId('store-handover-501')).toHaveTextContent(/4729/));
  });

  it('keeps every code still waiting at the top of the queue', async () => {
    mockApi(() => undefined);
    render();

    // Not behind the tile: a Mait who lost the code is read it again from the first screen.
    await waitFor(() => screen.getByTestId('store-codes'));
    expect(screen.getByTestId('store-handover-501-code')).toHaveTextContent('4729');
    expect(screen.getByTestId('store-indent-13')).toBeTruthy();
  });

  it('finds a waiting code by the Mait’s name', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-codes'));
    fireEvent.changeText(screen.getByTestId('store-find-input'), 'sunil');
    expect(screen.getByTestId('store-handover-501-code')).toHaveTextContent('4729');

    fireEvent.changeText(screen.getByTestId('store-find-input'), 'nobody');
    expect(screen.queryByTestId('store-codes')).toBeNull();
  });

  it('matches a Mait by name or by the indent number', () => {
    expect(matches(indent(), 'sunil')).toBe(true);
    expect(matches(indent(), 'IND-13')).toBe(true);
    expect(matches(indent(), '13')).toBe(true);
    expect(matches(indent(), 'IND-14')).toBe(false);
  });
});

describe('IssueScreen', () => {
  const onIssued = jest.fn();
  const onOpenHandover = jest.fn();
  const render = () =>
    renderWithStore(
      <IssueScreen
        indentId={13}
        onBack={jest.fn()}
        onIssued={onIssued}
        onOpenHandover={onOpenHandover}
      />,
    );

  it('shows a code already waiting on this indent, to read out again', async () => {
    mockApi(request =>
      request.url.endsWith('/store/indents/13/')
        ? jsonResponse(
            indent({
              qty_issued: 18,
              qty_open: 7,
              in_store: 0,
              readiness: 'waiting',
              waiting_handovers: [
                {
                  id: 501,
                  qty: 18,
                  collection_code: '4729',
                  issued_at: '2026-08-20T05:50:00Z',
                  locked: false,
                },
              ],
            }),
          )
        : undefined,
    );
    render();

    await waitFor(() => screen.getByTestId('issue-waiting-501'));
    expect(screen.getByTestId('issue-waiting-501')).toHaveTextContent(/4729/);
    expect(screen.getByTestId('issue-waiting-501')).toHaveTextContent(/18 Murrah issued at/);

    fireEvent.press(screen.getByTestId('issue-waiting-501'));
    expect(onOpenHandover).toHaveBeenCalledWith(501);
  });

  it('opens at the most the store can hand over', async () => {
    mockApi(request =>
      request.url.endsWith('/store/indents/13/') ? jsonResponse(indent()) : undefined,
    );
    render();

    await waitFor(() => expect(screen.getByTestId('issue-qty-value')).toHaveTextContent('18'));
    // The stepper cannot promise more than the shelf.
    expect(screen.getByTestId('issue-qty-more')).toBeDisabled();
    expect(screen.getByText('Approved 19 Aug by Zonal manager, Mathura')).toBeTruthy();
  });

  it('says the rest stays open, so the Mait does not raise it again', async () => {
    mockApi(request =>
      request.url.endsWith('/store/indents/13/') ? jsonResponse(indent()) : undefined,
    );
    render();

    await waitFor(() => screen.getByTestId('issue-rest'));
    expect(screen.getByTestId('issue-rest')).toHaveTextContent(
      'Store has 18. The remaining 7 stay open on IND-13 — the Mait does not have to raise it again.',
    );
    expect(screen.getByTestId('issue-after-holding')).toHaveTextContent('18 → 0');
    expect(screen.getByTestId('issue-after-open')).toHaveTextContent('7');
  });

  it('holds straws until the flask has been checked', async () => {
    mockApi(request =>
      request.url.endsWith('/store/indents/13/') ? jsonResponse(indent()) : undefined,
    );
    render();

    await waitFor(() => screen.getByTestId('issue-submit'));
    expect(screen.getByTestId('issue-submit')).toBeDisabled();
    expect(screen.getByTestId('issue-submit')).toHaveTextContent('Check the flask first');

    fireEvent.press(screen.getByTestId('issue-flask-switch'));
    expect(screen.getByTestId('issue-submit')).not.toBeDisabled();
    expect(screen.getByTestId('issue-submit')).toHaveTextContent(/Issue 18 Murrah/);
  });

  it('hands over what the stepper says, once, with a key', async () => {
    mockApi(request => {
      if (request.method === 'POST') {
        return jsonResponse(handover(), 201);
      }
      return request.url.endsWith('/store/indents/13/') ? jsonResponse(indent()) : undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('issue-flask-switch'));
    fireEvent.press(screen.getByTestId('issue-flask-switch'));
    fireEvent.press(screen.getByTestId('issue-qty-less'));
    fireEvent.press(screen.getByTestId('issue-submit'));

    await waitFor(() => expect(onIssued).toHaveBeenCalled());
    const post = (global.fetch as jest.Mock).mock.calls
      .map(([input]) => input as Request)
      .find(request => request.method === 'POST') as Request;
    expect(post.url).toMatch(/\/store\/indents\/13\/issue\/$/);
    expect(await post.clone().json()).toEqual({ qty: 17, flask_checked: true });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('shows the server’s reason when the shelf changed underneath', async () => {
    mockApi(request => {
      if (request.method === 'POST') {
        return problemResponse(409, 'store-stock-short', 'The store can hand over 10 of this now.');
      }
      return request.url.endsWith('/store/indents/13/') ? jsonResponse(indent()) : undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('issue-flask-switch'));
    fireEvent.press(screen.getByTestId('issue-flask-switch'));
    fireEvent.press(screen.getByTestId('issue-submit'));

    await waitFor(() =>
      expect(screen.getByText('The store can hand over 10 of this now.')).toBeTruthy(),
    );
  });

  it('has nothing to offer when the shelf is empty', async () => {
    mockApi(request =>
      request.url.endsWith('/store/indents/13/')
        ? jsonResponse(indent({ in_store: 0, readiness: 'waiting' }))
        : undefined,
    );
    render();

    await waitFor(() => screen.getByTestId('issue-none'));
    expect(screen.getByTestId('issue-submit')).toBeDisabled();
    expect(screen.queryByTestId('issue-flask')).toBeNull();
  });

  it('caps at whichever is smaller, what is owed or what is free', () => {
    expect(mostThatCanGo({ qty_open: 25, in_store: 18 })).toBe(18);
    expect(mostThatCanGo({ qty_open: 5, in_store: 40 })).toBe(5);
    expect(mostThatCanGo({ qty_open: 5, in_store: 0 })).toBe(0);
  });
});

describe('IssuedScreen', () => {
  it('reads the code back from the server when reopened with only an id', async () => {
    mockApi(request =>
      request.url.endsWith('/store/handovers/501/') ? jsonResponse(handover()) : undefined,
    );
    renderWithStore(<IssuedScreen handoverId={501} storeName="Barsana depot" onNext={jest.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId('issued-code-digits')).toHaveTextContent('4 7 2 9'),
    );
  });

  it('puts the code where it can be read across a counter', async () => {
    mockApi(request =>
      request.url.endsWith('/store/handovers/501/') ? jsonResponse(handover()) : undefined,
    );
    renderWithStore(
      <IssuedScreen
        handoverId={501}
        initial={handover()}
        storeName="Barsana depot"
        onNext={jest.fn()}
      />,
    );

    expect(screen.getByTestId('issued-code-digits')).toHaveTextContent('4 7 2 9');
    expect(screen.getByText('18 Murrah issued')).toBeTruthy();
    expect(screen.getByTestId('issued-waiting')).toBeTruthy();
    expect(screen.getByTestId('issued-still-open')).toHaveTextContent(/7 Murrah still open/);
    // Let the first poll land inside the test rather than after it.
    await act(async () => undefined);
  });

  it('turns green when the Mait types the code', async () => {
    mockApi(request =>
      request.url.endsWith('/store/handovers/501/')
        ? jsonResponse(handover({ state: 'collected', collected_at: '2026-08-20T05:54:00Z' }))
        : undefined,
    );
    renderWithStore(
      <IssuedScreen
        handoverId={501}
        initial={handover()}
        storeName="Barsana depot"
        onNext={jest.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('issued-collected')).toBeTruthy());
    expect(screen.queryByTestId('issued-waiting')).toBeNull();
    expect(screen.queryByTestId('issued-put-back')).toBeNull();
  });

  it('offers a new code once the old one is locked', async () => {
    const locked = handover({ locked: true });
    mockApi(request =>
      request.url.endsWith('/store/handovers/501/') ? jsonResponse(locked) : undefined,
    );
    renderWithStore(
      <IssuedScreen
        handoverId={501}
        initial={locked}
        storeName="Barsana depot"
        onNext={jest.fn()}
      />,
    );

    expect(screen.getByTestId('issued-locked')).toBeTruthy();
    expect(screen.getByTestId('issued-new-code')).toBeTruthy();
    await act(async () => undefined);
  });
});

/**
 * The delivery sheet.
 *
 * Three cards, one question each. What is under test is the answer the keeper is committing —
 * the figure and the item beside it — because that is the thing that is wrong if anything is,
 * and it used to be a loose stepper with nothing naming what it counted.
 */
describe('StoreStockScreen · record a delivery', () => {
  const CATALOGUE = {
    breeds: [
      { code: 'GIR', name: 'Gir', name_hi: 'गिर', animal_type: 'COW' },
      { code: 'HF_CROSS', name: 'HF Cross', name_hi: 'एचएफ क्रॉस', animal_type: 'COW' },
      { code: 'MURRAH', name: 'Murrah', name_hi: 'मुर्रा', animal_type: 'BUFF' },
    ],
    products: [{ id: 7, name: 'Gloves', unit: 'pair', category: 'consumable' as const }],
  };

  const STOCK = [
    {
      product_type: 'straw' as const,
      breed: 'MURRAH',
      product_ref_id: null,
      item_name: 'Murrah',
      item_name_hi: 'मुर्रा',
      unit: 'straw',
      on_hand: 40,
      set_aside: 18,
      available: 22,
    },
  ];

  const mockStock = (route: Route = () => undefined) =>
    mockApi(request => {
      const answer = route(request);
      if (answer) {
        return answer;
      }
      if (request.url.includes('/store/catalogue/')) {
        return jsonResponse(CATALOGUE);
      }
      if (request.url.includes('/store/stock/')) {
        return jsonResponse(STOCK);
      }
      return undefined;
    });

  const open = async () => {
    renderWithStore(<StoreStockScreen storeName="Barsana depot" />);
    await waitFor(() => screen.getByTestId('stock-record'));
    fireEvent.press(screen.getByTestId('stock-record'));
    await waitFor(() => screen.getByTestId('receive-sheet'));
  };

  it('groups the shelf by kind, each in its own colour', async () => {
    const shelf = [
      { ...STOCK[0]!, category: 'straw' as const },
      {
        product_type: 'consumable' as const,
        breed: '',
        product_ref_id: 7,
        item_name: 'Gloves',
        item_name_hi: '',
        unit: 'pair',
        on_hand: 0,
        set_aside: 0,
        available: 0,
        category: 'consumable' as const,
      },
    ];
    mockStock(request =>
      request.url.includes('/store/stock/') && !request.url.includes('receive')
        ? jsonResponse(shelf)
        : undefined,
    );
    renderWithStore(<StoreStockScreen storeName="Barsana depot" />);

    // Straws first — they are what the queue waits on — and only straws.
    await waitFor(() => screen.getByTestId('stock-section-straw'));
    expect(screen.queryByTestId('stock-section-consumable')).toBeNull();
    expect(screen.getByTestId('stock-section-straw')).toHaveTextContent(/Straws.*1 item · 40/);
    expect(screen.getByTestId('stock-line-MURRAH')).toHaveStyle({
      backgroundColor: colors.infoWash,
    });
    expect(screen.getByTestId('stock-line-MURRAH')).toHaveTextContent(/22 free to issue/);
    expect(screen.getByTestId('stock-line-MURRAH')).toHaveTextContent(/18 set aside/);
    expect(screen.getByTestId('stock-tile-straw')).toHaveTextContent(/Straws\s*40/);
    // A straw is a syringe, never a drop — a drop reads as milk on a dairy's app.
    expect(screen.getByTestId('stock-tile-straw')).toHaveTextContent(/needle/);
    expect(screen.getByTestId('stock-line-MURRAH')).toHaveTextContent(/needle/);
    expect(screen.getByTestId('stock-line-MURRAH')).not.toHaveTextContent(/water/);

    // A tile is the switch.
    fireEvent.press(screen.getByTestId('stock-tile-consumable'));
    await waitFor(() => screen.getByTestId('stock-section-consumable'));
    expect(screen.queryByTestId('stock-section-straw')).toBeNull();
    // None of it on the shelf is red, whatever its kind.
    expect(screen.getByTestId('stock-line-7')).toHaveStyle({ backgroundColor: colors.errorWash });

    // A kind the store holds none of still has its section, and says so.
    fireEvent.press(screen.getByTestId('stock-tile-asset'));
    expect(await screen.findByTestId('stock-section-asset-none')).toHaveTextContent(/No equipment/);
  });

  it('draws the delivery sheet in colour, every kind named whole', async () => {
    mockStock();
    await open();

    // Each kind a button of its own, the chosen one filled — not a strip that cut the words.
    expect(screen.getByTestId('receive-kind-consumable')).toHaveTextContent(/Consumables$/);
    expect(screen.getByTestId('receive-kind-straw')).toHaveStyle({ backgroundColor: colors.info });
    fireEvent.press(screen.getByTestId('receive-kind-consumable'));
    expect(screen.getByTestId('receive-kind-consumable')).toHaveStyle({
      backgroundColor: colors.primary,
    });
    expect(screen.getByTestId('receive-kind-straw')).toHaveStyle({
      backgroundColor: colors.surface,
    });
  });

  it('records equipment as a catalogue product', async () => {
    const sent: Request[] = [];
    mockStock(request => {
      if (request.url.includes('/store/catalogue/')) {
        return jsonResponse({
          ...CATALOGUE,
          products: [
            ...CATALOGUE.products,
            { id: 9, name: 'AI gun', unit: 'piece', category: 'asset' as const },
          ],
        });
      }
      if (request.url.includes('/store/stock/receive/')) {
        sent.push(request.clone());
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    await open();

    fireEvent.press(screen.getByTestId('receive-kind-asset'));
    fireEvent.press(await screen.findByTestId('receive-item-9'));
    // Gloves are a consumable, not equipment.
    expect(screen.queryByTestId('receive-item-7')).toBeNull();
    fireEvent.press(screen.getByTestId('receive-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    const body = await sent[0]!.json();
    expect(body.product_type).toBe('consumable');
    expect(body.product_ref_id).toBe(9);
  });

  it('names the shelf it is writing onto', async () => {
    mockStock();
    await open();

    expect(screen.getByTestId('receive-sheet')).toHaveTextContent(/Onto Barsana depot.s shelf/);
  });

  it('shows the figure with the item beside it once one is picked', async () => {
    mockStock();
    await open();

    // Before anything is picked the figure stands alone, and the button says to pick.
    expect(screen.getByTestId('receive-qty-figure')).toHaveTextContent('10');
    expect(screen.getByTestId('receive-qty-figure')).not.toHaveTextContent('Murrah');

    fireEvent.press(screen.getByTestId('receive-animal-BUFF'));
    fireEvent.press(await screen.findByTestId('receive-item-MURRAH'));
    expect(screen.getByTestId('receive-qty-figure')).toHaveTextContent(/10\s+Murrah/);
  });

  it('sets the count from a quick jump, and from the stepper', async () => {
    mockStock();
    await open();

    fireEvent.press(screen.getByTestId('receive-qty-50'));
    expect(screen.getByTestId('receive-qty-figure')).toHaveTextContent('50');

    fireEvent.press(screen.getByTestId('receive-qty-more'));
    expect(screen.getByTestId('receive-qty-value')).toHaveTextContent('51');
  });

  it('records the delivery against the picked item', async () => {
    // The body is read off a clone: the request itself is consumed by the client.
    const sent: Request[] = [];
    mockStock(request => {
      if (request.url.includes('/store/stock/receive/')) {
        sent.push(request.clone());
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    await open();

    fireEvent.press(await screen.findByTestId('receive-item-GIR'));
    fireEvent.press(screen.getByTestId('receive-qty-25'));
    fireEvent.press(screen.getByTestId('receive-save'));

    await waitFor(() => expect(sent).toHaveLength(1));
    const [request] = sent;
    const body = JSON.parse(await request!.text());
    expect(body).toMatchObject({ product_type: 'straw', breed: 'GIR', qty: 25 });
  });

  it('shows one animal’s breeds at a time', async () => {
    mockStock();
    await open();

    // Cow first, so a keeper is not reading seventeen chips to find one.
    await screen.findByTestId('receive-item-GIR');
    expect(screen.getByTestId('receive-item-HF_CROSS')).toBeTruthy();
    expect(screen.queryByTestId('receive-item-MURRAH')).toBeNull();

    fireEvent.press(screen.getByTestId('receive-animal-BUFF'));
    expect(screen.getByTestId('receive-item-MURRAH')).toBeTruthy();
    expect(screen.queryByTestId('receive-item-GIR')).toBeNull();
  });

  it('forgets a breed picked under the other animal', async () => {
    mockStock();
    await open();

    fireEvent.press(await screen.findByTestId('receive-item-GIR'));
    expect(screen.getByTestId('receive-qty-figure')).toHaveTextContent(/Gir/);

    // Otherwise the sheet would record a cow breed while reading Buffalo.
    fireEvent.press(screen.getByTestId('receive-animal-BUFF'));
    expect(screen.getByTestId('receive-qty-figure')).not.toHaveTextContent(/Gir/);
    expect(screen.getByTestId('receive-save')).toBeDisabled();
  });

  it('says so when the office has configured no breed for an animal', async () => {
    mockApi(request => {
      if (request.url.includes('/store/catalogue/')) {
        return jsonResponse({ breeds: [], products: [] });
      }
      if (request.url.includes('/store/stock/')) {
        return jsonResponse(STOCK);
      }
      return undefined;
    });
    await open();

    expect(await screen.findByTestId('receive-no-options')).toBeTruthy();
  });

  it('offers consumables without an animal step', async () => {
    mockStock();
    await open();

    fireEvent.press(screen.getByTestId('receive-kind-consumable'));
    expect(screen.queryByTestId('receive-animal-COW')).toBeNull();
    expect(await screen.findByTestId('receive-item-7')).toBeTruthy();
  });
});

describe('StoreProfileScreen', () => {
  it('leads with the counter’s day, then the store and the places it serves, a colour each', async () => {
    mockApi(request =>
      request.url.endsWith('/store/')
        ? jsonResponse({
            ...HOME,
            store: { ...HOME.store, plant_names: ['BARSANA BMC', 'NANDGAON BMC'] },
          })
        : undefined,
    );
    renderWithStore(<StoreProfileScreen />);

    await waitFor(() => expect(screen.getByTestId('profile-waiting')).toHaveTextContent(/5/));
    expect(screen.getByTestId('profile-ready')).toHaveTextContent(/2\s*Ready now/);
    expect(screen.getByTestId('profile-issued')).toHaveTextContent(/12/);
    expect(screen.getByTestId('profile-not-collected')).toHaveTextContent(/3/);

    expect(screen.getByTestId('profile-store')).toHaveTextContent(/Barsana depot/);
    expect(screen.getByTestId('profile-store')).toHaveTextContent(/BARSANA/);
    expect(screen.getByTestId('profile-store')).toHaveTextContent(/Mathura/);
    expect(screen.getByTestId('profile-serves')).toHaveTextContent(/BARSANA BMC.*NANDGAON BMC/);

    expect(screen.getByTestId('profile-today')).toHaveStyle({ backgroundColor: colors.infoWash });
    expect(screen.getByTestId('profile-store')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('profile-serves')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
  });
});
