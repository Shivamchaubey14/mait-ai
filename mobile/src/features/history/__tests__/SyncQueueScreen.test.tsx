/**
 * Waiting to sync (S7).
 *
 * The screen's job is to stop a Mait re-capturing work that was never lost, so what is
 * asserted is the reassurance and the one row that genuinely needs a person.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import SyncQueueScreen, { toCaptures } from '../SyncQueueScreen';
import type { SyncSummary } from '../SyncQueueScreen';
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
  it('asks no code of a member, whose charge comes off her milk', () => {
    const [amaravti] = toCaptures([
      job({
        clientUuid: 'amaravti',
        kind: 'verifyPayment',
        payload: { eventId: null },
        label: { farmer: 'Amaravti Devi', kind: 'member', amount: '100.00', at: '16:30' },
      }),
    ]);
    expect(amaravti!.needsCode).toBe(false);
  });

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

  it('marks only the capture actually on the wire as sending', () => {
    const captures = toCaptures([KAVITA, RADHA], 'kavita');

    expect(captures.find(c => c.clientUuid === 'kavita')?.sending).toBe(true);
    expect(captures.find(c => c.clientUuid === 'radha')?.sending).toBe(false);
  });

  it('marks nothing as sending when no drain is running', () => {
    expect(toCaptures([KAVITA, RADHA]).every(c => !c.sending)).toBe(true);
  });

  // The photo is queued before the payment has a mode, so the earliest job knows the least.
  // Reading the whole row off it reported a UPI payment as cash for the rest of the day.
  it('takes each fact from the first job that actually carries it', () => {
    const captures = toCaptures([
      job({
        clientUuid: 'laxmi',
        kind: 'attachPhoto',
        payload: { eventId: 12 },
        label: { farmer: 'Laxmi Devi', kind: 'nonMember', at: '9:26' },
      }),
      job({
        clientUuid: 'laxmi',
        kind: 'verifyPayment',
        payload: { eventId: 12, mode: 'ONLINE' },
        label: {
          farmer: 'Laxmi Devi',
          kind: 'nonMember',
          amount: '300.00',
          mode: 'ONLINE',
          at: '9:31',
          eventId: 12,
        },
      }),
    ]);

    expect(captures).toHaveLength(1);
    // The time the capture happened, from the first job — not the later one.
    expect(captures[0]?.at).toBe('9:26');
    // The mode, which only the later job knew.
    expect(captures[0]?.mode).toBe('ONLINE');
    expect(captures[0]?.amount).toBe('300.00');
  });
});

describe('SyncQueueScreen', () => {
  const onRetryAll = jest.fn();
  const onRetryCapture = jest.fn();
  const onDiscardCapture = jest.fn();
  const onEnterCode = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(
    jobs: QueuedJob[],
    progress = null as null | { done: number; total: number },
    sendingUuid: string | null = null,
  ) {
    return renderWithStore(
      <SyncQueueScreen
        captures={toCaptures(jobs, sendingUuid)}
        synced={[]}
        progress={progress}
        onRetryAll={onRetryAll}
        onRetryCapture={onRetryCapture}
        onDiscardCapture={onDiscardCapture}
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

  // The regression this screen was reported for: a member's capture queues no payment, and
  // nothing else attached a label, so the row read "Capture · Member · Waiting" — the one
  // thing a list that promises "nothing here is lost" cannot say to someone hunting a record.
  it('names the farmer on a member row rather than falling back to "Capture"', () => {
    renderScreen([KAVITA]);

    expect(screen.getByText('Kavita Devi')).toBeTruthy();
    expect(screen.queryByText('Capture')).toBeNull();
    expect(screen.getByText('Member · 10:42')).toBeTruthy();
  });

  it('drops the dangling separator when a capture was queued without its time', () => {
    renderScreen([
      job({ clientUuid: 'no-clock', label: { farmer: 'Sunita Yadav', kind: 'member', at: '' } }),
    ]);

    expect(screen.getByText('Member')).toBeTruthy();
  });

  it('says a queued record is waiting, and only calls syncing what is being sent', () => {
    // The whole list used to read "Syncing" whether anything was moving or not, which is a
    // claim a Mait can watch fail: three rows all sending, and the count never changing.
    renderScreen([KAVITA, RADHA], { done: 1, total: 2 }, 'kavita');

    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.queryByText('Waiting for signal')).toBeNull();
  });

  it('calls nothing syncing when no drain is running', () => {
    renderScreen([KAVITA]);

    expect(screen.getByText('Waiting for signal')).toBeTruthy();
    expect(screen.queryByText('Sending')).toBeNull();
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

  /** The screen with a finished-sync summary, as the navigator passes it after "Try all again". */
  function renderWithSummary(summary: SyncSummary, progress = null as null | { done: number; total: number }) {
    return renderWithStore(
      <SyncQueueScreen
        captures={[]}
        synced={[]}
        progress={progress}
        summary={summary}
        onRetryAll={onRetryAll}
        onRetryCapture={onRetryCapture}
        onDiscardCapture={onDiscardCapture}
        onEnterCode={onEnterCode}
        onBack={jest.fn()}
      />,
    );
  }

  it('reports the finished sync in records, agreeing with the list', () => {
    renderWithSummary({ sent: 21, remaining: 3 });

    expect(screen.getByTestId('queue-summary')).toBeTruthy();
    expect(screen.getByText('Sync finished')).toBeTruthy();
    expect(screen.getByText('21 sent · 3 still waiting')).toBeTruthy();
  });

  it('counts records, not the jobs a record is made of — one record reads as one', () => {
    // The reported bug: a capture of two jobs read "2 still waiting" over a list of one record.
    renderWithSummary({ sent: 0, remaining: 1 });

    expect(screen.getByText('1 still waiting')).toBeTruthy();
    expect(screen.queryByText('2 still waiting')).toBeNull();
  });

  it('holds the summary back while a drain is still running — the progress line speaks then', () => {
    renderWithSummary({ sent: 5, remaining: 0 }, { done: 1, total: 2 });

    expect(screen.queryByTestId('queue-summary')).toBeNull();
    expect(screen.getByText('Sending 1 of 2…')).toBeTruthy();
  });

  // A refusal that will never be accepted — a duplicate registration, a record the office told
  // the Mait to drop — must have a way off the phone, or it retries on this list forever.
  const SHIVANI = job({
    clientUuid: 'shivani',
    kind: 'createEvent',
    failed: true,
    failedStatus: 400,
    lastError: 'A farmer with that Aadhaar is already registered.',
    label: { farmer: 'Shivani ji', kind: 'nonMember', amount: '250.00', mode: 'COD', at: '23:02' },
  });

  it('offers a remove on a refused row, and only there', () => {
    renderScreen([SHIVANI, KAVITA]);

    expect(screen.getByTestId('queue-remove-shivani')).toBeTruthy();
    // A row that is merely waiting for signal is not something to remove — it will send itself.
    expect(screen.queryByTestId('queue-remove-kavita')).toBeNull();
  });

  it('confirms before removing, and discards the capture once accepted', () => {
    // Auto-accept the dialog's destructive button (the second one).
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[1]?.onPress?.();
    });

    renderScreen([SHIVANI]);
    fireEvent.press(screen.getByTestId('queue-remove-shivani'));

    expect(onDiscardCapture).toHaveBeenCalledWith(
      expect.objectContaining({ clientUuid: 'shivani' }),
    );
  });

  it('does not discard when the confirmation is dismissed', () => {
    // Fire the cancel button (the first one), which has no onPress.
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.[0]?.onPress?.();
    });

    renderScreen([SHIVANI]);
    fireEvent.press(screen.getByTestId('queue-remove-shivani'));

    expect(onDiscardCapture).not.toHaveBeenCalled();
  });
});
