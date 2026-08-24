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
import PdReorderScreen, { villagePath } from '../PdReorderScreen';
import PdRouteScreen, { mapsUrl, readableTime } from '../PdRouteScreen';
import { routeMapHtml } from '../routeMapHtml';
import type { PdRoute, RouteOption, RouteStop } from '@api/types';
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
    // A member, priced at ₹100 by default. Cases about the money override these.
    price: '100.00',
    amount_charged: null,
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
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    expect(await screen.findByTestId('pd-headline')).toHaveTextContent(/4/);
  });

  it('says how many are already late, because that is the sentence that moves somebody', async () => {
    mockList([check({ days_until: -4 })], { due_this_week: 1, overdue: 1 });
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    await screen.findByTestId('pd-headline');
    expect(screen.getByText(/already late/i)).toBeTruthy();
  });

  it('opens the check that was tapped', async () => {
    const onOpen = jest.fn();
    mockList([check({ id: 7 })]);
    renderWithStore(withArea(<PdListScreen onOpen={onOpen} onPlanRoute={jest.fn()} />));

    fireEvent.press(await screen.findByTestId('pd-check-7'));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('names the village on the row, because the row is how a round is planned', async () => {
    mockList([check({ mpp_name: 'Nandgaon' })]);
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    expect(await screen.findByText(/Nandgaon/)).toBeTruthy();
  });

  it('shows the answer instead of a countdown once a check is done', async () => {
    // "4 LATE" against a check recorded last month is a lie the badge tells at a glance.
    mockList([check({ id: 9, outcome: 'pregnant', days_until: -30 })]);
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    await screen.findByTestId('pd-check-9');
    expect(screen.getByTestId('pd-outcome-good')).toBeTruthy();
    expect(screen.queryByText('LATE')).toBeNull();
  });

  it('names the outcome on a recorded row, not only its colour', async () => {
    // A green tick is fast to scan and says nothing on its own. The word is on the line a
    // Mait is already reading to find the yard.
    mockList([check({ id: 11, outcome: 'unsure', checked_at: '2026-08-20T11:00:00Z' })]);
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    await screen.findByTestId('pd-check-11');
    expect(screen.getByTestId('pd-check-11')).toHaveTextContent(new RegExp(i18n.t('pd.unsure')));
  });

  it('explains the three marks on the tab where they appear', async () => {
    mockList([check({ id: 12, outcome: 'pregnant' })]);
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    await screen.findByTestId('pd-check-12');
    // The week's list is all open rows and has no mark to explain.
    expect(screen.queryByTestId('pd-legend')).toBeNull();

    fireEvent.press(screen.getByTestId('pd-tab-done'));

    const legend = await screen.findByTestId('pd-legend');
    expect(legend).toHaveTextContent(new RegExp(i18n.t('pd.pregnant')));
    expect(legend).toHaveTextContent(new RegExp(i18n.t('pd.notPregnant')));
    expect(legend).toHaveTextContent(new RegExp(i18n.t('pd.unsure')));
  });

  it('offers no route to plan when there is nothing to walk to', async () => {
    mockList([], { due_this_week: 0, overdue: 0 });
    renderWithStore(withArea(<PdListScreen onOpen={jest.fn()} onPlanRoute={jest.fn()} />));

    await screen.findByTestId('empty-state');
    expect(screen.queryByTestId('pd-plan-route')).toBeNull();
  });
});

// --- recording -------------------------------------------------------------------------

describe('asking the owner first', () => {
  const props = {
    check: check(),
    onBack: jest.fn(),
    onSave: jest.fn(),
    photoUri: null,
    onPhoto: jest.fn(),
  };

  it('asks permission before it asks what was found', () => {
    // The order of the screen is the order of the visit. A Mait greets the owner and asks
    // whether to go ahead; a screen that opens on three findings has skipped that.
    render(withArea(<PdRecordScreen {...props} />));

    expect(screen.getByTestId('pd-consent-yes')).toBeTruthy();
    expect(screen.getByTestId('pd-consent-no')).toBeTruthy();
    expect(screen.queryByTestId('pd-outcome-pregnant')).toBeNull();
    expect(screen.queryByTestId('pd-photo')).toBeNull();
  });

  it('opens the findings once the owner agrees', () => {
    render(withArea(<PdRecordScreen {...props} />));

    fireEvent.press(screen.getByTestId('pd-consent-yes'));

    expect(screen.getByTestId('pd-outcome-pregnant')).toBeTruthy();
    expect(screen.getByTestId('pd-outcome-not-pregnant')).toBeTruthy();
    expect(screen.getByTestId('pd-outcome-unsure')).toBeTruthy();
  });

  it('agreeing writes nothing on its own', () => {
    // "Yes" is a way through to the screen that records an answer, not an answer.
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} />));

    fireEvent.press(screen.getByTestId('pd-consent-yes'));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers nothing further once the owner declines', () => {
    // The whole point of the step: no outcome to choose and no photograph to take, because
    // nothing was examined.
    render(withArea(<PdRecordScreen {...props} />));

    fireEvent.press(screen.getByTestId('pd-consent-no'));

    expect(screen.queryByTestId('pd-outcome-pregnant')).toBeNull();
    expect(screen.queryByTestId('pd-outcome-not-pregnant')).toBeNull();
    expect(screen.queryByTestId('pd-outcome-unsure')).toBeNull();
    expect(screen.queryByTestId('pd-photo')).toBeNull();
  });

  it('says what recording a refusal will do, before it is recorded', () => {
    // A Mait who thinks it writes the animal off will avoid the button and leave the row open.
    render(withArea(<PdRecordScreen {...props} />));

    fireEvent.press(screen.getByTestId('pd-consent-no'));

    // No follow-up is promised any more: the check closes and that is the whole of it.
    expect(screen.getByTestId('pd-decline-note')).toHaveTextContent(/closed/i);
    expect(screen.getByTestId('pd-decline-note')).not.toHaveTextContent(/7 days/);
  });

  it('records the refusal as its own outcome, with no photograph', () => {
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} />));

    fireEvent.press(screen.getByTestId('pd-consent-no'));
    fireEvent.press(screen.getByTestId('pd-decline-save'));

    expect(onSave).toHaveBeenCalledWith('declined', null);
  });

  it('commits the refusal on a second tap, never the first', () => {
    // As final and as uneditable as any other answer here, so it takes the same two taps.
    const onSave = jest.fn();
    render(withArea(<PdRecordScreen {...props} onSave={onSave} />));

    fireEvent.press(screen.getByTestId('pd-consent-no'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('pd-decline-save')).toBeTruthy();
  });

  it('goes back to the owner question rather than out of the screen', () => {
    // A Mait who taps "yes" and finds the owner was answering something else has to be able
    // to undo it without losing the check.
    const onBack = jest.fn();
    render(withArea(<PdRecordScreen {...props} onBack={onBack} />));

    fireEvent.press(screen.getByTestId('pd-consent-yes'));
    fireEvent.press(screen.getByTestId('pd-back'));

    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('pd-consent-yes')).toBeTruthy();

    // And from the first stage it does leave.
    fireEvent.press(screen.getByTestId('pd-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows a refusal already on the record as what it was', () => {
    render(
      withArea(
        <PdRecordScreen
          {...props}
          check={check({
            outcome: 'declined',
            outcome_display: 'Owner declined',
            checked_at: '2026-08-20T11:00:00Z',
          })}
        />,
      ),
    );

    expect(screen.getByTestId('pd-recorded')).toBeTruthy();
    expect(screen.getByTestId('pd-recorded-declined')).toHaveTextContent(/[Nn]othing was/);
    expect(screen.queryByTestId('pd-consent-yes')).toBeNull();
  });
});

describe('what the visit costs', () => {
  const props = {
    check: check(),
    onBack: jest.fn(),
    onSave: jest.fn(),
    photoUri: null as string | null,
    onPhoto: jest.fn(),
  };

  const atFindings = (over: Partial<PregnancyCheck> = {}) => {
    render(withArea(<PdRecordScreen {...props} check={check(over)} />));
    fireEvent.press(screen.getByTestId('pd-consent-yes'));
  };

  it('quotes a member the deduction, not a collection', () => {
    // She hands over nothing in the yard. A Mait who reads "collect ₹100" off this screen
    // asks a member for money the dairy is already taking out of her milk payment.
    atFindings({ owner_type: 'member', price: '100.00' });

    expect(screen.getByTestId('pd-charge')).toHaveTextContent(/100/);
    expect(screen.getByTestId('pd-charge')).toHaveTextContent(/milk payment/i);
    // Not the instruction — "Nothing to collect" is fine and is in fact the point; what must
    // never appear against a member is "Collect ₹ …".
    expect(screen.getByTestId('pd-charge')).not.toHaveTextContent(/[Cc]ollect ₹/);
  });

  it('tells a non-member visit to collect the cash', () => {
    atFindings({ owner_type: 'non_member', price: '150.00' });

    expect(screen.getByTestId('pd-charge')).toHaveTextContent(/150/);
    expect(screen.getByTestId('pd-charge')).toHaveTextContent(/[Cc]ollect/);
  });

  it('says the price before the examination, not only after it', () => {
    // A figure produced once the work is done is a bill. The Mait has to be able to say it
    // while the animal is still standing there.
    atFindings({ price: '100.00' });

    expect(screen.getByTestId('pd-charge')).toBeTruthy();
    expect(screen.getByTestId('pd-outcome-pregnant')).toBeTruthy();
  });

  it('never renders an unset rate as free', () => {
    // Null is "nobody has priced it", and a farmer hears any figure a Mait reads out as
    // final. Zero is the one that cannot be walked back.
    atFindings({ price: null });

    expect(screen.getByTestId('pd-charge')).not.toHaveTextContent(/₹/);
    expect(screen.getByTestId('pd-charge')).toHaveTextContent(/no rate set/i);
  });

  it('charges nothing for a refused visit', () => {
    render(
      withArea(
        <PdDoneScreen
          check={check({ owner_type: 'non_member', price: '150.00' })}
          outcome="declined"
          queued={false}
          next={null}
          onStartAi={jest.fn()}
          onOpenNext={jest.fn()}
          onBackToList={jest.fn()}
        />,
      ),
    );

    expect(screen.getByTestId('pd-settlement')).toHaveTextContent(/[Nn]othing to charge/);
    expect(screen.getByTestId('pd-settlement')).not.toHaveTextContent(/150/);
  });

  it('closes on the instruction, not on a number', () => {
    render(
      withArea(
        <PdDoneScreen
          check={check({ owner_type: 'non_member', price: '150.00' })}
          outcome="pregnant"
          queued={false}
          next={null}
          onStartAi={jest.fn()}
          onOpenNext={jest.fn()}
          onBackToList={jest.fn()}
        />,
      ),
    );

    expect(screen.getByTestId('pd-settlement')).toHaveTextContent(/[Cc]ollect ₹ 150/);
  });

  it('bills what was stamped, not what the rate says today', () => {
    // A visit recorded last month was charged at last month's price. Re-quoting it through
    // the current rate would tell a Mait a figure the dairy is not billing.
    render(
      withArea(
        <PdDoneScreen
          check={check({ owner_type: 'non_member', price: '150.00', amount_charged: '120.00' })}
          outcome="pregnant"
          queued={false}
          next={null}
          onStartAi={jest.fn()}
          onOpenNext={jest.fn()}
          onBackToList={jest.fn()}
        />,
      ),
    );

    expect(screen.getByTestId('pd-settlement')).toHaveTextContent(/120/);
    expect(screen.getByTestId('pd-settlement')).not.toHaveTextContent(/150/);
  });
});

describe('recording what was found', () => {
  const props = {
    check: check(),
    onBack: jest.fn(),
    onSave: jest.fn(),
    // Widened, so a case can override it with a real file. Inferred from `null` it is a
    // `null`-only field and `withConsent({ photoUri: '...' })` will not type.
    photoUri: null as string | null,
    onPhoto: jest.fn(),
  };

  /**
   * The findings sit behind the owner's permission now, so every case about them has to walk
   * through the gate first — which is the same thing the Mait does in the yard.
   */
  const withConsent = (overrides: Partial<typeof props> = {}) => {
    const view = render(withArea(<PdRecordScreen {...props} {...overrides} />));
    fireEvent.press(screen.getByTestId('pd-consent-yes'));
    return view;
  };

  it('says what each answer will do, before it is chosen', () => {
    // A Mait who does not know that "not sure" books a recheck will avoid it and guess, and a
    // guess in this record is a conception rate nobody can trust.
    withConsent();

    expect(screen.getByText(/Calving due about/)).toBeTruthy();
    expect(screen.getByText(/inseminated again today/)).toBeTruthy();
    expect(screen.getByText(/recheck in 21 days/)).toBeTruthy();
  });

  it('will not save until an answer is chosen', () => {
    withConsent();

    expect(screen.getByTestId('pd-save').props.accessibilityState.disabled).toBe(true);
  });

  it('refuses not-pregnant without a photograph', () => {
    // The outcome that costs somebody money and the one a farmer disputes six months later.
    const onSave = jest.fn();
    withConsent({ onSave, photoUri: null });

    fireEvent.press(screen.getByTestId('pd-outcome-not-pregnant'));

    expect(screen.getByTestId('pd-save').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('pd-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('takes not-pregnant once there is a photograph', () => {
    const onSave = jest.fn();
    withConsent({ onSave, photoUri: 'file:///a.jpg' });

    fireEvent.press(screen.getByTestId('pd-outcome-not-pregnant'));
    fireEvent.press(screen.getByTestId('pd-save'));

    expect(onSave).toHaveBeenCalledWith('not_pregnant', 'file:///a.jpg');
  });

  it('does not demand a photograph for the other two', () => {
    // Requiring one everywhere would teach a Mait to photograph a wall to get past the screen.
    const onSave = jest.fn();
    withConsent({ onSave, photoUri: null });

    fireEvent.press(screen.getByTestId('pd-outcome-pregnant'));
    fireEvent.press(screen.getByTestId('pd-save'));

    expect(onSave).toHaveBeenCalledWith('pregnant', null);
  });

  it('opens the camera when the photograph is asked for', () => {
    // Reported broken: the button did nothing. It has to reach the flow's own camera, which
    // already owns the permission gate, the resize and the EXIF strip.
    withConsent();

    fireEvent.press(screen.getByTestId('pd-photo'));

    expect(screen.getByTestId('pd-camera-allow')).toBeTruthy();
  });

  it('will not offer the choices again once a result is on the record', () => {
    // The Done tab exists so a Mait can check what they told a farmer. It must not lead to
    // three fresh radio buttons over an answer already given and possibly already repeated
    // to her — the server refuses the second write, and a save that appears to work and
    // then does not is worse than one that was never offered.
    render(
      withArea(
        <PdRecordScreen
          {...props}
          check={check({
            outcome: 'pregnant',
            outcome_display: 'Pregnant',
            checked_at: '2026-08-20T11:00:00Z',
            calving_due_on: '2027-02-28',
          })}
        />,
      ),
    );

    expect(screen.getByTestId('pd-recorded')).toBeTruthy();
    expect(screen.queryByTestId('pd-outcome-pregnant')).toBeNull();
    expect(screen.queryByTestId('pd-outcome-not-pregnant')).toBeNull();
    expect(screen.queryByTestId('pd-outcome-unsure')).toBeNull();
    expect(screen.queryByTestId('pd-save')).toBeNull();
    expect(screen.queryByTestId('pd-photo')).toBeNull();
  });

  it('says why there is nothing to tap, rather than leaving it to be discovered', () => {
    render(withArea(<PdRecordScreen {...props} check={check({ outcome: 'not_pregnant' })} />));

    expect(screen.getByTestId('pd-locked')).toBeTruthy();
  });

  it('shows the calving date a farmer will ask about', () => {
    render(
      withArea(
        <PdRecordScreen
          {...props}
          check={check({ outcome: 'pregnant', calving_due_on: '2027-02-28' })}
        />,
      ),
    );

    expect(screen.getByTestId('pd-recorded-calving')).toHaveTextContent(/28 Feb/);
  });

  it('names the animal and how long she has been carrying', () => {
    withConsent();

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

// --- the round -------------------------------------------------------------------------

function stop(over: Partial<RouteStop> = {}): RouteStop {
  return { ...check(), leg_km: 2.5, lat: 26.79, lng: 82.19, ...over } as RouteStop;
}

function option(stops: RouteStop[], over: Partial<RouteOption> = {}): RouteOption {
  return {
    total_km: 18,
    minutes_total: 160,
    minutes_on_road: 52,
    stops,
    ...over,
  };
}

describe('readableTime', () => {
  it('reads as hours and minutes, the way a morning is talked about', () => {
    expect(readableTime(160)).toBe('2h 40m');
    expect(readableTime(45)).toBe('45m');
  });
});

describe('mapsUrl', () => {
  it('hands every stop to Maps in order, the last one as the destination', () => {
    // The one part of this that is real navigation. Whatever the estimates say, Maps gives
    // turn-by-turn along actual roads.
    const url = mapsUrl([
      stop({ id: 1, lat: 26.77, lng: 82.14 }),
      stop({ id: 2, lat: 26.79, lng: 82.19 }),
    ]);

    expect(url).toContain('destination=26.79,82.19');
    expect(url).toContain('waypoints=');
  });

  it('offers nothing rather than a broken link when no stop has a position', () => {
    expect(mapsUrl([stop({ lat: null, lng: null })])).toBeNull();
  });
});

describe('villagePath', () => {
  it('collapses a run of stops in one village into its name once', () => {
    // "Three Barsana stops, then Nandgaon" is what makes a route make sense to somebody who
    // knows their own villages.
    const path = villagePath(
      option([
        stop({ id: 1, mpp_name: 'Barsana' }),
        stop({ id: 2, mpp_name: 'Barsana' }),
        stop({ id: 3, mpp_name: 'Nandgaon' }),
      ]),
    );

    expect(path).toBe('Barsana → Nandgaon');
  });
});

describe('the route screen', () => {
  const base = {
    orderKey: 'shortest' as const,
    fromHere: true,
    startPoint: { lat: 26.79, lng: 82.13 },
    withoutLocation: 0,
    onBack: jest.fn(),
    onReorder: jest.fn(),
    onOpenStop: jest.fn(),
  };

  it('leads with the count and the distance, not with a date', () => {
    render(
      withArea(
        <PdRouteScreen
          {...base}
          option={option([stop({ id: 1 }), stop({ id: 2 }), stop({ id: 3 })])}
        />,
      ),
    );

    expect(screen.getByTestId('route-headline')).toHaveTextContent(/3/);
    expect(screen.getByTestId('route-headline')).toHaveTextContent(/18/);
  });

  it('keeps an overdue stop reading as overdue wherever the order put it', () => {
    // The route may well put a late one last. The reason it is on the list does not change
    // because of where it landed.
    render(
      withArea(
        <PdRouteScreen
          {...base}
          option={option([stop({ id: 1 }), stop({ id: 2, days_until: -9 })])}
        />,
      ),
    );

    expect(screen.getByTestId('route-stop-2')).toHaveTextContent(/9/);
  });

  it('says it has no fix rather than pretending the order started from somewhere', () => {
    render(withArea(<PdRouteScreen {...base} fromHere={false} option={option([stop()])} />));

    expect(screen.getByText(i18n.t('route2.noFix'))).toBeTruthy();
  });

  it('draws the round on a map, with the legs between the stops', () => {
    // Two earlier attempts were not maps: evenly spaced dots, then a plot of true
    // coordinates with no roads or landmarks in it. A Mait cannot recognise their own
    // village in a field of dots, and recognising it is the whole point of looking.
    render(
      withArea(
        <PdRouteScreen
          {...base}
          option={option([
            stop({ id: 1, lat: 26.762, lng: 82.12 }),
            stop({ id: 2, lat: 26.7956, lng: 82.1943 }),
          ])}
        />,
      ),
    );

    expect(screen.getByTestId('route-map')).toBeTruthy();
  });

  it('draws nothing rather than a false picture when no stop has a position', () => {
    render(
      withArea(
        <PdRouteScreen
          {...base}
          startPoint={null}
          option={option([stop({ lat: null, lng: null })])}
        />,
      ),
    );

    expect(screen.queryByTestId('route-map')).toBeNull();
  });

  it('names the checks it could not place rather than dropping them silently', () => {
    render(withArea(<PdRouteScreen {...base} withoutLocation={2} option={option([stop()])} />));

    expect(screen.getByTestId('route-unplaced')).toHaveTextContent(/2/);
  });

  it('opens the check that was tapped', () => {
    const onOpenStop = jest.fn();
    render(
      withArea(
        <PdRouteScreen {...base} onOpenStop={onOpenStop} option={option([stop({ id: 5 })])} />,
      ),
    );

    fireEvent.press(screen.getByTestId('route-stop-5'));

    expect(onOpenStop).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });
});

describe('choosing an order', () => {
  const route: PdRoute = {
    from_here: true,
    stop_count: 3,
    without_location: 0,
    options: {
      shortest: option([stop({ id: 1, mpp_name: 'Barsana' })], {
        total_km: 18,
        minutes_on_road: 52,
      }),
      late_first: option(
        [stop({ id: 2, owner_name: 'Anita Devi', days_until: -9, mpp_name: 'Nandgaon' })],
        { total_km: 27, minutes_on_road: 78 },
      ),
    },
  };

  it('shows what each order costs, side by side', () => {
    // Somebody choosing 27 km over 18 is making a decision with these two numbers.
    render(
      withArea(
        <PdReorderScreen route={route} current="shortest" onBack={jest.fn()} onUse={jest.fn()} />,
      ),
    );

    expect(screen.getByTestId('reorder-shortest')).toHaveTextContent(/18 km/);
    expect(screen.getByTestId('reorder-late')).toHaveTextContent(/27 km/);
  });

  it('names the late stop that makes this a question at all', () => {
    render(
      withArea(
        <PdReorderScreen route={route} current="shortest" onBack={jest.fn()} onUse={jest.fn()} />,
      ),
    );

    expect(screen.getByText(/Anita Devi/)).toBeTruthy();
  });

  it('says the distances are estimates, where the estimates are being weighed', () => {
    // There is no routing service behind this. A Mait deciding on a longer ride deserves to
    // know how firm the number is.
    render(
      withArea(
        <PdReorderScreen route={route} current="shortest" onBack={jest.fn()} onUse={jest.fn()} />,
      ),
    );

    expect(screen.getByTestId('reorder-note')).toHaveTextContent(/straight lines/i);
  });

  it('hands back the order that was chosen', () => {
    const onUse = jest.fn();
    render(
      withArea(
        <PdReorderScreen route={route} current="shortest" onBack={jest.fn()} onUse={onUse} />,
      ),
    );

    fireEvent.press(screen.getByTestId('reorder-late'));
    fireEvent.press(screen.getByTestId('reorder-use'));

    expect(onUse).toHaveBeenCalledWith('late_first');
  });
});

describe('the map document', () => {
  it('draws a line through the stops, which is what makes it a route', () => {
    const html = routeMapHtml(
      [
        { lat: 26.79, lng: 82.13, index: 0, label: 'You are here', late: false },
        { lat: 26.771, lng: 82.149, index: 1, label: '1. Kavita', late: false },
        { lat: 26.7956, lng: 82.1943, index: 2, label: '2. Malti', late: true },
      ],
      { primary: '#3BB77E', error: '#E54D42', info: '#3E92E5', surface: '#FFF' },
    );

    expect(html).toContain('L.polyline');
    expect(html).toContain('[26.79, 82.13]');
    expect(html).toContain('[26.7956, 82.1943]');
  });

  it('uses OpenStreetMap, which needs no key at all', () => {
    // The whole reason this is not Google: their SDK is metered and cannot be used without a
    // key, and an empty key crashed the app rather than degrading.
    const html = routeMapHtml([{ lat: 26.79, lng: 82.13, index: 1, label: 'x', late: false }], {
      primary: '#0f0',
      error: '#f00',
      info: '#00f',
      surface: '#fff',
    });

    expect(html).toContain('tile.openstreetmap.org');
    expect(html).not.toMatch(/api[_-]?key|googleapis/i);
  });

  it('keeps the attribution the tiles are given on condition of', () => {
    const html = routeMapHtml([{ lat: 26.79, lng: 82.13, index: 1, label: 'x', late: false }], {
      primary: '#0f0',
      error: '#f00',
      info: '#00f',
      surface: '#fff',
    });

    expect(html).toContain('OpenStreetMap');
  });

  it('does not let a name become markup', () => {
    const html = routeMapHtml(
      [{ lat: 26.79, lng: 82.13, index: 1, label: '<script>alert(1)</script>', late: false }],
      { primary: '#0f0', error: '#f00', info: '#00f', surface: '#fff' },
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('reports a failure rather than leaving an empty frame', () => {
    // A map that silently fails to load looks exactly like a round with nothing in it.
    const html = routeMapHtml([{ lat: 26.79, lng: 82.13, index: 1, label: 'x', late: false }], {
      primary: '#0f0',
      error: '#f00',
      info: '#00f',
      surface: '#fff',
    });

    expect(html).toContain('ReactNativeWebView.postMessage');
    expect(html).toContain('window.onerror');
  });
});
