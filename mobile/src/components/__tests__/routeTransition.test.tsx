/**
 * The route transition.
 *
 * What is defended here is the set of rules that make it useful rather than decorative:
 * it names the real destination, it holds long enough to be read, it stays out of the way of
 * a second tap, it does not fire where navigation is already instant, and it disappears
 * entirely for anybody who has asked the handset to keep still.
 *
 * The card's title is the one thing worth more than the rest put together. A card announcing
 * Inventory over a screen that turns out to be AI events is worse than no card at all: the
 * Mait who mistapped now has two things to disbelieve.
 */

import React from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RouteTransitionHost, useRouteTransition } from '../routeTransition';
import type { RouteTransition } from '../routeTransition';
import { ROUTES, announces } from '@/navigation/routes';
import type { RouteKey } from '@/navigation/routes';
import i18n from '@/i18n';

/** A stand-in shell: two pages and the four ways of moving between them. */
function Harness({ onReady }: { onReady?: (t: RouteTransition) => void }): React.JSX.Element {
  const transition = useRouteTransition();
  const [page, setPage] = React.useState('Home');
  onReady?.(transition);

  return (
    <View>
      <RouteTransitionHost transition={transition}>
        {/* Given a testID of its own: the card names the destination too, so a bare text
            query for "Inventory" finds the card and reports the page as having changed
            when it has not. */}
        <Text testID="page">{page}</Text>
      </RouteTransitionHost>
      <Text testID="pending">{transition.pending ?? 'none'}</Text>
      <Text testID="go-stock" onPress={() => transition.go('stock', () => setPage('Inventory'))}>
        go stock
      </Text>
      <Text
        testID="go-history"
        onPress={() => transition.go('history', () => setPage('AI events'))}
      >
        go history
      </Text>
      <Text testID="go-back" onPress={() => transition.back(() => setPage('Home'))}>
        back
      </Text>
      <Text
        testID="go-slide"
        onPress={() => transition.slide('forward', () => setPage('Step two'))}
      >
        slide
      </Text>
    </View>
  );
}

async function renderHarness() {
  let transition: RouteTransition | null = null;
  render(<Harness onReady={t => (transition = t)} />);
  // Reduced motion is read from a promise. Flushed here so the setting is settled before the
  // first navigation, rather than landing mid-test outside act().
  await act(async () => {});
  return () => transition as RouteTransition | null;
}

/** Push the clock on inside act(), so the deferred commit lands where React can see it. */
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('the route registry', () => {
  it('has a real name and a line of context for every destination', () => {
    // The requirement the card lives or dies by: the title is routing data, never a string
    // typed at a call site. A missing key renders as its own path on screen.
    (Object.keys(ROUTES) as RouteKey[]).forEach(key => {
      const meta = ROUTES[key];
      expect(i18n.t(meta.title)).not.toBe(meta.title);
      expect(i18n.t(meta.context)).not.toBe(meta.context);
      expect(i18n.t(meta.title).length).toBeGreaterThan(0);
    });
  });

  it('announces exactly the journeys the brief names', () => {
    // Tabs, the capture flow, and a record opened from a list row. Nothing else — the card is
    // noise anywhere navigation is already instant.
    expect(announces('home')).toBe(true);
    expect(announces('stock')).toBe(true);
    expect(announces('history')).toBe(true);
    expect(announces('settings')).toBe(true);
    expect(announces('capture')).toBe(true);
    expect(announces('aiEventDetail')).toBe(true);
    expect(announces('indentDetail')).toBe(true);

    expect(announces('requestStock')).toBe(false);
    expect(announces('queue')).toBe(false);
    expect(announces('unfinished')).toBe(false);
    expect(announces('indents')).toBe(false);
  });
});

describe('RouteTransition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('names the destination on the card, from the registry', async () => {
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));

    expect(screen.getByTestId('route-card')).toBeTruthy();
    // "Inventory" — what a Mait reads, not "stock", which is what the shell calls it.
    expect(screen.getByTestId('route-card-title')).toHaveTextContent(i18n.t('nav.stock'));
    expect(screen.getByText(i18n.t('route.stockContext'))).toBeTruthy();
  });

  it('holds the old screen for the full 500ms before the route changes', async () => {
    // The rule the whole thing turns on. Committing as soon as the screen is ready would flash
    // the card for eighty milliseconds on a fast handset, which reads as a glitch.
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));

    advance(400);
    expect(screen.getByTestId('page')).toHaveTextContent('Home');

    advance(120);
    expect(screen.getByTestId('page')).toHaveTextContent('Inventory');
  });

  it('lights the destination before the screen behind it has changed', async () => {
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));

    // The tab bar reads this to answer the tap while the old screen is still drawn.
    expect(screen.getByTestId('pending')).toHaveTextContent('stock');

    advance(520);
    expect(screen.getByTestId('pending')).toHaveTextContent('none');
  });

  it('clears the card and the scrim by the end of the 700ms', async () => {
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));
    expect(screen.getByTestId('route-scrim')).toBeTruthy();

    advance(750);

    expect(screen.queryByTestId('route-card')).toBeNull();
    expect(screen.queryByTestId('route-scrim')).toBeNull();
  });

  it('cancels a transition when a second tap lands, and never queues', async () => {
    // A Mait who mistapped taps the right one immediately. The first journey is abandoned,
    // not played out and then followed by the second.
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));
    advance(200);
    fireEvent.press(screen.getByTestId('go-history'));

    expect(screen.getByTestId('route-card-title')).toHaveTextContent(i18n.t('nav.history'));

    // Past where the first one would have committed had it been queued behind the second.
    advance(750);
    expect(screen.getByTestId('page')).toHaveTextContent('AI events');
  });

  it('shows no card going back — reversal is not arrival', async () => {
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-stock'));
    advance(750);

    fireEvent.press(screen.getByTestId('go-back'));
    expect(screen.queryByTestId('route-card')).toBeNull();

    // Still moves: the exit and the settle run, so the screen is not simply replaced.
    expect(screen.getByTestId('route-scrim')).toBeTruthy();
    advance(400);
    expect(screen.getByTestId('page')).toHaveTextContent('Home');
  });

  it('shows no card and no scrim on a step inside the capture flow', async () => {
    // Six cards on a six-step flow would read as six interruptions in one task.
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-slide'));

    expect(screen.queryByTestId('route-card')).toBeNull();
    expect(screen.queryByTestId('route-scrim')).toBeNull();
  });

  it('commits a step immediately, so no step answers slower than it used to', async () => {
    await renderHarness();
    fireEvent.press(screen.getByTestId('go-slide'));

    expect(screen.getByTestId('page')).toHaveTextContent('Step two');
  });
});

describe('with reduced motion asked for', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('drops the card and the scrim, and crosses over in 120ms', async () => {
    await renderHarness();

    fireEvent.press(screen.getByTestId('go-stock'));
    expect(screen.queryByTestId('route-card')).toBeNull();
    expect(screen.queryByTestId('route-scrim')).toBeNull();

    // Halfway through the cross-fade, not four hundred milliseconds later.
    advance(70);
    expect(screen.getByTestId('page')).toHaveTextContent('Inventory');
  });
});
