/**
 * The fork (C1) tests.
 *
 * This one answer decides which of two different capture paths a Mait walks, so the risk is a
 * screen that looks answered when it is not, or that quietly reports the wrong branch. Both
 * end the same way: five screens later, with the wrong person recorded.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import OwnerTypeScreen from '../OwnerTypeScreen';
import { jsonResponse, renderWithStore } from '@/test-utils';

const props = { onBack: jest.fn(), onContinue: jest.fn() };

/** One breed row as `/config/breeds/` serves it, rates included. */
function breed(code: string, nonMemberRate: string | null) {
  return {
    code,
    name: code,
    name_hi: '',
    animal_type: 'BUFF',
    rate: '50.00',
    non_member_rate: nonMemberRate,
    display_order: 1,
  };
}

function mockBreeds(rows: ReturnType<typeof breed>[]) {
  (global.fetch as jest.Mock).mockImplementation(async () => jsonResponse(rows));
}

function render(overrides: Partial<React.ComponentProps<typeof OwnerTypeScreen>> = {}) {
  return renderWithStore(<OwnerTypeScreen {...props} {...overrides} />);
}

beforeEach(() => {
  global.fetch = jest.fn() as jest.Mock;
  mockBreeds([]);
});

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

  it("names what she pays, from the dairy's own rates", async () => {
    // The figure is the reason this card exists: it is what the Mait will be holding at the
    // end of the round. It comes off the breed list the app already caches, so a dairy that
    // re-prices changes it in the portal and the next request carries it.
    mockBreeds([breed('MURRAH', '100.00'), breed('GIR', '100.00')]);
    render();

    await waitFor(() => expect(screen.getByText(/You collect/)).toHaveTextContent(/₹ 100/));
  });

  it('quotes nothing when the breeds are priced differently', async () => {
    // There is no one answer before a straw is chosen, and a price named on screen is heard
    // by the farmer as final. So the line says a payment is collected and stops there.
    mockBreeds([breed('MURRAH', '100.00'), breed('GIR', '250.00')]);
    render();

    await waitFor(() => expect(screen.getByText('You collect payment today')).toBeTruthy());
  });

  it('quotes nothing when nobody has priced anything', async () => {
    mockBreeds([breed('MURRAH', null)]);
    render();

    await waitFor(() => expect(screen.getByText('You collect payment today')).toBeTruthy());
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
