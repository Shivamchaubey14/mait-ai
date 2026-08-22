/**
 * Pregnancy diagnosis, on the handset.
 *
 * What is defended here is the handful of things that decide whether a check actually gets
 * done and recorded honestly:
 *
 *   - a late check has to *look* late, because it is the one a Mait must not skip;
 *   - the three answers have to say what they will do before they are chosen, or a Mait who
 *     does not know "not sure" books a recheck will guess instead;
 *   - "not pregnant" cannot be saved without a photograph, since it is the outcome that costs
 *     somebody money and the one a farmer disputes;
 *   - and a result saved with no signal has to say it is safe on the phone, or the visit gets
 *     recorded twice — once in the app and once by walking back to the yard.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PdDoneScreen from '../PdDoneScreen';
import PdListScreen, { shortDate, urgencyOf } from '../PdListScreen';
import PdRecordScreen, { calvingPreview } from '../PdRecordScreen';
import type { PregnancyCheck } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';
import i18n from '@/i18n';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function check(over: Partial<PregnancyCheck> = {}): PregnancyCheck {
  return {
    id: 1,
    ai_event_id: 30,
    owner_name: 'Kavita Devi',
    owner_type: 'member',
    mpp_id: 1,
    mpp_code: '001302',
    mpp_name: 'Barsana',
    member_code: 'MEM00000412',
    non_member_id: null,
    animal_id: 7,
    animal_type: 'COW',
    ear_tag_no: '4821',
    breed: 'HF Cross',
    served_on: '2026-05-21',
    due_on: '2026-08-19',
    days_until: 0,
    days_since_ai: 92,
    outcome: '',
    outcome_display: '',
    checked_at: null,
    calving_due_on: null,
    photo_url: '',
    note: '',
    ...over,
  };
}

function mockList(rows: PregnancyCheck[], counts = { due_this_week: rows.length, overdue: 0 }) {
  (global.fetch as jest.Mock).mockImplementation(async () =>
    jsonResponse({ count: rows.length, next: null, previous: null, results: rows, ...counts }),
  );
}

function withArea(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>;
}

// --- the arithmetic on the row ---------------------------------------------------------

describe('urgency', () => {
  it('calls a check past its date late', () => {
    // The one a Mait must not skip. Overdue never falls off the list server-side either.
    expect(urgencyOf(-1)).toBe('late');
    expect(urgencyOf(-30)).toBe('late');
  });

  it('separates today from merely soon', () => {
    // Different decisions on the morning: one is today's round, the other is planning.
    expect(urgencyOf(0)).toBe('today');
    expect(urgencyOf(1)).toBe('soon');
  });
});

describe('shortDate', () => {
  it('reads as a day and a month, not a machine date', () => {
    expect(shortDate('2026-05-14')).toBe('14 May');
  });

  it('says nothing rather than guessing when there is no date', () => {
    expect(shortDate(null)).toBe('—');
  });
});

describe('calvingPreview', () => {
  it('counts a cow at 283 days from the insemination', () => {
    // Counted from the service, not from the check: a Mait who is late must not move a
    // farmer's calving month with them.
    expect(calvingPreview('2026-05-21', 'COW')).toBe('28 Feb 2027');
  });

  it('gives a buffalo the longer gestation she actually has', () => {
    const cow = calvingPreview('2026-05-21', 'COW');
    const buffalo = calvingPreview('2026-05-21', 'BUFF');
    expect(buffalo).not.toBe(cow);
  });

  it('says nothing when the insemination date is missing', () => {
    expect(calvingPreview(null, 'COW')).toBe('');
  });
});

// --- the list --------------------------------------------------------------------------

describe('the list', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });
  afterEach(() => jest.resetAllMocks());

  it('counts the week in the headline, off the server', async () => {
    mockList([check(), check({ id: 2 })], { due_this_week: 4, overdue: 1 });
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} />));

    expect(await screen.findByTestId('pd-headline')).toHaveTextContent(/4/);
  });

  it('says how many are already late, because that is the sentence that moves somebody', async () => {
    mockList([check({ days_until: -4 })], { due_this_week: 1, overdue: 1 });
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} />));

    await screen.findByTestId('pd-headline');
    expect(screen.getByText(/already late/i)).toBeTruthy();
  });

  it('opens the check that was tapped', async () => {
    const onOpen = jest.fn();
    mockList([check({ id: 7 })]);
    renderWithStore(withArea(<PdListScreen onOpen={onOpen} />));

    fireEvent.press(await screen.findByTestId('pd-check-7'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('names the village on the row, because the row is how a round is planned', async () => {
    mockList([check({ mpp_name: 'Nandgaon' })]);
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} />));

    expect(await screen.findByText(/Nandgaon/)).toBeTruthy();
  });

  it('offers no route to plan when there is nothing to walk to', async () => {
    mockList([], { due_this_week: 0, overdue: 0 });
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} />));

    await screen.findByTestId('empty-state');
    expect(screen.queryByTestId('pd-plan-route')).toBeNull();
  });
});

// --- recording -------------------------------------------------------------------------

describe('recording what was found', () => {
  const props = {
    check: check(),
    onBack: jest.fn(),
    onSave: jest.fn(),
    photoUri: null,
    onPhoto: jest.fn(),
  };

  it('says what each answer will do, before it is chosen', () => {
    // A Mait who does not know that "not sure" books a recheck will avoid it and guess, and a
    // guess in this record is a conception rate nobody can trust.
    render(withArea(<PdRecordScreen {...props} />));

    expect(screen.getByText(/Calving due about/)).toBeTruthy();
    expect(screen.getByText(/inseminated again today/)).toBeTruthy();
    expect(screen.getByText(/recheck in 21 days/)).toBeTruthy();
  });

  it('will not save until an answer is chosen', () => {
    render(withArea(<PdRecordScreen {...props} />));

    expect(screen.getByTestId('pd-save').props.accessibilityState.disabled).toBe(true);
  });

  it('refuses not-pregnant without a photograph', () => {
    // The outcome that costs somebody money and the one a farmer disputes six months later.
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} photoUri={null} />));

    fireEvent.press(screen.getByTestId('pd-outcome-not-pregnant'));

    expect(screen.getByTestId('pd-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('pd-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('takes not-pregnant once there is a photograph', () => {
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} photoUri="file:///a.jpg" />));

    fireEvent.press(screen.getByTestId('pd-outcome-not-pregnant'));
    fireEvent.press(screen.getByTestId('pd-save'));

    expect(onSave).toHaveBeenCalledWith('not_pregnant', 'file:///a.jpg');
  });

  it('does not demand a photograph for the other two', () => {
    // Requiring one everywhere would teach a Mait to photograph a wall to get past the screen.
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} photoUri={null} />));

    fireEvent.press(screen.getByTestId('pd-outcome-pregnant'));
    fireEvent.press(screen.getByTestId('pd-save'));

    expect(onSave).toHaveBeenCalledWith('pregnant', null);
  });

  it('opens the camera when the photograph is asked for', () => {
    // Reported broken: the button did nothing. It has to reach the flow's own camera, which
    // already owns the permission gate, the resize and the EXIF strip.
    render(withArea(<PdRecordScreen {...props} />));

    fireEvent.press(screen.getByTestId('pd-photo'));

    expect(screen.getByTestId('pd-camera-allow')).toBeTruthy();
  });

  it('names the animal and how long she has been carrying', () => {
    render(withArea(<PdRecordScreen {...props} />));

    expect(screen.getByText(/Kavita Devi/)).toBeTruthy();
    expect(screen.getByText(/92 days/)).toBeTruthy();
  });
});

// --- afterwards ------------------------------------------------------------------------

describe('once it is recorded', () => {
  const base = {
    check: check(),
    next: null,
    onStartAi: jest.fn(),
    onOpenNext: jest.fn(),
    onBackToList: jest.fn(),
  };

  it('says the record is safe on the phone when it could not be sent', () => {
    // A Mait who cannot tell "saved here" from "lost" records the visit again later — which
    // the idempotency key survives, and which is still a wasted walk.
    render(withArea(<PdDoneScreen {...base} outcome="pregnant" queued />));

    expect(screen.getByTestId('pd-status')).toHaveTextContent(new RegExp(i18n.t('pd.queuedTitle')));
    expect(screen.getByText(i18n.t('pd.queuedPill'))).toBeTruthy();
  });

  it('says so plainly when it did go', () => {
    render(withArea(<PdDoneScreen {...base} outcome="pregnant" queued={false} />));

    expect(screen.getByTestId('pd-status')).toHaveTextContent(new RegExp(i18n.t('pd.sentTitle')));
    expect(screen.queryByText(i18n.t('pd.queuedPill'))).toBeNull();
  });

  it('offers a fresh insemination only when she is open to one', () => {
    // She is not in calf, she is in heat, and the Mait is standing in the yard.
    render(withArea(<PdDoneScreen {...base} outcome="not_pregnant" queued />));
    expect(screen.getByTestId('pd-serve-again')).toBeTruthy();
  });

  it('does not offer to inseminate an animal that is already carrying', () => {
    render(withArea(<PdDoneScreen {...base} outcome="pregnant" queued />));
    expect(screen.queryByTestId('pd-serve-again')).toBeNull();

    render(withArea(<PdDoneScreen {...base} outcome="unsure" queued />));
    expect(screen.queryByTestId('pd-serve-again')).toBeNull();
  });

  it('starts the capture with the farmer already known', () => {
    const onStartAi = jest.fn();
    render(
      withArea(<PdDoneScreen {...base} outcome="not_pregnant" queued onStartAi={onStartAi} />),
    );

    fireEvent.press(screen.getByTestId('pd-start-ai'));

    expect(onStartAi).toHaveBeenCalled();
  });

  it('points at the next check, and says whether it is the same village', () => {
    render(
      withArea(
        <PdDoneScreen
          {...base}
          outcome="pregnant"
          queued
          next={check({ id: 2, owner_name: 'Radha Singh', mpp_code: '001302' })}
        />,
      ),
    );

    expect(screen.getByTestId('pd-next')).toHaveTextContent(/Radha Singh/);
    expect(screen.getByTestId('pd-next')).toHaveTextContent(/same village/);
  });

  it('says the round is finished rather than showing an empty row', () => {
    render(withArea(<PdDoneScreen {...base} outcome="pregnant" queued next={null} />));

    expect(screen.getByTestId('pd-all-done')).toBeTruthy();
    expect(screen.queryByTestId('pd-next')).toBeNull();
  });
});
