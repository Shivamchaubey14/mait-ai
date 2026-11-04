/**
 * Home tests (M0).
 *
 * This screen is read at the start of a round and trusted for the rest of it. The cases that
 * matter are the ones where a wrong reading costs a Mait the morning: setting out believing
 * they hold straws they do not, or leaving an insemination half recorded because nothing on
 * the screen said so.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import HomeScreen from '../HomeScreen';
import PullToRefresh from '@/components/pullToRefresh';
import i18n from '@/i18n';
import type { AIEvent, InventorySummary } from '@api/types';
import { loggedIn } from '@/features/auth/authSlice';
import type { AuthUser } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, renderWithStore } from '@/test-utils';
import { colors } from '@theme/tokens';

const SUMMARY: InventorySummary = {
  total_straws: 32,
  is_low_stock: false,
  by_breed: { 'HF Cross': 18, Sahiwal: 12, Murrah: 2 },
  straws: [],
  consumables: [],
  assets: [],
};

function event(overrides: Partial<AIEvent> = {}): AIEvent {
  return {
    id: 1,
    client_uuid: 'uuid-1',
    status: 'completed',
    status_display: 'Completed',
    mpp: 1,
    mpp_code: '001303',
    mpp_name: 'Barsana',
    owner_name: 'Kavita Devi',
    animal: 5,
    animal_type: 'BUFF',
    breed: 'Murrah',
    ear_tag_no: null,
    straw_unique_no: 'STRAW-1',
    ai_photo_url: '',
    created_at: new Date().toISOString(),
    ...overrides,
  } as AIEvent;
}

function mockApi(summary: InventorySummary, events: AIEvent[]) {
  (global.fetch as jest.Mock).mockImplementation((input: string | Request) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/mait/inventory/')) {
      return Promise.resolve(jsonResponse(summary));
    }
    if (url.includes('/ai-events/')) {
      return Promise.resolve(
        jsonResponse({ count: events.length, next: null, previous: null, results: events }),
      );
    }
    return Promise.resolve(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
  });
}

const props = {
  onOpenStock: jest.fn(),
  onStartCapture: jest.fn(),
  onOpenUnfinished: jest.fn(),
  online: true,
  pending: 0,
  onSync: jest.fn(),
  onOpenQueue: jest.fn(),
  lastSyncAt: null,
};

/** Signed in, because the hero reads its name and MPP count off the session. */
function signedInStore(user: Partial<AuthUser> = {}) {
  const store = makeStore();
  store.dispatch(
    loggedIn({
      access: 'a',
      refresh: 'r',
      user: {
        id: 1,
        fullName: 'Sunil Kumar',
        role: 'mait',
        mobileNo: '9876543210',
        maitId: 341,
        sahayakVendorCode: '5500000054',
        ...user,
      },
      assignedMppCodes: ['001303', '001305', '001307'],
    }),
  );
  return store;
}

function render(
  overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {},
  user: Partial<AuthUser> = {},
) {
  return renderWithStore(<HomeScreen {...props} {...overrides} />, {
    store: signedInStore(user),
  });
}

describe('HomeScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  it('names the Mait and the scope they work in', () => {
    mockApi(SUMMARY, []);
    render();

    expect(screen.getByText('Sunil Kumar')).toBeTruthy();
    // The identity and the scope, not a greeting — this line is what a Mait checks when
    // handed a phone that may not be theirs.
    //
    // The Sahayak vendor code, which is what they are known by on their paperwork, in the
    // portal and in SAP. It used to print `maitId` — a row id meaning nothing outside this
    // database — under the same "MAIT" label, so a Mait reading it out to the office would
    // be read back a blank look.
    expect(screen.getByTestId('home-identity')).toHaveTextContent(/MAIT\s*5500000054/);
    expect(screen.getByTestId('home-mait-code')).toHaveTextContent('5500000054');
    expect(screen.getByTestId('home-identity')).not.toHaveTextContent(/341/);
    expect(screen.getByText(/3 MPPs/)).toBeTruthy();
  });

  it('reads in Hindi throughout when Hindi is chosen', async () => {
    await i18n.changeLanguage('hi');
    try {
      mockApi(SUMMARY, []);
      // One record waiting, so the waiting tile is on screen to be read.
      render({ pending: 1 });

      expect(screen.getByText('आज के आपके गर्भाधान')).toBeTruthy();
      expect(screen.getByText('बाकी')).toBeTruthy();
      expect(await screen.findByText('आपके पास सीमेन')).toBeTruthy();
      expect(screen.getByText('नया गर्भाधान शुरू करें')).toBeTruthy();
      expect(screen.getByText('3 गांव मिले')).toBeTruthy();
      // Label and number as two pieces, so the number cannot be pushed off the chip.
      expect(screen.getByText('मैत कोड:')).toBeTruthy();
      expect(screen.getByTestId('home-mait-code')).toHaveTextContent('5500000054');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('says nothing rather than a row id when the code is missing', () => {
    // An account with no Sahayak code behind it. Showing the row id as a fallback would be
    // worse than showing nothing — it looks like an answer.
    mockApi(SUMMARY, []);
    render({}, { sahayakVendorCode: null });

    expect(screen.queryByTestId('home-mait-code')).toBeNull();
    expect(screen.getByText(/3 MPPs/)).toBeTruthy();
  });

  it('carries the logo, the same badge as the splash and the sign-in screen', () => {
    // A Mait hands this phone to a farmer to read a code off it, so the app has to say whose
    // app it is — and with the one logo the product has, not a text pill of its own.
    mockApi(SUMMARY, []);
    render();

    expect(screen.getByTestId('brand-logo')).toBeTruthy();
    expect(screen.getByText('MAIT AI')).toBeTruthy();
    expect(screen.queryByText('FIELD CAPTURE')).toBeNull();
  });

  it('greets the Mait and says what they are known by, as chips', () => {
    mockApi(SUMMARY, []);
    render();

    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    const identity = screen.getByTestId('home-identity');
    expect(identity).toHaveTextContent(/MPP/);
  });

  it('flags the breeds that are nearly out, not just the flask total', async () => {
    // 32 straws is a comfortable day unless the two Murrah left are the ones the next
    // buffalo-keeping farmers need.
    mockApi(SUMMARY, []);
    render();

    await waitFor(() => expect(screen.getByTestId('breed-Murrah')).toBeTruthy());
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getByText('32 total')).toBeTruthy();
  });

  it('names the one unfinished capture, and opens the list', async () => {
    const unfinished = event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' });
    const onOpenUnfinished = jest.fn();
    mockApi(SUMMARY, [unfinished]);
    render({ onOpenUnfinished });

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    // One is named. A Mait with a single thing outstanding should not have to open a list to
    // find out whose it is.
    expect(screen.getByText(/Kavita Devi/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('resume-unfinished'));
    expect(onOpenUnfinished).toHaveBeenCalled();
  });

  it('counts everything that needs the Mait, and opens that list', async () => {
    const onOpenAttention = jest.fn();
    const onOpenUnfinished = jest.fn();
    mockApi(SUMMARY, []);
    render({ attentionCount: 3, onOpenAttention, onOpenUnfinished });

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    expect(screen.getByText('Needs attention — tap to see')).toBeTruthy();
    expect(screen.getByText('3 things need you')).toBeTruthy();

    fireEvent.press(screen.getByTestId('resume-unfinished'));
    expect(onOpenAttention).toHaveBeenCalled();
    expect(onOpenUnfinished).not.toHaveBeenCalled();
  });

  it('shows no red card when nothing needs the Mait', async () => {
    mockApi(SUMMARY, [event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' })]);
    render({ attentionCount: 0, onOpenAttention: jest.fn() });

    await waitFor(() => expect(screen.getByTestId('tile-today')).toBeTruthy());
    expect(screen.queryByTestId('resume-unfinished')).toBeNull();
  });

  it('says an unfinished capture is a fault to put right, in red, in Hindi too', async () => {
    mockApi(SUMMARY, [event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' })]);
    await i18n.changeLanguage('hi');
    try {
      render();

      await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
      expect(screen.getByTestId('resume-unfinished')).toHaveStyle({
        backgroundColor: colors.error,
      });
      expect(screen.getByText('AI अभी अधूरा है, कृपया इसे तत्काल पूर्ण करें')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('counts them once there is more than one', async () => {
    // Home used to surface exactly one — a straw verified today whose photo never arrived —
    // and every other abandoned capture was invisible. For work already done, that is the
    // worst kind of missing record.
    mockApi(SUMMARY, [
      event({ id: 9, status: 'straw_verified', client_uuid: 'uuid-9' }),
      event({ id: 10, status: 'photo_captured', client_uuid: 'uuid-10' }),
      event({ id: 11, status: 'payment_pending', client_uuid: 'uuid-11' }),
    ]);
    render();

    await waitFor(() => expect(screen.getByTestId('resume-unfinished')).toBeTruthy());
    expect(screen.getByText('3 unfinished captures')).toBeTruthy();
  });

  it('says nothing about resuming when today is finished work', async () => {
    mockApi(SUMMARY, [event({ status: 'completed' })]);
    render();

    await waitFor(() => expect(screen.getByTestId('breed-Murrah')).toBeTruthy());
    expect(screen.queryByTestId('resume-unfinished')).toBeNull();
  });

  it('draws the straws in colour: a syringe, a total badge, and a low breed in yolk', async () => {
    mockApi(SUMMARY, []);
    render();

    await waitFor(() => expect(screen.getByTestId('breed-Murrah')).toBeTruthy());
    // Murrah is down to two — yolk, with its Low pill; the others are rows on paper.
    expect(screen.getByTestId('breed-Murrah')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
    });
    expect(screen.getByTestId('breed-Sahiwal')).toHaveStyle({ backgroundColor: colors.surface });
    // A straw is a syringe, never a drop.
    expect(screen.getByTestId('breed-Sahiwal')).toHaveTextContent(/needle/);
    expect(screen.getByTestId('home-straw-total')).toHaveTextContent('32 total');
  });

  it('turns the button blue, not grey, when there are no straws to start with', async () => {
    mockApi({ ...SUMMARY, total_straws: 0, by_breed: {} }, []);
    render();

    await waitFor(() => expect(screen.getByText('See stock')).toBeTruthy());
    expect(screen.getByTestId('home-start-ai')).toHaveStyle({ backgroundColor: colors.info });
  });

  it('sends a Mait with no straws to stock rather than into a capture', async () => {
    // The flow would stop dead at the scan step, with an animal already served.
    const onStartCapture = jest.fn();
    const onOpenStock = jest.fn();
    mockApi({ ...SUMMARY, total_straws: 0, by_breed: {} }, []);
    render({ onStartCapture, onOpenStock });

    await waitFor(() => expect(screen.getByText('See stock')).toBeTruthy());
    fireEvent.press(screen.getByTestId('home-start-ai'));

    expect(onOpenStock).toHaveBeenCalled();
    expect(onStartCapture).not.toHaveBeenCalled();
  });

  it('says the work is held on this phone while offline', () => {
    mockApi(SUMMARY, []);
    render({ online: false });
    expect(screen.getByTestId('sync-offline')).toBeTruthy();
  });

  it('says today’s count on one slim line, the number in a pill', async () => {
    mockApi(SUMMARY, [
      event({ id: 1, status: 'completed' }),
      event({ id: 2, status: 'completed' }),
    ]);
    render();

    expect(screen.getByTestId('tile-today')).toHaveTextContent(/Inseminations today/);
    await waitFor(() => expect(screen.getByTestId('tile-today-count')).toHaveTextContent('2'));
  });

  it('shows the all-time total off the server count, and narrows it by date', async () => {
    const urls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation((input: string | Request) => {
      const url = typeof input === 'string' ? input : input.url;
      urls.push(url);
      if (url.includes('/mait/inventory/')) {
        return Promise.resolve(jsonResponse(SUMMARY));
      }
      // The total is read off `count`, whatever the page holds.
      const count = url.includes('date_from') ? 12 : url.includes('status=completed') ? 1480 : 0;
      return Promise.resolve(jsonResponse({ count, next: null, previous: null, results: [] }));
    });
    render();

    expect(screen.getByTestId('tile-total')).toHaveTextContent(/Total inseminations/);
    expect(screen.getByTestId('tile-total-range')).toHaveTextContent('Completed · all time');
    await waitFor(() => expect(screen.getByTestId('tile-total-count')).toHaveTextContent('1,480'));

    fireEvent.press(screen.getByTestId('tile-total-dates'));
    fireEvent.press(await screen.findByTestId('date-range-preset-today'));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    await waitFor(() => expect(screen.getByTestId('tile-total-count')).toHaveTextContent('12'));
    expect(screen.getByTestId('tile-total-range')).not.toHaveTextContent(/all time/);
    expect(
      urls.some(u => /status=completed/.test(u) && /date_from=/.test(u) && /date_to=/.test(u)),
    ).toBe(true);
  });

  it('shows the waiting tile only while something is waiting to go', () => {
    mockApi(SUMMARY, []);
    const { rerender } = render({ pending: 0 });
    expect(screen.queryByTestId('tile-waiting')).toBeNull();

    rerender(<HomeScreen {...props} pending={2} />);
    expect(screen.getByTestId('tile-waiting')).toHaveTextContent(/2/);
  });

  it('opens the waiting list from the tile, and only from the tile', async () => {
    const onOpenQueue = jest.fn();
    const onSync = jest.fn();
    mockApi(SUMMARY, []);
    render({ pending: 3, onOpenQueue, onSync });

    fireEvent.press(screen.getByTestId('tile-waiting'));

    expect(onOpenQueue).toHaveBeenCalled();
  });

  it('blames the network, not the app, when the handset has no signal', async () => {
    // The two failures need different answers. With no signal a Mait should carry on working
    // — the queue is built for it — and the card has to say so rather than implying the app
    // is broken and their morning is at risk.
    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new TypeError('offline')));
    render({ online: false, pending: 3 });

    await waitFor(() => expect(screen.getByTestId('stock-error')).toBeTruthy());
    // Scoped: both the flask and the events list fail together here, so there are two cards.
    const card = within(screen.getByTestId('stock-error'));
    expect(card.getByTestId('problem-title')).toHaveTextContent(i18n.t('problem.offline.title'));
    // Named, not vague: "your 3 records" is the answer, "your work is safe" is not.
    expect(card.getByTestId('problem-reassurance')).toHaveTextContent(/3/);
  });

  it('blames the server when the handset has signal and the server does not answer', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => Promise.reject(new TypeError('down')));
    render({ online: true, lastSyncAt: '9:48' });

    await waitFor(() => expect(screen.getByTestId('stock-error')).toBeTruthy());
    const card = within(screen.getByTestId('stock-error'));
    expect(card.getByTestId('problem-title')).toHaveTextContent(i18n.t('problem.server.title'));
    // When it last worked, so a Mait can tell a two-minute blip from a dead morning.
    expect(card.getByText(/9:48/)).toBeTruthy();
  });

  it('stays on Home when the page is pulled down to refresh', async () => {
    // The two shared a prop, so the gesture that everywhere else means "show me this screen
    // again" was the one way to leave it.
    const onOpenQueue = jest.fn();
    const onSync = jest.fn();
    mockApi(SUMMARY, []);
    render({ pending: 3, onOpenQueue, onSync });

    // Reached through the container rather than through the pan gesture: what is under test
    // is what a completed pull *does*, and driving PanResponder here would be testing React
    // Native's gesture arbitration instead.
    const pull = screen.UNSAFE_getByType(PullToRefresh);
    await act(async () => {
      await pull.props.onRefresh();
    });

    expect(onSync).toHaveBeenCalled();
    expect(onOpenQueue).not.toHaveBeenCalled();
  });
});
