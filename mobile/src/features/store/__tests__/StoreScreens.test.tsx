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

import IssueScreen, { mostThatCanGo } from '../IssueScreen';
import IssuedScreen from '../IssuedScreen';
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

  it('finds an indent by its number', async () => {
    mockApi(() => undefined);
    render();

    await waitFor(() => screen.getByTestId('store-indent-13'));
    fireEvent.press(screen.getByTestId('store-find'));
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
    fireEvent.press(screen.getByTestId('store-find'));
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
