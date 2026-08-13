/**
 * Waiting to sync (S7).
 *
 * The screen's job is to stop a Mait re-capturing work that was never lost, so what is
 * asserted is the reassurance and the one row that genuinely needs a person.
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import SyncQueueScreen, { toCaptures } from '../SyncQueueScreen';
import type { QueuedJob } from '@api/queue';
import { renderWithStore } from '@/test-utils';

function job(over: Partial<QueuedJob> & { clientUuid: string }): QueuedJob {
  return {
    id: over.clientUuid + '-job',
    kind: 'completeEvent',
    payload: { eventId: 5 },
    queuedAt: Date.now(),
    attempts: 0,
    ...over,
  } as QueuedJob;
}

const RADHA = job({
  clientUuid: 'radha',
  kind: 'verifyPayment',
  payload: { eventId: 9, mode: 'COD' },
  label: {
    farmer: 'Radha Singh',
    kind: 'nonMember',
    amount: '300.00',
    mode: 'COD',
    at: '9:20',
    eventId: 9,
  },
});

const KAVITA = job({
  clientUuid: 'kavita',
  label: { farmer: 'Kavita Devi', kind: 'member', at: '10:42', eventId: 5 },
});

describe('toCaptures', () => {
  it('groups jobs into one row per insemination', () => {
    const captures = toCaptures([
      KAVITA,
      job({ clientUuid: 'kavita', kind: 'attachPhoto', payload: { eventId: 5 } }),
    ]);

    expect(captures).toHaveLength(1);
    expect(captures[0]?.farmer).toBe('Kavita Devi');
  });

  it('puts what needs a person above what only needs a network', () => {
    const captures = toCaptures([KAVITA, RADHA]);

    expect(captures[0]?.farmer).toBe('Radha Singh');
    expect(captures[0]?.needsCode).toBe(true);
    expect(captures[1]?.needsCode).toBe(false);
  });
});

describe('SyncQueueScreen', () => {
  const onRetryAll = jest.fn();
  const onEnterCode = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(
    jobs: QueuedJob[],
    progress = null as null | { done: number; total: number },
  ) {
    return renderWithStore(
      <SyncQueueScreen
        captures={toCaptures(jobs)}
        synced={[]}
        progress={progress}
        onRetryAll={onRetryAll}
        onEnterCode={onEnterCode}
        onBack={jest.fn()}
      />,
    );
  }

  it('says nothing is lost, which is the whole point of the screen', () => {
    renderScreen([KAVITA, RADHA]);

    expect(screen.getByText('Nothing here is lost')).toBeTruthy();
    expect(screen.getByText(/2 records are on this phone\. One needs you\./)).toBeTruthy();
  });

  it('names the one record that cannot finish without the Mait', () => {
    renderScreen([KAVITA, RADHA]);

    expect(screen.getByText('Radha Singh')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Her payment code was never entered.')).toBeTruthy();
    // A non-member's row carries what was taken, because that is what is unconfirmed.
    expect(screen.getByText(/₹ 300 cash · 9:20/)).toBeTruthy();
  });

  it('offers an action on that row and on no other', () => {
    renderScreen([KAVITA, RADHA]);

    expect(screen.queryByTestId('queue-enter-code-kavita')).toBeNull();
    fireEvent.press(screen.getByTestId('queue-enter-code-radha'));

    expect(onEnterCode).toHaveBeenCalledWith(expect.objectContaining({ eventId: 9 }));
  });

  it('shows how far a send has got, so a slow one does not look stuck', () => {
    renderScreen([KAVITA, RADHA], { done: 2, total: 3 });

    expect(screen.getByText('Sending 2 of 3…')).toBeTruthy();
  });

  it('pushes everything again on request', () => {
    renderScreen([KAVITA, RADHA]);

    fireEvent.press(screen.getByTestId('queue-retry-all'));

    expect(onRetryAll).toHaveBeenCalled();
  });

  it('says so plainly when there is nothing waiting', () => {
    renderScreen([]);

    expect(screen.getByTestId('queue-empty')).toBeTruthy();
    expect(screen.queryByTestId('queue-retry-all')).toBeNull();
  });
});
