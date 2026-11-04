/**
 * Needs attention — everything on the Mait's phone that will not sort itself out.
 *
 * What matters: every kind of thing that needs the Mait is on it, in the server's own words
 * where the server refused something; a flagged office code — which nothing used to show — is
 * there with what to do about it; each row goes where the Mait deals with it; and what only
 * needs signal is one quiet line rather than a list of alarms.
 */

import React from 'react';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Provider } from 'react-redux';

import NeedsAttentionScreen, { useNeedsAttention, type Attention } from '../NeedsAttentionScreen';
import type { QueuedCapture } from '@/features/history/SyncQueueScreen';
import type { AIEvent } from '@api/types';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';

function capture(over: Partial<QueuedCapture>): QueuedCapture {
  return {
    clientUuid: 'uuid-1',
    farmer: 'Kavita Devi',
    kind: 'member',
    at: '10:42',
    needsCode: false,
    sending: false,
    ...over,
  };
}

function event(over: Partial<AIEvent>): AIEvent {
  return {
    id: 1,
    client_uuid: 'e-1',
    status: 'completed',
    owner_name: 'Sunita Yadav',
    mpp_name: 'Barsana',
    created_at: '2026-10-27T09:00:00Z',
    performed_at: '2026-10-27T09:30:00Z',
    ...over,
  } as AIEvent;
}

function attention(over: Partial<Attention> = {}): Attention {
  const base = {
    refused: [],
    needsCode: [],
    unmatched: [],
    unfinished: [],
    waiting: 0,
    isFetching: false,
    refetch: jest.fn(),
    ...over,
  };
  return {
    ...base,
    total:
      base.refused.length + base.needsCode.length + base.unmatched.length + base.unfinished.length,
  };
}

const handlers = () => ({
  onOpenQueue: jest.fn(),
  onEnterCode: jest.fn(),
  onResume: jest.fn(),
  onOpenEvent: jest.fn(),
  onBack: jest.fn(),
});

describe('NeedsAttentionScreen', () => {
  it('says nothing needs the Mait when nothing does', () => {
    renderWithStore(<NeedsAttentionScreen attention={attention()} {...handlers()} />);
    expect(screen.getByTestId('attention-empty')).toBeTruthy();
  });

  it('shows a refusal in the server’s own words, and takes it to the waiting list', () => {
    const on = handlers();
    renderWithStore(
      <NeedsAttentionScreen
        attention={attention({
          refused: [capture({ rejected: 'This animal is not registered to that farmer.' })],
        })}
        {...on}
      />,
    );

    const row = screen.getByTestId('attention-refused-uuid-1');
    expect(row).toHaveTextContent(/not registered to that farmer/);
    fireEvent.press(row);
    expect(on.onOpenQueue).toHaveBeenCalled();
  });

  it('shows a capture checked with a code the office never gave, and opens it', () => {
    const on = handlers();
    renderWithStore(
      <NeedsAttentionScreen attention={attention({ unmatched: [event({ id: 44 })] })} {...on} />,
    );

    expect(screen.getByTestId('attention-unmatched')).toHaveTextContent(/call the office/i);
    fireEvent.press(screen.getByTestId('attention-unmatched-44'));
    expect(on.onOpenEvent).toHaveBeenCalledWith(44);
  });

  it('takes a payment code still owed back to where it is entered', () => {
    const on = handlers();
    const owed = capture({ needsCode: true, amount: '300.00' });
    renderWithStore(<NeedsAttentionScreen attention={attention({ needsCode: [owed] })} {...on} />);

    expect(screen.getByTestId('attention-code-uuid-1')).toHaveTextContent(/₹300.00/);
    fireEvent.press(screen.getByTestId('attention-code-uuid-1'));
    expect(on.onEnterCode).toHaveBeenCalledWith(owed);
  });

  it('picks an unfinished capture up where it stopped', () => {
    const on = handlers();
    const stopped = event({ id: 9, status: 'straw_verified' });
    renderWithStore(
      <NeedsAttentionScreen attention={attention({ unfinished: [stopped] })} {...on} />,
    );

    fireEvent.press(screen.getByTestId('attention-unfinished-9'));
    expect(on.onResume).toHaveBeenCalledWith(stopped);
  });

  it('keeps what only needs signal to one quiet line', () => {
    renderWithStore(<NeedsAttentionScreen attention={attention({ waiting: 3 })} {...handlers()} />);

    expect(screen.getByTestId('attention-waiting-row')).toHaveTextContent(
      /3 records waiting for signal/,
    );
    // Waiting is not something that needs the Mait.
    expect(screen.getByTestId('attention-empty')).toBeTruthy();
  });
});

describe('useNeedsAttention', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: string | Request) => {
      const href = typeof input === 'string' ? input : input.url;
      if (href.includes('farmer_check=office_call_unmatched')) {
        return jsonResponse({ count: 1, results: [event({ id: 44 })] });
      }
      if (href.includes('unfinished=true')) {
        return jsonResponse({ count: 1, results: [event({ id: 9, status: 'straw_verified' })] });
      }
      return jsonResponse({ count: 0, results: [] });
    }) as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('counts the phone’s queue and the server’s two answers, but not what only needs signal', async () => {
    const store = makeStore();
    const queue = [
      capture({ clientUuid: 'a', rejected: 'No.' }),
      capture({ clientUuid: 'b', needsCode: true }),
      capture({ clientUuid: 'c' }),
    ];
    const { result } = renderHook(() => useNeedsAttention(queue), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(result.current.total).toBe(4));
    expect(result.current.waiting).toBe(1);
    expect(result.current.unmatched.map(row => row.id)).toEqual([44]);
  });

  it('asks the server nothing for an account that is not a Mait', () => {
    const store = makeStore();
    renderHook(() => useNeedsAttention([], true), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
