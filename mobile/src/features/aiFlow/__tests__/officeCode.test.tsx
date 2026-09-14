/**
 * Asking the office to phone the farmer her code, at the two farmer steps that send one.
 *
 * The rule under test is the one that keeps it her consent: the ask names the farmer on the
 * screen and nothing else — never a number — and what comes back is a promise that the office
 * will ring *her*, not a code for the Mait.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import ConfirmFarmerScreen from '../ConfirmFarmerScreen';
import RecordPaymentScreen from '../RecordPaymentScreen';
import type { AIEvent } from '@api/types';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

const NON_MEMBER = {
  id: 12,
  name: 'RADHA SINGH',
  father_husband_name: 'MOHAN',
  mobile_no: '9000011111',
  address: 'Barsana',
  masked_aadhar: 'XXXXXXXX9999',
  mpp: 1,
  created_by_mait: 3,
  created_at: '2026-08-13T05:00:00Z',
  animals: [],
};

const ASKED = {
  detail: 'The office has been asked.',
  mobile_no: '••••• 11111',
  expires_in_seconds: 600,
};

function requests() {
  return (global.fetch as jest.Mock).mock.calls.map(([input]) => input as Request);
}

function mockApi(office: Response = jsonResponse(ASKED)) {
  (global.fetch as jest.Mock).mockImplementation(async (input: Request) => {
    const href = input.url;
    if (href.includes('/farmers/otp/send/')) {
      return jsonResponse({ mobile_no: '••••• 11111', expires_in_seconds: 300 });
    }
    if (href.includes('/farmers/otp/office/')) {
      return office;
    }
    if (href.includes('/config/breeds/')) {
      return jsonResponse([]);
    }
    return jsonResponse(NON_MEMBER);
  });
}

describe('the farmer check', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  async function onHerCode() {
    renderWithStore(
      <ConfirmFarmerScreen
        farmer={{ kind: 'nonMember', id: NON_MEMBER.id }}
        onConfirm={jest.fn()}
        onSearchAgain={jest.fn()}
      />,
    );
    await waitFor(() => screen.getByTestId('farmer-verify'));
    fireEvent.press(screen.getByTestId('farmer-verify'));
    await waitFor(() => screen.getByTestId('farmer-send-code'));
    fireEvent.press(screen.getByTestId('farmer-send-code'));
    await waitFor(() => screen.getByTestId('farmer-otp-input'));
  }

  it('asks the office for her, by who she is, never by a number', async () => {
    mockApi();
    await onHerCode();

    fireEvent.press(screen.getByTestId('farmer-office-code-ask'));

    await waitFor(() => screen.getByTestId('farmer-office-code-asked'));
    expect(screen.getByTestId('farmer-office-code-asked')).toHaveTextContent(/••••• 11111/);
    const ask = requests().find(request => request.url.includes('/farmers/otp/office/'));
    expect(await (ask as Request).clone().json()).toEqual({ non_member_id: NON_MEMBER.id });
    // The same box takes the code she reads out.
    expect(screen.getByTestId('farmer-otp-input')).toBeTruthy();
  });

  it('says what the server said when it will not ask', async () => {
    mockApi(problemResponse(400, 'domain-error', 'Send her the SMS code first.'));
    await onHerCode();

    fireEvent.press(screen.getByTestId('farmer-office-code-ask'));

    await waitFor(() => expect(screen.getByText('Send her the SMS code first.')).toBeTruthy());
    expect(screen.queryByTestId('farmer-office-code-asked')).toBeNull();
  });
});

describe('the payment code', () => {
  const EVENT = {
    id: 51,
    owner_type: 'non_member',
    owner_name: 'RADHA SINGH',
    amount_due: '450.00',
  } as unknown as AIEvent;

  function render(props: { officeAsked?: boolean; onAskOffice?: () => void }) {
    return renderWithStore(
      <RecordPaymentScreen
        event={EVENT}
        farmerName="RADHA SINGH"
        mode="COD"
        sentTo="••••• 11111"
        code=""
        onCodeChange={jest.fn()}
        onResend={jest.fn()}
        onFinish={jest.fn()}
        onBack={jest.fn()}
        utr=""
        onUtrChange={jest.fn()}
        proofUri={null}
        onProofCaptured={jest.fn()}
        {...props}
      />,
    );
  }

  it('offers the office beside her code box', () => {
    const onAskOffice = jest.fn();
    render({ onAskOffice });
    fireEvent.press(screen.getByTestId('payment-office-code-ask'));
    expect(onAskOffice).toHaveBeenCalled();
  });

  it('once asked, says the office will call her', () => {
    render({ onAskOffice: jest.fn(), officeAsked: true });
    expect(screen.getByTestId('payment-office-code-asked')).toHaveTextContent(/••••• 11111/);
  });

  it('is not offered for a capture the server has not seen', () => {
    render({});
    expect(screen.queryByTestId('payment-office-code-ask')).toBeNull();
  });
});
