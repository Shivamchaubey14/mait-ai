/**
 * The zonal manager's screens.
 *
 * What is under test is what a manager would act on wrongly if it were wrong: the headline on
 * the zone screen and the direction of its comparison; the word on an indent row, which is a
 * claim about a depot's shelf rather than about the size of the request; the two figures the
 * decision is taken on; that rejecting cannot happen without a reason; that the stock screen
 * groups by place and puts the fix beside the problem; and that History reads back decisions
 * rather than a log of everything.
 */

import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type {
  ZonalApproval,
  ZonalDashboard,
  ZonalEvent,
  ZonalHistory,
  ZonalHome,
  ZoneStock,
} from '@api/types';
import { isoDate } from '@/components/dateRange';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';
import { colors, ink, yolk } from '@theme/tokens';

import AllEventsScreen from '../AllEventsScreen';
import ApprovalScreen from '../ApprovalScreen';
import DashboardScreen from '../DashboardScreen';
import EventScreen from '../EventScreen';
import HistoryScreen from '../HistoryScreen';
import IndentsScreen, { matches } from '../IndentsScreen';
import ZonalProfileScreen from '../ZonalProfileScreen';
import ZoneStockScreen from '../ZoneStockScreen';
import { groupIndents } from '../parts';

function approval(overrides: Partial<ZonalApproval> = {}): ZonalApproval {
  return {
    id: 13,
    mait: 4,
    mait_name: 'Sunil Kumar',
    mait_code: '5500000054',
    mpp_names: ['BARSANA', 'NANDGAON'],
    product_type: 'straw',
    breed: 'MURRAH',
    item_name: 'Murrah',
    item_name_hi: 'मुर्रा',
    unit: 'straw',
    qty_requested: 25,
    note: '',
    requested_at: '2026-09-16T09:00:00Z',
    waiting_days: 3,
    status: 'requested',
    store: 1,
    store_name: 'Barsana depot',
    in_store: 40,
    mait_holds: 2,
    coverage: 'ready',
    ...overrides,
  };
}

const HOME: ZonalHome = {
  manager: {
    name: 'Anita Verma',
    mobile_no: '9811100001',
    zones: ['Ayodhya Zone'],
    sections: ['indents', 'inventory'],
  },
  waiting: 3,
  oldest_waiting_days: 6,
  at_depot: 2,
  maits: 11,
  stores: 1,
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

/** A fortnight ending today, quiet until the last three days. */
const TREND = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.now() - (13 - index) * 86_400_000);
  return {
    date: date.toISOString().slice(0, 10),
    label: `${date.getDate()} Sep`,
    short_label: 'Mon',
    completed: index === 11 ? 9 : index === 12 ? 5 : index === 13 ? 7 : 0,
  };
});

const BOARD: ZonalDashboard = {
  days: 14,
  today: 7,
  yesterday: 5,
  on_yesterday: 2,
  week: 21,
  month: 84,
  maits_working_today: 3,
  in_progress: 2,
  payment_pending: 1,
  trend: TREND,
  best_day: TREND[11]!,
  busiest_maits: [
    { mait_id: 4, name: 'Sunil Kumar', code: '5500000054', events: 9, share: 1 },
    { mait_id: 5, name: 'Devi Prasad', code: '5500000099', events: 4, share: 0.444 },
  ],
  busiest_villages: [
    { mpp_code: '001302', name: 'BARSANA', plant_name: 'AYODHYA BMC', events: 11, share: 1 },
  ],
  happening: [
    {
      id: 900,
      mait_name: 'Sunil Kumar',
      mait_code: '5500000054',
      mpp_name: 'BARSANA',
      mpp_code: '001302',
      plant_name: 'AYODHYA BMC',
      breed: 'MURRAH',
      doses: 1,
      when: new Date().toISOString(),
    },
  ],
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

const QUEUE = [
  approval(),
  approval({ id: 14, mait: 6, mait_name: 'Ramesh Yadav', coverage: 'short', in_store: 7 }),
  approval({ id: 11, mait: 5, mait_name: 'Devi Prasad', coverage: 'empty', in_store: 0 }),
  approval({
    id: 9,
    mait: 7,
    mait_name: 'Kamla Devi',
    coverage: 'no-store',
    in_store: -1,
    store: null,
  }),
];

/** One Mait's list, as the Request Stock screen posts it: straws and gloves a second apart. */
const LIST = [
  approval({ id: 20, requested_at: '2026-09-19T08:00:00Z' }),
  approval({
    id: 21,
    requested_at: '2026-09-19T08:00:02Z',
    product_type: 'consumable',
    breed: '',
    item_name: 'Gloves',
    item_name_hi: 'दस्ताने',
    unit: 'pair',
    qty_requested: 10,
    coverage: 'empty',
    in_store: 0,
    note: 'Out of gloves since Monday',
  }),
];

const STOCK: ZoneStock = {
  summary: {
    total_straws: 140,
    maits: 2,
    at_zero: 1,
    low: 0,
    low_stock_threshold: 10,
    locations: 2,
    stores: 1,
    store_straws: 240,
  },
  locations: [
    {
      plant_code: '2202',
      name: 'BAHRAICH BMC',
      maits: 1,
      at_zero: 1,
      low: 0,
      straws: 0,
      by_breed: {},
      stores: [],
    },
    {
      plant_code: '1101',
      name: 'AYODHYA BMC',
      maits: 1,
      at_zero: 0,
      low: 0,
      straws: 140,
      by_breed: { Murrah: 140 },
      stores: [{ id: 1, name: 'Barsana depot', straws_available: 222, open_indents: 2 }],
    },
  ],
  maits: [
    {
      mait_id: 5,
      name: 'Devi Prasad',
      code: '5500000099',
      mobile_no: '',
      plant_code: '2202',
      plant_name: 'BAHRAICH BMC',
      also_covers: [],
      mpps: 1,
      total: 0,
      by_breed: {},
      state: 'at_zero',
    },
    {
      mait_id: 4,
      name: 'Sunil Kumar',
      code: '5500000054',
      mobile_no: '',
      plant_code: '1101',
      plant_name: 'AYODHYA BMC',
      also_covers: ['BAHRAICH BMC'],
      mpps: 2,
      total: 140,
      by_breed: { Murrah: 140 },
      state: 'ok',
    },
  ],
  stores: [
    {
      id: 1,
      code: 'BARSANA',
      name: 'Barsana depot',
      plant_codes: ['1101'],
      plant_names: ['AYODHYA BMC'],
      straws_on_hand: 240,
      straws_set_aside: 18,
      straws_available: 222,
      by_breed: { Murrah: 222 },
      open_indents: 2,
    },
  ],
  products: {
    straw: [
      {
        key: 'straw:MURRAH',
        category: 'straw',
        name: 'Murrah',
        name_hi: 'मुर्रा',
        unit: 'straw',
        with_maits: 140,
        maits_holding: 1,
        at_depots: 240,
        set_aside: 18,
        free: 222,
        requested: 25,
        approved: 5,
      },
    ],
    consumable: [
      {
        key: 'consumable:7',
        category: 'consumable',
        name: 'Gloves',
        name_hi: '',
        unit: 'pair',
        with_maits: 0,
        maits_holding: 0,
        at_depots: 0,
        set_aside: 0,
        free: 0,
        requested: 10,
        approved: 0,
      },
    ],
    asset: [
      {
        key: 'consumable:9',
        category: 'asset',
        name: 'AI gun',
        name_hi: '',
        unit: 'piece',
        with_maits: 2,
        maits_holding: 2,
        at_depots: 0,
        set_aside: 0,
        free: 0,
        requested: 0,
        approved: 0,
      },
    ],
  },
  scope: { scoped: true, zones: ['Ayodhya Zone'], plant_codes: ['1101'] },
};

const HISTORY: ZonalHistory = {
  summary: { days: 30, approved: 9, rejected: 2, total: 11, last_signed_in: null },
  outcome: 'all',
  count: 2,
  results: [
    {
      id: 900,
      when: new Date().toISOString(),
      outcome: 'approved',
      indent_id: 13,
      mait_name: 'Sunil Kumar',
      mait_code: '5500000054',
      item_name: 'Murrah',
      item_name_hi: 'मुर्रा',
      qty: 25,
      status: 'approved',
      status_label: 'Waiting at the depot',
      status_tone: 'waiting',
      store_name: 'Barsana depot',
      reason: '',
    },
    {
      id: 899,
      when: new Date().toISOString(),
      outcome: 'rejected',
      indent_id: 12,
      mait_name: 'Devi Prasad',
      mait_code: '5500000099',
      item_name: 'Jersey',
      item_name_hi: 'जर्सी',
      qty: 10,
      status: 'rejected',
      status_label: 'Rejected',
      status_tone: 'bad',
      store_name: '',
      reason: 'Nothing on the shelf until Friday',
    },
  ],
};

/** One whole record, as `/zonal/events/{id}/` answers it. */
const EVENT: ZonalEvent = {
  id: 900,
  client_uuid: 'a1b2c3d4-0000-0000-0000-000000000900',
  status: 'completed',
  status_display: 'Completed',
  mpp: 3,
  mpp_code: '001302',
  mpp_name: 'BARSANA',
  mait: 4,
  mait_name: 'Sunil Kumar',
  mait_code: '5500000054',
  owner_type: 'member',
  member: 11,
  member_code: 'MEM00000412',
  non_member: null,
  owner_name: 'Kavita Devi',
  animal: 21,
  animal_type: 'BUFF',
  breed: 'MURRAH',
  ear_tag_no: 'IN-4412',
  semen_breed: 'HF',
  doses: 2,
  consumables: [{ code: 'SHEATH', name: 'Sheath', unit: 'piece', qty: 2 }],
  amount_due: '300.00',
  payment: {
    amount: '300.00',
    mode: 'COD',
    mode_display: 'Cash on delivery',
    status: 'verified',
    status_display: 'Verified',
    is_verified: true,
  },
  straw_unique_no: 'T0001-HF-0002',
  stock_deducted: true,
  ai_photo_url: 'ai-photos/900.jpg',
  photo_source: 'camera',
  gps_lat: '26.7920000',
  gps_lng: '82.1940000',
  gps_source: 'device',
  performed_at: '2026-09-18T06:20:00Z',
  completed_at: '2026-09-18T06:24:00Z',
  cancelled_reason: '',
  created_at: '2026-09-18T06:19:00Z',
  pregnancy_checks: [
    {
      id: 77,
      ai_event_id: 900,
      owner_name: 'Kavita Devi',
      owner_type: 'member',
      mpp_id: 3,
      mpp_code: '001302',
      mpp_name: 'BARSANA',
      member_code: 'MEM00000412',
      non_member_id: null,
      animal_id: 21,
      animal_type: 'BUFF',
      ear_tag_no: 'IN-4412',
      breed: 'MURRAH',
      served_on: '2026-09-18',
      due_on: '2026-12-17',
      days_until: 89,
      days_since_ai: 1,
      outcome: 'pregnant',
    } as ZonalEvent['pregnancy_checks'][number],
  ],
  timeline: [
    {
      id: 1,
      from_status: 'draft',
      to_status: 'straw_verified',
      note: 'Straw verified',
      actor_name: 'Sunil Kumar',
      created_at: '2026-09-18T06:20:00Z',
    },
    {
      id: 2,
      from_status: 'straw_verified',
      to_status: 'completed',
      note: 'Completed',
      actor_name: 'Sunil Kumar',
      created_at: '2026-09-18T06:24:00Z',
    },
  ],
};

type Route = (request: Request) => Response | undefined;

/** How many times the dashboard has been asked for, so a refetch can be seen to happen. */
function dashboardCalls(): number {
  return (global.fetch as jest.Mock).mock.calls.filter(([input]) =>
    (typeof input === 'string' ? input : input.url).includes('/zonal/dashboard/'),
  ).length;
}

function mockApi(route: Route = () => undefined) {
  (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
    const answer = route(input);
    if (answer) {
      return answer;
    }
    const url = input.url;
    if (url.includes('/zonal/dashboard/')) {
      return jsonResponse(BOARD);
    }
    if (url.includes('/zonal/approvals/')) {
      return jsonResponse({ count: QUEUE.length, results: QUEUE });
    }
    if (url.includes('/zonal/stock/')) {
      return jsonResponse(STOCK);
    }
    if (url.includes('/zonal/history/')) {
      return jsonResponse(HISTORY);
    }
    if (url.includes('/zonal/events/')) {
      return jsonResponse(EVENT);
    }
    if (url.includes('/zonal/')) {
      return jsonResponse(HOME);
    }
    return jsonResponse({});
  });
}

beforeEach(() => {
  global.fetch = jest.fn() as jest.Mock;
  // `resetAllMocks` below strips React Native's own AppState mock, and every zonal screen now
  // listens to it for the live beat.
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<
      typeof AppState.addEventListener
    >);
});

afterEach(() => jest.resetAllMocks());

describe('DashboardScreen', () => {
  const render = (onOpenEvent = jest.fn()) =>
    renderWithStore(<DashboardScreen zoneName="Ayodhya Zone" onOpenEvent={onOpenEvent} />);

  it('leads with today, this week and this month, a colour each', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-today'));
    expect(screen.getByTestId('zonal-today')).toHaveTextContent(/Today\s*7/);
    expect(screen.getByTestId('zonal-week')).toHaveTextContent(/This week\s*21\s*Last 7 days/);
    expect(screen.getByTestId('zonal-month')).toHaveTextContent(/This month\s*84/);
    expect(screen.getByTestId('zonal-today')).toHaveStyle({ backgroundColor: colors.primaryWash });
    expect(screen.getByTestId('zonal-week')).toHaveStyle({ backgroundColor: colors.infoWash });
    expect(screen.getByTestId('zonal-month')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    // The zone is the hero's title now, so it is not repeated in a pill beside it.
    expect(screen.getByTestId('zonal-dashboard-hero')).toHaveTextContent(/Ayodhya Zone/);
  });

  it('says how fresh the figures are, and fetches again when that line is tapped', async () => {
    mockApi();
    render();

    await waitFor(() =>
      expect(screen.getByTestId('zonal-live')).toHaveTextContent(/Live · updated/),
    );
    const before = dashboardCalls();
    fireEvent.press(screen.getByTestId('zonal-live'));
    await waitFor(() => expect(dashboardCalls()).toBeGreaterThan(before));
  });

  it('puts each day’s count on a yellow disc above its bar', async () => {
    mockApi();
    render();

    const today = TREND[TREND.length - 1]!;
    await waitFor(() => screen.getByTestId(`zonal-trend-${today.date}-count`));
    expect(screen.getByTestId(`zonal-trend-${today.date}-count`)).toHaveTextContent('7');
    expect(screen.getByTestId(`zonal-trend-${today.date}-count`)).toHaveStyle({
      backgroundColor: yolk[400],
    });
  });

  it('asks the server for a week of bars, and draws them on a green card', async () => {
    const seen: string[] = [];
    mockApi(request => {
      seen.push(request.url);
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-trend-card'));
    expect(seen.some(url => url.includes('/zonal/dashboard/') && url.includes('days=7'))).toBe(
      true,
    );
    expect(screen.getByTestId('zonal-trend-card')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
  });

  it('says which way the day went against yesterday', async () => {
    mockApi();
    render();

    // Signed, because "2" alone does not say whether the zone is up or down.
    await waitFor(() =>
      expect(screen.getByTestId('zonal-today')).toHaveTextContent(/\+2 on yesterday/),
    );
  });

  it('draws a bar for every day, including the quiet ones', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-trend'));
    // Fourteen columns for a fortnight — a chart built only from the busy days would
    // compress a quiet week into a busy-looking line.
    TREND.forEach(day => expect(screen.getByTestId(`zonal-trend-${day.date}`)).toBeTruthy());
  });

  it('names who and where the work came from, and what just happened', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-top-mait-4'));
    // Every fact labelled, because a code read back over the phone has to be the right one.
    expect(screen.getByTestId('zonal-top-mait-4')).toHaveTextContent(/Mait name: Sunil Kumar/);
    expect(screen.getByTestId('zonal-top-mait-4')).toHaveTextContent(/Vendor code: 5500000054/);
    expect(screen.getByTestId('zonal-top-village-001302')).toHaveTextContent(
      /MPP: BARSANA · 001302/,
    );
    expect(screen.getByTestId('zonal-capture-900')).toHaveTextContent(/MURRAH/);
    expect(screen.getByTestId('zonal-capture-900')).toHaveTextContent(/MPP: BARSANA · 001302/);
    expect(screen.getByTestId('zonal-capture-900')).toHaveTextContent(
      /Mait: Sunil Kumar · 5500000054/,
    );
  });

  it('gives the people, the places and the feed a colour each', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-busiest-maits'));
    expect(screen.getByTestId('zonal-busiest-maits')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('zonal-busiest-villages')).toHaveStyle({
      backgroundColor: colors.infoWash,
    });
    expect(screen.getByTestId('zonal-capture-900')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
  });

  it('keeps unfinished captures out of the day’s count and says so', async () => {
    mockApi();
    render();

    // Counting them as work done would overstate the zone every single day.
    await waitFor(() => screen.getByTestId('zonal-in-progress'));
    expect(screen.getByTestId('zonal-in-progress')).toHaveTextContent(/2 captures still/);
  });

  it('opens the whole record from a row in the feed', async () => {
    const onOpenEvent = jest.fn();
    mockApi();
    render(onOpenEvent);

    fireEvent.press(await screen.findByTestId('zonal-capture-900'));
    expect(onOpenEvent).toHaveBeenCalledWith(900);
  });
});

describe('EventScreen', () => {
  const render = () => renderWithStore(<EventScreen eventId={900} zoneName="Ayodhya Zone" />);

  it('leads with the four figures a dispute is settled with', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-straw'));
    // The tile leads with the doses, because that is what the flask is short of; the number
    // is on the line under it, where a depot slip is checked against it.
    expect(screen.getByTestId('zonal-event-straw')).toHaveTextContent(/2 doses/);
    expect(screen.getByTestId('zonal-event-straw')).toHaveTextContent(/T0001-HF-0002/);
    expect(screen.getByTestId('zonal-event-straw')).toHaveTextContent(/deducted/);
    expect(screen.getByTestId('zonal-event-payment')).toHaveTextContent(/300/);
    expect(screen.getByTestId('zonal-event-location')).toHaveTextContent(/26.7920/);
    expect(screen.getByTestId('zonal-event-status')).toHaveTextContent(/Completed/);
  });

  it('gives every tile the line of context that turns a figure into an answer', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-payment'));
    // "₹ 300" alone is a prompt to go and look; with the mode and the state under it, it is
    // an answer.
    expect(screen.getByTestId('zonal-event-payment')).toHaveTextContent(
      /Cash on delivery · Verified/,
    );
    expect(screen.getByTestId('zonal-event-location')).toHaveTextContent(/handset's own position/);
    expect(screen.getByTestId('zonal-event-status')).toHaveTextContent(/Completed 18 Sep 2026/);
  });

  it('says what an unfinished record is waiting on, rather than stopping mid-trail', async () => {
    mockApi(request => {
      if (request.url.includes('/zonal/events/')) {
        return jsonResponse({
          ...EVENT,
          status: 'payment_pending',
          status_display: 'Payment pending',
          completed_at: null,
          timeline: [EVENT.timeline[0]!],
        });
      }
      return undefined;
    });
    render();

    // A hollow bead with the next step named — nobody should have to work out whether a
    // record is finished or stuck.
    await waitFor(() => screen.getByTestId('zonal-event-step-waiting'));
    expect(screen.getByTestId('zonal-event-step-waiting')).toHaveTextContent(
      /Waiting on the payment to be verified/,
    );
  });

  it('names whose capture it was, and whose animal', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-who'));
    expect(screen.getByTestId('zonal-event-who')).toHaveTextContent(/Kavita Devi/);
    expect(screen.getByTestId('zonal-event-who')).toHaveTextContent(/Sunil Kumar/);
    expect(screen.getByTestId('zonal-event-who')).toHaveTextContent(/MURRAH/);
  });

  it('shows the proof photo and says where it came from', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-photo'));
    expect(screen.getByTestId('zonal-event-photo-card')).toHaveTextContent(/Taken through the app/);
  });

  it('opens the photo full size', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('zonal-event-photo'));
    await waitFor(() => screen.getByTestId('zonal-event-photo-close'));
  });

  it('says plainly when there is no photograph rather than showing a broken frame', async () => {
    mockApi(request => {
      if (request.url.includes('/zonal/events/')) {
        return jsonResponse({ ...EVENT, ai_photo_url: '' });
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-event-no-photo'));
    expect(screen.queryByTestId('zonal-event-photo')).toBeNull();
  });

  it('carries the coordinates and a way to drive to them', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-gps'));
    expect(screen.getByTestId('zonal-event-gps')).toHaveTextContent(/26.7920/);
    expect(screen.getByTestId('zonal-event-open-maps')).toBeTruthy();
  });

  it('says so when no position was recorded', async () => {
    mockApi(request => {
      if (request.url.includes('/zonal/events/')) {
        return jsonResponse({ ...EVENT, gps_lat: null, gps_lng: null });
      }
      return undefined;
    });
    render();

    await waitFor(() => expect(screen.getByText('No position was recorded.')).toBeTruthy());
    expect(screen.queryByTestId('zonal-event-open-maps')).toBeNull();
  });

  it('lists what came off the Mait’s bag', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-used'));
    expect(screen.getByTestId('zonal-event-used')).toHaveTextContent(/Sheath/);
    expect(screen.getByTestId('zonal-event-used')).toHaveTextContent(/2 piece/);
  });

  /**
   * The colour, not the copy.
   *
   * The screen shipped as a column of identical white cards, and the fault was not plainness
   * — it was that every card claimed the same weight. These assert the tokens themselves,
   * because a test that only reads the words passes just as happily on a screen where nothing
   * is told apart from anything else.
   */
  it('draws what was used in the blue the portal and the Mait’s app draw it in', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-used'));
    expect(screen.getByTestId('zonal-event-used')).toHaveStyle({
      backgroundColor: colors.infoWash,
      borderColor: colors.info,
    });
  });

  it('tints the location by whether there is a fix at all', async () => {
    mockApi();
    render();

    // Blue for a fact about the situation…
    await waitFor(() => screen.getByTestId('zonal-event-location'));
    expect(screen.getByTestId('zonal-event-location')).toHaveStyle({
      backgroundColor: colors.infoWash,
    });
  });

  it('turns the location yolk when nothing was recorded', async () => {
    mockApi(request => {
      if (request.url.includes('/zonal/events/')) {
        return jsonResponse({ ...EVENT, gps_lat: null, gps_lng: null });
      }
      return undefined;
    });
    render();

    // …and yolk when there is none: a record with no position is not wrong, it is missing the
    // one thing that ties it to a village.
    await waitFor(() => screen.getByTestId('zonal-event-location'));
    expect(screen.getByTestId('zonal-event-location')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
  });

  it('moves the payment tile from yolk to green as the money clears', async () => {
    mockApi(request => {
      if (request.url.includes('/zonal/events/')) {
        return jsonResponse({
          ...EVENT,
          payment: { ...EVENT.payment!, is_verified: false, status: 'pending' },
        });
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-event-payment'));
    expect(screen.getByTestId('zonal-event-payment')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
  });

  it('answers whether it took', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-check-77'));
    expect(screen.getByTestId('zonal-event-check-77')).toHaveTextContent(/Pregnant/);
    // The day, the month and the year, never the server's ISO string.
    expect(screen.getByTestId('zonal-event-check-77')).toHaveTextContent(/17 Dec 2026/);
  });

  it('gives the straw, the people, the outcome and the trail a colour each', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-straw'));
    expect(screen.getByTestId('zonal-event-straw')).toHaveStyle({
      backgroundColor: colors.infoWash,
    });
    expect(screen.getByTestId('zonal-event-who')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('zonal-event-chain')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('zonal-event-trail')).toHaveStyle({ backgroundColor: ink[50] });
  });

  it('carries its number on a pill, and no back arrow', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-hero-tag'));
    expect(screen.getByTestId('zonal-event-hero-tag')).toHaveTextContent(/900/);
    // Left by the handset's back or the tab bar, not by an arrow in the hero.
    expect(screen.queryByTestId('store-back')).toBeNull();
  });

  it('says in the hero whose animal it was, where, and by whom — with the codes', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-owner-kind'));
    expect(screen.getByTestId('zonal-event-owner-kind')).toHaveTextContent(/Member$/);
    expect(screen.getByTestId('zonal-event-hero-mpp')).toHaveTextContent(/BARSANA · 001302/);
    expect(screen.getByTestId('zonal-event-hero-mait')).toHaveTextContent(/Sunil Kumar/);
  });

  it('prints every line of the straw tile, the deduction included', async () => {
    mockApi();
    render();

    // Once a two-line note, and the word cut off was always the last — "Dedu…".
    await waitFor(() => screen.getByTestId('zonal-event-straw'));
    expect(screen.getByTestId('zonal-event-straw')).toHaveTextContent(/T0001-HF-0002/);
    expect(screen.getByTestId('zonal-event-straw')).toHaveTextContent(/deducted/i);
  });

  it('draws the trail, and says it cannot be edited', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-event-step-1'));
    expect(screen.getByTestId('zonal-event-trail')).toHaveTextContent(/Straw verified/);
    expect(screen.getByTestId('zonal-event-trail')).toHaveTextContent(/never edited/);
  });
});

describe('AllEventsScreen', () => {
  const ROW = {
    id: 900,
    status: 'completed',
    status_display: 'Completed',
    owner_type: 'member' as const,
    owner_name: 'Kavita Devi',
    mpp_name: 'BARSANA',
    mpp_code: '001302',
    mait_name: 'Sunil Kumar',
    mait_code: '5500000054',
    breed: 'MURRAH',
    doses: 1,
    created_at: '2026-09-18T05:40:00Z',
    completed_at: '2026-09-18T06:24:00Z',
  };

  const page = (rows: (typeof ROW)[], count: number, hasMore: boolean) =>
    jsonResponse({
      count,
      results: rows,
      date_from: null,
      date_to: null,
      limit: 30,
      offset: 0,
      has_more: hasMore,
    });

  const asked = (): string[] =>
    (global.fetch as jest.Mock).mock.calls
      .map(([input]) => (typeof input === 'string' ? input : input.url))
      .filter((url: string) => url.includes('/zonal/events/'));

  it('lists the zone’s events, each naming who, where and by whom', async () => {
    mockApi(request =>
      request.url.includes('/zonal/events/') ? page([ROW], 1, false) : undefined,
    );
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

    await waitFor(() => screen.getByTestId('zonal-events-row-900'));
    const row = screen.getByTestId('zonal-events-row-900');
    expect(row).toHaveTextContent(/Kavita Devi/);
    expect(row).toHaveTextContent(/Member/);
    expect(row).toHaveTextContent(/MPP: BARSANA · 001302/);
    expect(row).toHaveTextContent(/Mait: Sunil Kumar · 5500000054/);
    // Coloured by its state, not a white card.
    expect(row).toHaveStyle({ backgroundColor: colors.primaryWash });
    expect(screen.getByText('1 AI event')).toBeTruthy();
  });

  it('has no back arrow — the handset’s back and the Profile tab lead out', async () => {
    mockApi(request =>
      request.url.includes('/zonal/events/') ? page([ROW], 1, false) : undefined,
    );
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

    await waitFor(() => screen.getByTestId('zonal-events-row-900'));
    expect(screen.queryByTestId('store-back')).toBeNull();
  });

  it('asks for a whole range in one tap from the picker', async () => {
    mockApi(request =>
      request.url.includes('/zonal/events/') ? page([ROW], 1, false) : undefined,
    );
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('zonal-events-dates'));
    fireEvent.press(screen.getByTestId('date-range-preset-month'));
    const now = new Date();
    const from = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    // The two ends fill in at the top of the sheet before anything is applied.
    expect(screen.getByTestId('date-range-from')).toHaveTextContent(
      new RegExp(`^.*${new Date(now.getFullYear(), now.getMonth(), 1).getDate()} `),
    );
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() => expect(asked().some(url => url.includes(`date_from=${from}`))).toBe(true));
  });

  it('opens the record behind a row', async () => {
    const onOpen = jest.fn();
    mockApi(request =>
      request.url.includes('/zonal/events/') ? page([ROW], 1, false) : undefined,
    );
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={onOpen} />);

    fireEvent.press(await screen.findByTestId('zonal-events-row-900'));
    expect(onOpen).toHaveBeenCalledWith(900);
  });

  it('asks for the next page only when somebody wants it', async () => {
    mockApi(request => {
      if (!request.url.includes('/zonal/events/')) {
        return undefined;
      }
      return request.url.includes('offset=30')
        ? page([{ ...ROW, id: 870 }], 31, false)
        : page([ROW], 31, true);
    });
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('zonal-events-more'));
    await waitFor(() => screen.getByTestId('zonal-events-row-870'));
    // Both pages on screen, and no third button.
    expect(screen.getByTestId('zonal-events-row-900')).toBeTruthy();
    expect(screen.queryByTestId('zonal-events-more')).toBeNull();
  });

  it('asks the server for the dates chosen, from and to', async () => {
    mockApi(request =>
      request.url.includes('/zonal/events/') ? page([ROW], 1, false) : undefined,
    );
    renderWithStore(<AllEventsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

    fireEvent.press(await screen.findByTestId('zonal-events-dates'));
    const now = new Date();
    const from = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = isoDate(now);
    fireEvent.press(screen.getByTestId(`date-range-day-${from}`));
    fireEvent.press(screen.getByTestId(`date-range-day-${to}`));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() => {
      expect(asked().some(url => url.includes(`date_from=${from}`))).toBe(true);
      expect(asked().some(url => url.includes(`date_to=${to}`))).toBe(true);
    });
    // The boxes say what is in force, and there is a way back to every date.
    expect(screen.getByTestId('zonal-events-clear')).toBeTruthy();
  });
});

describe('IndentsScreen', () => {
  const render = () =>
    renderWithStore(<IndentsScreen zoneName="Ayodhya Zone" onOpen={jest.fn()} />);

  it('answers what is waiting before a row is read', async () => {
    mockApi();
    render();

    await waitFor(() => expect(screen.getByText('3 waiting on you · oldest 6d')).toBeTruthy());
    expect(screen.getByTestId('zonal-waiting-tile')).toHaveTextContent(/3/);
    expect(screen.getByTestId('zonal-at-depot')).toHaveTextContent(/2/);
  });

  it('says in one word what approving would actually get the Mait', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-approval-13'));
    expect(screen.getByTestId('zonal-approval-13-pill')).toHaveTextContent('Ready');
    expect(screen.getByTestId('zonal-approval-14-pill')).toHaveTextContent('Depot has 7');
    expect(screen.getByTestId('zonal-approval-11-pill')).toHaveTextContent('Depot empty');
    // Not a stock problem, so not drawn as one — this one is issued from the portal.
    expect(screen.getByTestId('zonal-approval-9-pill')).toHaveTextContent('No depot');
  });

  it('finds a request by its number or the Mait’s name', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-approval-13'));
    fireEvent.changeText(screen.getByTestId('zonal-find-input'), 'IND-14');
    expect(screen.queryByTestId('zonal-approval-13')).toBeNull();
    expect(screen.getByTestId('zonal-approval-14')).toBeTruthy();
  });

  it('puts a Mait’s list on one card, with every item on it', async () => {
    mockApi(request =>
      request.url.includes('/zonal/approvals/')
        ? jsonResponse({ count: LIST.length, results: LIST })
        : undefined,
    );
    render();

    await waitFor(() => screen.getByTestId('zonal-approval-20'));
    const card = screen.getByTestId('zonal-approval-20');
    expect(card).toHaveTextContent(/Sunil Kumar/);
    expect(card).toHaveTextContent(/Vendor code: 5500000054/);
    expect(card).toHaveTextContent(/Murrah/);
    expect(card).toHaveTextContent(/Gloves/);
    expect(card).toHaveTextContent(/2 items/);
    // The card wears its worst item: an empty shelf for the gloves.
    expect(card).toHaveStyle({ backgroundColor: colors.errorWash });
    expect(screen.queryByTestId('zonal-approval-21')).toBeNull();
  });

  it('keeps two trips to the request screen as two requests', () => {
    const later = approval({ id: 30, requested_at: '2026-09-19T09:00:00Z' });
    const groups = groupIndents([...LIST, later]);
    expect(groups.map(group => group.rows.map(row => row.id))).toEqual([[20, 21], [30]]);
    // Different Maits are never merged, however close together they asked.
    expect(groupIndents(QUEUE)).toHaveLength(4);
  });

  it('matches a Mait by name, code or indent number', () => {
    expect(matches(approval(), 'sunil')).toBe(true);
    expect(matches(approval(), '5500000054')).toBe(true);
    expect(matches(approval(), 'IND-13')).toBe(true);
    expect(matches(approval(), 'IND-14')).toBe(false);
  });
});

describe('ApprovalScreen', () => {
  const onDecided = jest.fn();
  const render = (...rows: ZonalApproval[]) => {
    const list = rows.length ? rows : [approval()];
    return renderWithStore(
      <ApprovalScreen
        group={{ key: list[0]!.id, rows: list }}
        zoneName="Ayodhya Zone"
        onBack={jest.fn()}
        onDecided={onDecided}
      />,
    );
  };

  beforeEach(() => onDecided.mockClear());

  it('carries both figures the decision turns on', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-mait-holds'));
    expect(screen.getByTestId('zonal-mait-holds')).toHaveTextContent(/2/);
    expect(screen.getByTestId('zonal-in-store')).toHaveTextContent(/40/);
    expect(screen.getByTestId('zonal-decision-pill')).toHaveTextContent('Ready');
  });

  it('names the depot that is short, and by how much', async () => {
    mockApi();
    render(approval({ id: 14, coverage: 'short', in_store: 7 }));

    await waitFor(() => expect(screen.getByText(/Barsana depot has 7 of the 25/)).toBeTruthy());
  });

  it('approves through the indents endpoint, not a second write path', async () => {
    const calls: string[] = [];
    mockApi(request => {
      if (request.method === 'POST') {
        calls.push(request.url);
        return jsonResponse({ id: 13, status: 'approved' });
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-approve'));
    fireEvent.press(screen.getByTestId('zonal-approve'));

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/indents/13/approve/');
  });

  it('will not reject without a reason', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-open-reject'));
    fireEvent.press(screen.getByTestId('zonal-open-reject'));

    await waitFor(() => screen.getByTestId('zonal-reject-confirm'));
    fireEvent.press(screen.getByTestId('zonal-reject-confirm'));
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('sends the reason with the rejection', async () => {
    let body = '';
    (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
      if (input.method === 'POST') {
        body = await input.text();
        return jsonResponse({ id: 13, status: 'rejected' });
      }
      if (input.url.includes('/zonal/approvals/')) {
        return jsonResponse({ count: QUEUE.length, results: QUEUE });
      }
      return jsonResponse({});
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-open-reject'));
    fireEvent.press(screen.getByTestId('zonal-open-reject'));
    await waitFor(() => screen.getByTestId('zonal-reason-input'));

    fireEvent.changeText(
      screen.getByTestId('zonal-reason-input'),
      'Nothing on the shelf until Friday',
    );
    fireEvent.press(screen.getByTestId('zonal-reject-confirm'));

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(body).toContain('Nothing on the shelf until Friday');
  });

  it('draws Reject as a red button beside Approve, not a line of text', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-open-reject'));
    expect(screen.getByTestId('zonal-open-reject')).toHaveStyle({ borderColor: colors.error });
    expect(screen.getByTestId('zonal-open-reject')).toHaveTextContent(/Reject$/);
  });

  it('shows the whole list a Mait raised, each item in the colour of its shelf', async () => {
    mockApi(request =>
      request.url.includes('/zonal/approvals/')
        ? jsonResponse({ count: LIST.length, results: LIST })
        : undefined,
    );
    render(...LIST);

    await waitFor(() => screen.getByTestId('zonal-decision-item-20'));
    expect(screen.getByTestId('zonal-decision-hero')).toHaveTextContent(/2 items requested/);
    expect(screen.getByTestId('zonal-decision-item-20')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('zonal-decision-item-21')).toHaveTextContent(/Gloves/);
    expect(screen.getByTestId('zonal-decision-item-21')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('zonal-decision-note')).toHaveTextContent(/Out of gloves/);
    expect(screen.getByTestId('zonal-approve')).toHaveTextContent(/Approve all 2/);
    expect(screen.getByTestId('zonal-open-reject')).toHaveTextContent(/Reject all/);
  });

  it('approves one item of a request and leaves the other waiting', async () => {
    const calls: string[] = [];
    mockApi(request => {
      if (request.method === 'POST') {
        calls.push(request.url);
        return jsonResponse({ status: 'approved' });
      }
      return request.url.includes('/zonal/approvals/')
        ? jsonResponse({ count: LIST.length, results: LIST })
        : undefined;
    });
    render(...LIST);

    fireEvent.press(await screen.findByTestId('zonal-item-approve-20'));

    await waitFor(() => expect(calls.length).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('zonal-decision-item-20')).toBeNull());
    expect(calls).toEqual([expect.stringContaining('/indents/20/approve/')]);
    expect(screen.getByTestId('zonal-decision-item-21')).toBeTruthy();
    expect(onDecided).not.toHaveBeenCalled();
  });

  it('approves the whole request at once, one indent at a time', async () => {
    const calls: string[] = [];
    mockApi(request => {
      if (request.method === 'POST') {
        calls.push(request.url);
        return jsonResponse({ status: 'approved' });
      }
      return request.url.includes('/zonal/approvals/')
        ? jsonResponse({ count: LIST.length, results: LIST })
        : undefined;
    });
    render(...LIST);

    fireEvent.press(await screen.findByTestId('zonal-approve'));

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([
      expect.stringContaining('/indents/20/approve/'),
      expect.stringContaining('/indents/21/approve/'),
    ]);
  });

  it('shows the server’s own words when the decision is refused', async () => {
    mockApi(request => {
      if (request.method === 'POST') {
        return problemResponse(
          409,
          'invalid-state-transition',
          'IND-13 is approved, so it cannot be approved.',
        );
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-approve'));
    fireEvent.press(screen.getByTestId('zonal-approve'));

    await waitFor(() => expect(screen.getByText(/cannot be approved/)).toBeTruthy());
    expect(onDecided).not.toHaveBeenCalled();
  });
});

describe('ZoneStockScreen', () => {
  const render = () => renderWithStore(<ZoneStockScreen zoneName="Ayodhya Zone" />);

  it('opens on the places, worst first', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-place-2202'));
    expect(screen.getByTestId('zonal-place-2202')).toHaveTextContent(/1 at zero/);
    expect(screen.getByTestId('zonal-place-2202')).toHaveTextContent(/No depot serves this centre/);
  });

  it('puts what could fix it on the same card as the problem', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-place-1101'));
    expect(screen.getByTestId('zonal-place-1101')).toHaveTextContent(/Barsana depot/);
    expect(screen.getByTestId('zonal-place-1101')).toHaveTextContent(/222 free to issue/);
  });

  it('switches to the Maits behind them, and names the centres they also cover', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-stock-view-maits'));
    fireEvent.press(screen.getByTestId('zonal-stock-view-maits'));

    await waitFor(() => screen.getByTestId('zonal-mait-5'));
    expect(screen.getByTestId('zonal-mait-5')).toHaveTextContent(/At zero/);
    expect(screen.getByTestId('zonal-mait-4')).toHaveTextContent(/also BAHRAICH BMC/);
  });

  it('colours each centre, Mait and depot by its state', async () => {
    mockApi();
    render();

    // A centre with somebody at zero is red; one where everybody can work is green.
    await waitFor(() => screen.getByTestId('zonal-place-2202'));
    expect(screen.getByTestId('zonal-place-2202')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    expect(screen.getByTestId('zonal-place-1101')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('zonal-place-1101')).toHaveTextContent(/All stocked/);

    fireEvent.press(screen.getByTestId('zonal-stock-view-maits'));
    await waitFor(() => screen.getByTestId('zonal-mait-5'));
    expect(screen.getByTestId('zonal-mait-5')).toHaveStyle({ backgroundColor: colors.errorWash });
    expect(screen.getByTestId('zonal-mait-4')).toHaveTextContent(/Vendor code: 5500000054/);

    fireEvent.press(screen.getByTestId('zonal-stock-view-stores'));
    await waitFor(() => screen.getByTestId('zonal-store-1'));
    expect(screen.getByTestId('zonal-store-1')).toHaveStyle({ backgroundColor: colors.infoWash });
    // One shelf in plain words: part packed for Maits, the rest still free to give out.
    expect(screen.getByTestId('zonal-store-1-shelf')).toHaveTextContent(
      /240 straws in this depot.*222 can still be given out.*18 packed for Maits/,
    );
  });

  it('shows every product by category, with what is on its way', async () => {
    mockApi();
    render();

    fireEvent.press(await screen.findByTestId('zonal-stock-view-products'));
    await waitFor(() => screen.getByTestId('zonal-product-straw:MURRAH'));
    const murrah = screen.getByTestId('zonal-product-straw:MURRAH');
    expect(murrah).toHaveTextContent(/140.*With Maits.*held by 1 Mait/);
    expect(murrah).toHaveTextContent(/240.*In depots.*222 free to give/);
    // Asked, agreed and packed: the three steps between a request and a Mait's flask.
    expect(screen.getByTestId('zonal-product-straw:MURRAH-way')).toHaveTextContent(
      /25 asked.*5 agreed.*18 packed/,
    );
    expect(murrah).toHaveStyle({ backgroundColor: colors.infoWash });

    fireEvent.press(screen.getByTestId('zonal-category-consumable'));
    const gloves = await screen.findByTestId('zonal-product-consumable:7');
    // Nobody has gloves, the depot has none, and somebody is asking: that is the red word.
    expect(gloves).toHaveTextContent(/Depot empty/);
    expect(gloves).toHaveStyle({ backgroundColor: colors.primaryWash });

    fireEvent.press(screen.getByTestId('zonal-category-asset'));
    expect(await screen.findByTestId('zonal-product-consumable:9')).toHaveTextContent(/AI gun/);
  });

  it('switches to the depots', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-stock-view-stores'));
    fireEvent.press(screen.getByTestId('zonal-stock-view-stores'));

    await waitFor(() => screen.getByTestId('zonal-store-1'));
    expect(screen.getByTestId('zonal-store-1')).toHaveTextContent(/18 set aside/);
  });
});

describe('HistoryScreen', () => {
  const render = () => renderWithStore(<HistoryScreen zoneName="Ayodhya Zone" />);

  it('reads back decisions, not a log of everything', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-decision-900'));
    expect(screen.getByTestId('zonal-decision-900')).toHaveTextContent(/IND-13.*You approved/);
    expect(screen.getByTestId('zonal-decision-900')).toHaveTextContent(/25 Murrah/);
    expect(screen.getByTestId('zonal-decision-900')).toHaveTextContent(
      /Mait: Sunil Kumar · 5500000054/,
    );
    // Where it got to since — the reason to look back at your own decision.
    expect(screen.getByTestId('zonal-decision-900')).toHaveTextContent(/Waiting at the depot/);
    expect(screen.getByTestId('zonal-approved-count')).toHaveTextContent(/9/);
    expect(screen.getByTestId('zonal-rejected-count')).toHaveTextContent(/2/);
  });

  it('colours each decision and lights the road it has taken since', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-decision-900'));
    expect(screen.getByTestId('zonal-decision-900')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('zonal-decision-899')).toHaveStyle({
      backgroundColor: colors.errorWash,
    });
    // Approved and waiting at the depot: the road as far as the depot, not yet handed over.
    expect(screen.getByTestId('zonal-decision-900-journey')).toHaveTextContent(
      /Approved.*At the depot.*Handed over/,
    );
    // A rejection has no road — it has the words the Mait was given.
    expect(screen.queryByTestId('zonal-decision-899-journey')).toBeNull();
    expect(screen.getByTestId('zonal-total-count')).toHaveTextContent(/11/);
  });

  it('reads back the reason a Mait was given', async () => {
    mockApi();
    render();

    await waitFor(() => screen.getByTestId('zonal-decision-899'));
    expect(screen.getByTestId('zonal-decision-899')).toHaveTextContent(
      /You said: Nothing on the shelf until Friday/,
    );
  });

  it('filters to one outcome by tapping its figure', async () => {
    const asked: string[] = [];
    mockApi(request => {
      if (request.url.includes('/zonal/history/')) {
        asked.push(request.url);
        return jsonResponse(HISTORY);
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-rejected-count'));
    fireEvent.press(screen.getByTestId('zonal-rejected-count'));

    await waitFor(() => expect(asked.some(url => url.includes('outcome=rejected'))).toBe(true));
  });

  it('asks the server for the window that was chosen', async () => {
    const asked: string[] = [];
    mockApi(request => {
      if (request.url.includes('/zonal/history/')) {
        asked.push(request.url);
        return jsonResponse(HISTORY);
      }
      return undefined;
    });
    render();

    await waitFor(() => screen.getByTestId('zonal-history-window-7'));
    fireEvent.press(screen.getByTestId('zonal-history-window-7'));

    await waitFor(() => expect(asked.some(url => url.includes('days=7'))).toBe(true));
  });
});

describe('ZonalProfileScreen', () => {
  it('gives the zone, the patch and the language a colour and a figure each', async () => {
    mockApi();
    renderWithStore(<ZonalProfileScreen onOpenEvents={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('zonal-profile-maits')).toHaveTextContent(/11/));
    expect(screen.getByTestId('zonal-profile-maits')).toHaveTextContent(/Maits/);
    expect(screen.getByTestId('zonal-profile-depots')).toHaveTextContent(/1\s*Depot$/);
    expect(screen.getByTestId('zonal-profile-zone')).toHaveTextContent(/Ayodhya Zone/);
    expect(screen.getByTestId('zonal-profile-zone')).toHaveStyle({
      backgroundColor: colors.primaryWash,
    });
    expect(screen.getByTestId('zonal-profile-patch')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('zonal-profile-language')).toHaveStyle({ backgroundColor: ink[50] });
  });
});
