/**
 * Pull to refresh.
 *
 * The dots are a gauge before they are an animation, and that is what most of this defends:
 * how many are lit says how far the pull has got, three green is the only promise that
 * releasing will do something, and the tick is the only thing that says it finished.
 *
 * The other half is the rules that keep it out of the way — a refresh that fails still ends
 * in a tick, a fast one still lasts long enough to be seen, and nothing here ever tells a Mait
 * that something is "loading".
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import PullToRefresh, { RefreshDots } from '../pullToRefresh';
import type { PullHandle } from '../pullToRefresh';
import i18n from '@/i18n';

const LABEL = 'Checking your holding…';

function dots() {
  return [0, 1, 2].map(index => !!screen.queryByTestId(`refresh-dot-${index}-on`));
}

describe('the dots as a gauge', () => {
  it('lights none below a third of the pull', () => {
    render(<RefreshDots stage="pulling" ratio={0.2} label={LABEL} />);
    expect(dots()).toEqual([false, false, false]);
  });

  it('lights one at a third, two at two thirds, three at the threshold', () => {
    render(<RefreshDots stage="pulling" ratio={0.34} label={LABEL} />);
    expect(dots()).toEqual([true, false, false]);
    screen.unmount();

    render(<RefreshDots stage="pulling" ratio={0.7} label={LABEL} />);
    expect(dots()).toEqual([true, true, false]);
    screen.unmount();

    render(<RefreshDots stage="pulling" ratio={1} label={LABEL} />);
    expect(dots()).toEqual([true, true, true]);
  });

  it('fills left to right, never out of order', () => {
    // A gauge that lit the middle dot first would be a decoration.
    render(<RefreshDots stage="pulling" ratio={0.5} label={LABEL} />);
    expect(dots()).toEqual([true, false, false]);
  });

  it('holds all three green at the threshold, with no extra copy', () => {
    // Three green *is* the signal that releasing will refresh. A line of text saying so would
    // be the app explaining its own indicator.
    render(<RefreshDots stage="ready" ratio={1} label={LABEL} />);
    expect(dots()).toEqual([true, true, true]);
    expect(screen.queryByText(/release/i)).toBeNull();
    expect(screen.queryByText(/let go/i)).toBeNull();
  });
});

describe('the label', () => {
  it('names what is being fetched once the pull means something', () => {
    render(<RefreshDots stage="pulling" ratio={0.7} label={LABEL} />);
    expect(screen.getByTestId('refresh-label')).toHaveTextContent(LABEL);
  });

  it('stays out of the way while the row is still grey', () => {
    // A caption under nothing, and the first thing a thumb covers on the way down.
    render(<RefreshDots stage="pulling" ratio={0.1} label={LABEL} />);
    expect(screen.queryByTestId('refresh-label')).toBeNull();
  });

  it('never says "Loading" in either language', () => {
    // It is the one thing the strip could say that a Mait cannot act on.
    ['pull.holding', 'pull.events', 'pull.waiting'].forEach(key => {
      expect(i18n.getFixedT('en')(key).toLowerCase()).not.toContain('loading');
      expect(i18n.getFixedT('hi')(key)).not.toContain('Loading');
    });
  });
});

describe('the done stage', () => {
  it('replaces the row with a single tick', () => {
    render(<RefreshDots stage="done" ratio={1} label={LABEL} />);
    expect(screen.getByTestId('refresh-done')).toBeTruthy();
    expect(screen.queryByTestId('refresh-dots')).toBeNull();
  });
});

describe('PullToRefresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /**
   * Starts a refresh through the container's own handle.
   *
   * Not through the pan gesture: PanResponder builds its gesture state from real touch
   * history, so a synthesised drag would be testing React Native's gesture arbitration rather
   * than the four stages, which are what this file is about.
   */
  async function mount(onRefresh: () => Promise<unknown> | void) {
    const handle = React.createRef<PullHandle>();
    render(
      <PullToRefresh ref={handle} onRefresh={onRefresh} label={LABEL} testID="pull">
        <Text>content</Text>
      </PullToRefresh>,
    );
    await act(async () => {});
    return handle;
  }

  it('shows nothing at rest — no strip under every screen', async () => {
    await mount(() => undefined);
    expect(screen.queryByTestId('refresh-strip')).toBeNull();
  });

  it('finishes with a tick even when the refresh throws', async () => {
    // A pull that cannot reach the network is not an error the Mait made. The screen's own
    // offline strip is what explains it; a second, louder answer here would not help.
    const failing = jest.fn().mockRejectedValue(new Error('no signal'));
    const handle = await mount(failing);

    await act(async () => {
      handle.current?.refresh();
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(failing).toHaveBeenCalled();
    expect(screen.getByTestId('refresh-done')).toBeTruthy();
  });

  it('stays visible for the minimum even when the answer is instant', async () => {
    // A refresh that resolves in eighty milliseconds should still read as having happened,
    // or a Mait is left unsure the pull registered — which is what makes somebody pull again.
    const instant = jest.fn().mockResolvedValue(undefined);
    const handle = await mount(instant);

    await act(async () => {
      handle.current?.refresh();
    });

    // Still bouncing well after the work came back.
    await act(async () => {
      jest.advanceTimersByTime(120);
    });
    expect(screen.queryByTestId('refresh-done')).toBeNull();
    expect(screen.getByTestId('refresh-dots')).toBeTruthy();

    // The tick lands at the 200ms floor, and the whole thing runs to 600 with the hold.
    await act(async () => {
      jest.advanceTimersByTime(120);
    });
    expect(screen.getByTestId('refresh-done')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(450);
    });
    expect(screen.queryByTestId('refresh-strip')).toBeNull();
  });

  it('keeps the content mounted and reachable throughout', async () => {
    // Never blocks input: a Mait can scroll, open a record or start a capture with the dots
    // still going.
    const handle = await mount(() => new Promise(resolve => setTimeout(resolve, 50)));

    await act(async () => {
      handle.current?.refresh();
    });

    expect(screen.getByText('content')).toBeTruthy();
  });
});
