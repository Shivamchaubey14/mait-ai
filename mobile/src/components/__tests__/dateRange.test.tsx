/**
 * The date range picker.
 *
 * Two things are defended here. The arithmetic, because a calendar that is a day out is worse
 * than no calendar — it answers confidently and wrongly, and nobody checks a date. And the
 * two-tap rule, because the second tap is where every range picker in the world confuses
 * people: tapping *before* the start is not an error, it is somebody starting again.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DateRangeSheet, { formatRange, isoDate, monthMatrix, parseIsoDate } from '../dateRange';
import '@/i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function renderSheet(props: Partial<React.ComponentProps<typeof DateRangeSheet>> = {}) {
  const onApply = jest.fn();
  const onClear = jest.fn();
  const onClose = jest.fn();
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <DateRangeSheet
        visible
        from={null}
        to={null}
        onClose={onClose}
        onApply={onApply}
        onClear={onClear}
        {...props}
      />
    </SafeAreaProvider>,
  );
  return { onApply, onClear, onClose };
}

describe('isoDate', () => {
  it('names the local day, not the UTC one', () => {
    // The trap this exists to avoid. `toISOString().slice(0, 10)` on a date early in an
    // Indian morning names *yesterday*, because IST is five and a half hours ahead — and a
    // Mait starting a round at dawn records most of the day's work in exactly that window.
    const dawn = new Date(2026, 7, 12, 5, 30, 0);
    expect(isoDate(dawn)).toBe('2026-08-12');
  });

  it('pads a single-digit month and day', () => {
    expect(isoDate(new Date(2026, 0, 3))).toBe('2026-01-03');
  });

  it('round-trips through parseIsoDate at local midnight', () => {
    const parsed = parseIsoDate('2026-08-12');
    expect(isoDate(parsed)).toBe('2026-08-12');
    expect(parsed.getHours()).toBe(0);
  });
});

describe('monthMatrix', () => {
  it('lays a month out in whole weeks, Sunday first', () => {
    // August 2026 begins on a Saturday, so the first row is six blanks and the 1st.
    const weeks = monthMatrix(2026, 7);
    weeks.forEach(week => expect(week).toHaveLength(7));
    expect(weeks[0]?.slice(0, 6).every(cell => cell === null)).toBe(true);
    expect(weeks[0]?.[6]?.getDate()).toBe(1);
  });

  it('holds every day of the month and no day of another', () => {
    const days = monthMatrix(2026, 7)
      .flat()
      .filter((cell): cell is Date => cell !== null);
    expect(days).toHaveLength(31);
    expect(days.every(day => day.getMonth() === 7)).toBe(true);
  });

  it('counts February in a leap year correctly', () => {
    const days = monthMatrix(2028, 1).flat().filter(Boolean);
    expect(days).toHaveLength(29);
  });
});

describe('formatRange', () => {
  it('says a single day once', () => {
    expect(formatRange('2026-08-12', '2026-08-12', MONTHS)).toBe('12 Aug');
  });

  it('says the month once when both ends share it', () => {
    expect(formatRange('2026-08-12', '2026-08-18', MONTHS)).toBe('12 – 18 Aug');
  });

  it('says both months when the range crosses one', () => {
    expect(formatRange('2026-07-28', '2026-08-03', MONTHS)).toBe('28 Jul – 3 Aug');
  });
});

describe('DateRangeSheet', () => {
  const REAL_NOW = Date.now;

  beforeAll(() => {
    // Fixed, because half the assertions turn on which days are in the future — and on a real
    // clock this suite would start failing on the 1st of a month.
    jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 7, 20, 9, 0, 0).getTime());
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 20, 9, 0, 0));
  });

  afterAll(() => {
    jest.useRealTimers();
    Date.now = REAL_NOW;
  });

  it('takes the first tap as the start and the second as the end', () => {
    const { onApply } = renderSheet();

    fireEvent.press(screen.getByTestId('date-range-day-2026-08-12'));
    fireEvent.press(screen.getByTestId('date-range-day-2026-08-18'));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    expect(onApply).toHaveBeenCalledWith('2026-08-12', '2026-08-18');
  });

  it('starts again rather than reversing when the second tap lands earlier', () => {
    // Somebody who taps the 18th and then the 12th has not asked for a backwards range; they
    // have changed their mind about where the range begins.
    const { onApply } = renderSheet();

    fireEvent.press(screen.getByTestId('date-range-day-2026-08-18'));
    fireEvent.press(screen.getByTestId('date-range-day-2026-08-12'));
    fireEvent.press(screen.getByTestId('date-range-day-2026-08-15'));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    expect(onApply).toHaveBeenCalledWith('2026-08-12', '2026-08-15');
  });

  it('applies one tap as a single day rather than refusing to be used', () => {
    const { onApply } = renderSheet();

    fireEvent.press(screen.getByTestId('date-range-day-2026-08-14'));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    expect(onApply).toHaveBeenCalledWith('2026-08-14', '2026-08-14');
  });

  it('will not take a day in the future', () => {
    // There are no inseminations in the future. A range reaching into next week is one that
    // can only come back empty.
    const { onApply } = renderSheet();

    fireEvent.press(screen.getByTestId('date-range-day-2026-08-25'));
    fireEvent.press(screen.getByTestId('date-range-apply'));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens on the month the applied range starts in, not on today', () => {
    renderSheet({ from: '2026-05-04', to: '2026-05-09' });
    expect(screen.getByTestId('date-range-month')).toHaveTextContent('May 2026');
  });

  it('turns back a month, but not forward past today', () => {
    renderSheet();
    expect(screen.getByTestId('date-range-month')).toHaveTextContent('Aug 2026');

    fireEvent.press(screen.getByTestId('date-range-prev-month'));
    expect(screen.getByTestId('date-range-month')).toHaveTextContent('Jul 2026');

    fireEvent.press(screen.getByTestId('date-range-next-month'));
    expect(screen.getByTestId('date-range-month')).toHaveTextContent('Aug 2026');

    // Already at the month holding today — the arrow is dead rather than showing an empty
    // September nobody can have recorded anything in.
    fireEvent.press(screen.getByTestId('date-range-next-month'));
    expect(screen.getByTestId('date-range-month')).toHaveTextContent('Aug 2026');
  });

  it('hands the range back with nothing chosen when it is cleared', () => {
    const { onClear } = renderSheet({ from: '2026-08-12', to: '2026-08-18' });

    fireEvent.press(screen.getByTestId('date-range-clear'));

    expect(onClear).toHaveBeenCalled();
  });
});
