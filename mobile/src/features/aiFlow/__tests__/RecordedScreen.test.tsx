/**
 * The end of a capture: recorded, a word for the time of day, and Home on its own.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import RecordedScreen, { RECORDED_MS } from '../RecordedScreen';
import i18n from '@/i18n';

function at(hour: number) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 24, hour, 0, 0));
}

afterEach(() => {
  jest.useRealTimers();
});

describe('RecordedScreen', () => {
  it('says the AI is recorded, and wishes a good day in the daytime', () => {
    at(11);
    render(<RecordedScreen onDone={jest.fn()} />);

    expect(screen.getByTestId('recorded-title')).toHaveTextContent('AI recorded');
    expect(screen.getByTestId('recorded-sign-off')).toHaveTextContent('Have a good day');
    // The success tick, played as its Lottie animation.
    expect(screen.getByTestId('recorded-tick')).toBeTruthy();
    // And a bar saying it is on its way Home.
    expect(screen.getByTestId('recorded-progress')).toBeTruthy();
    expect(screen.getByText('Taking you back to Home…')).toBeTruthy();
  });

  it('says good night after dark', () => {
    at(21);
    render(<RecordedScreen onDone={jest.fn()} />);

    expect(screen.getByTestId('recorded-sign-off')).toHaveTextContent('Good night');
  });

  it('says it in Hindi', async () => {
    at(9);
    await i18n.changeLanguage('hi');
    try {
      render(<RecordedScreen onDone={jest.fn()} />);
      expect(screen.getByTestId('recorded-title')).toHaveTextContent('AI दर्ज हुआ');
      expect(screen.getByTestId('recorded-sign-off')).toHaveTextContent('आपका दिन शुभ हो');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('takes the Mait Home on its own after four seconds, and only once', () => {
    at(11);
    const onDone = jest.fn();
    render(<RecordedScreen onDone={onDone} />);

    act(() => {
      jest.advanceTimersByTime(RECORDED_MS - 1);
    });
    expect(onDone).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(RECORDED_MS).toBe(4000);
  });

  it('goes sooner on a tap, without going twice', () => {
    at(11);
    const onDone = jest.fn();
    render(<RecordedScreen onDone={onDone} />);

    fireEvent.press(screen.getByTestId('recorded'));
    act(() => {
      jest.advanceTimersByTime(RECORDED_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
