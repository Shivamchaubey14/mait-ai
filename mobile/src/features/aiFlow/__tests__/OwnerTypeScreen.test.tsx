/**
 * The fork (C1) tests.
 *
 * This one answer decides which of two different capture paths a Mait walks, so the risk is a
 * screen that looks answered when it is not, or that quietly reports the wrong branch. Both
 * end the same way: five screens later, with the wrong person recorded.
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import OwnerTypeScreen from '../OwnerTypeScreen';
import { renderWithStore } from '@/test-utils';

const props = { onBack: jest.fn(), onContinue: jest.fn() };

function render(overrides: Partial<React.ComponentProps<typeof OwnerTypeScreen>> = {}) {
  return renderWithStore(<OwnerTypeScreen {...props} {...overrides} />);
}

afterEach(() => jest.clearAllMocks());

describe('OwnerTypeScreen', () => {
  it('opens the flow at step one of six', () => {
    render();
    expect(screen.getByText(/Step 1 of 6/i)).toBeTruthy();
  });

  it('defaults to member, which is most of the work', () => {
    // A default that is usually right turns the commonest capture into one tap.
    const onContinue = jest.fn();
    render({ onContinue });

    fireEvent.press(screen.getByTestId('owner-type-continue'));
    expect(onContinue).toHaveBeenCalledWith('member');
  });

  it('carries the other branch when it is chosen', () => {
    const onContinue = jest.fn();
    render({ onContinue });

    fireEvent.press(screen.getByTestId('owner-non-member'));
    fireEvent.press(screen.getByTestId('owner-type-continue'));
    expect(onContinue).toHaveBeenCalledWith('nonMember');
  });

  it('does not quote a fee the build has not been given', () => {
    // A price named on screen is heard by the farmer as final. This build has no configured
    // figure, so the line says a payment is collected without inventing an amount.
    render();
    expect(screen.getByText('You collect payment today')).toBeTruthy();
  });

  it('leaves the flow from the back arrow', () => {
    // Step one is the only screen where nothing has been committed yet, so this is a plain
    // way out rather than a partial record.
    const onBack = jest.fn();
    render({ onBack });

    fireEvent.press(screen.getByTestId('flow-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
