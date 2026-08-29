/**
 * The payment tail (SRS §6.5, C10a–C12).
 *
 * The case worth protecting above all others is the member's: she has already paid for this in
 * milk, and a Mait who asks her for cash is taking money she has no reason to refuse. So the
 * screen says *do not take money from her*, offers no way to collect anything, and that is
 * asserted here rather than left to a designer's memory.
 */

import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import CaptureDoneScreen from '../CaptureDoneScreen';
import CollectPaymentScreen from '../CollectPaymentScreen';
import MemberNothingToCollectScreen from '../MemberNothingToCollectScreen';
import RecordPaymentScreen from '../RecordPaymentScreen';
import type { AIEvent } from '@api/types';
import { renderWithStore } from '@/test-utils';

const EVENT = {
  id: 51,
  client_uuid: '11111111-1111-4111-8111-111111111111',
  status: 'payment_pending',
  status_display: 'Payment pending',
  mpp: 1,
  mpp_code: '001303',
  mpp_name: 'BAROLI',
  owner_type: 'member',
  member: 1,
  non_member: null,
  owner_name: 'KAVITA DEVI',
  animal: 7,
  animal_type: 'COW',
  breed: 'HF_CROSS',
  ear_tag_no: '4821',
  semen_breed: 'HF_CROSS',
  amount_due: '300.00',
  straw_unique_no: '',
  ai_photo_url: '',
  gps_lat: null,
  gps_lng: null,
  performed_at: null,
  completed_at: null,
  cancelled_reason: '',
  created_at: '2026-08-13T05:00:00Z',
} as unknown as AIEvent;

const NON_MEMBER_EVENT = {
  ...EVENT,
  owner_type: 'non_member',
  owner_name: 'RADHA SINGH',
  amount_due: '450.00',
} as unknown as AIEvent;

describe('C10a — a member is asked for nothing', () => {
  const onFinish = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(event = EVENT) {
    return renderWithStore(
      <MemberNothingToCollectScreen
        event={event}
        farmerName="KAVITA DEVI"
        animalLabel="Cow · tag 4821"
        onFinish={onFinish}
      />,
    );
  }

  it('tells the Mait in as many words not to take money from her', () => {
    renderScreen();

    expect(screen.getByText('Nothing to collect')).toBeTruthy();
    expect(screen.getByText(/Do not take money from her/i)).toBeTruthy();
  });

  it('names the amount the dairy will deduct, not an amount to collect', () => {
    renderScreen();

    expect(screen.getByText('₹ 300')).toBeTruthy();
    expect(screen.getByText(/Deducted from her milk payment/i)).toBeTruthy();
  });

  it('offers no way to take a payment at all', () => {
    renderScreen();

    expect(screen.queryByTestId('payment-mode-COD')).toBeNull();
    expect(screen.queryByTestId('payment-mode-ONLINE')).toBeNull();

    fireEvent.press(screen.getByTestId('payment-finish'));
    expect(onFinish).toHaveBeenCalled();
  });

  it('says nothing about a figure the administrator has not set', () => {
    renderScreen({ ...EVENT, amount_due: null } as unknown as AIEvent);

    // Never "₹ 0": a rate nobody entered must not reach a farmer as free.
    expect(screen.queryByText('₹ 0')).toBeNull();
    expect(screen.getByText(/Not priced yet/i)).toBeTruthy();
  });
});

describe('C10b — a non-member pays now', () => {
  const onContinue = jest.fn();
  const onBack = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(online = true) {
    return renderWithStore(
      <CollectPaymentScreen
        event={NON_MEMBER_EVENT}
        farmerName="RADHA SINGH"
        online={online}
        onContinue={onContinue}
        onBack={onBack}
      />,
    );
  }

  it('shows her own rate, which is not the member one', () => {
    renderScreen();

    expect(screen.getByText('₹ 450')).toBeTruthy();
    expect(screen.getByText(/To collect from RADHA SINGH/i)).toBeTruthy();
  });

  it('defaults to cash, which is what happens in a yard', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('payment-continue'));

    expect(onContinue).toHaveBeenCalledWith('COD');
  });

  it('blocks UPI with no signal rather than letting a Mait wait to find out', () => {
    renderScreen(false);

    expect(screen.getByTestId('payment-offline')).toBeTruthy();
    fireEvent.press(screen.getByTestId('payment-mode-ONLINE'));
    fireEvent.press(screen.getByTestId('payment-continue'));

    expect(onContinue).toHaveBeenCalledWith('COD');
  });
});

describe('C11 — recording what was taken', () => {
  const onFinish = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(sentTo: string | null, code = '', overrides = {}) {
    return renderWithStore(
      <RecordPaymentScreen
        event={NON_MEMBER_EVENT}
        farmerName="RADHA SINGH"
        mode="COD"
        sentTo={sentTo}
        code={code}
        onCodeChange={jest.fn()}
        onResend={jest.fn()}
        onFinish={onFinish}
        onBack={jest.fn()}
        utr=""
        onUtrChange={jest.fn()}
        proofUri={null}
        onProofCaptured={jest.fn()}
        {...overrides}
      />,
    );
  }

  it('will not finish on a half-typed code', () => {
    renderScreen('her number', '123');

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('finishes on a complete one', () => {
    renderScreen('her number', '123456');

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).toHaveBeenCalled();
  });

  it('saves without a code when there was no signal to send one', () => {
    renderScreen(null);

    // The cash is already in the Mait's hand. Refusing to finish would strand them.
    expect(screen.getByTestId('payment-code-queued')).toBeTruthy();
    expect(screen.queryByTestId('payment-code-input')).toBeNull();

    fireEvent.press(screen.getByTestId('payment-save'));
    expect(onFinish).toHaveBeenCalled();
  });
});

describe('C12 — recorded', () => {
  const onStartAnother = jest.fn();
  const onHome = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function renderScreen(pending = 0, event = EVENT) {
    return renderWithStore(
      <CaptureDoneScreen
        event={event}
        farmerName="KAVITA DEVI"
        animalLabel="cow tag 4821"
        time="10:42"
        pending={pending}
        strawsLeft={17}
        strawBreed="HF Cross"
        onStartAnother={onStartAnother}
        onHome={onHome}
      />,
    );
  }

  it('says a queued record is saved, never that it failed', () => {
    renderScreen(4);

    expect(screen.getByText('Saved on this phone')).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it('shows a member nothing to pay, and what is left in the flask', () => {
    renderScreen(0);

    expect(screen.getByText('₹ 0')).toBeTruthy();
    expect(screen.getByText('deducted from milk')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
  });

  it('shows a non-member what they collected', () => {
    renderScreen(0, NON_MEMBER_EVENT);

    expect(screen.getByText('₹ 450')).toBeTruthy();
    expect(screen.getByText('collected today')).toBeTruthy();
  });

  it('starts the next capture, because the next animal is in the same yard', () => {
    renderScreen(0);

    fireEvent.press(screen.getByTestId('done-start-another'));

    expect(onStartAnother).toHaveBeenCalled();
  });
});

describe('C11 — an online payment needs its proof', () => {
  /**
   * The bug this covers: the app asked for the farmer's code and nothing else, then called
   * complete. The server holds an online payment at `pending` until the UTR and the
   * screenshot are on file, so the completion was refused `payment-not-verified` — the straw
   * was never deducted and the capture came back in Unfinished with nothing to explain it.
   */
  const onFinish = jest.fn();

  afterEach(() => jest.resetAllMocks());

  function online(overrides = {}) {
    return renderWithStore(
      <RecordPaymentScreen
        event={NON_MEMBER_EVENT}
        farmerName="KUMARI RITU"
        mode="ONLINE"
        sentTo="her number"
        code="123456"
        onCodeChange={jest.fn()}
        onResend={jest.fn()}
        onFinish={onFinish}
        onBack={jest.fn()}
        utr=""
        onUtrChange={jest.fn()}
        proofUri={null}
        onProofCaptured={jest.fn()}
        {...overrides}
      />,
    );
  }

  it('asks for the reference and the screenshot', () => {
    online();

    expect(screen.getByTestId('payment-proof')).toBeTruthy();
    expect(screen.getByTestId('payment-utr')).toBeTruthy();
    expect(screen.getByTestId('payment-proof-tile')).toBeTruthy();
  });

  it('will not finish on a correct code alone', () => {
    // The tap that used to look like it worked.
    online();

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('will not finish on a reference with no screenshot', () => {
    // A reference alone is a number a Mait could have invented.
    online({ utr: '412345678901' });

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('will not finish on a screenshot with no reference', () => {
    // An image alone cannot be reconciled against a bank statement.
    online({ proofUri: 'file:///proof.jpg' });

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('finishes once both are in hand', () => {
    online({ utr: '412345678901', proofUri: 'file:///proof.jpg' });

    fireEvent.press(screen.getByTestId('payment-save'));

    expect(onFinish).toHaveBeenCalled();
  });

  it('asks a cash payment for none of it', () => {
    // Cash is settled by the code alone; there is no reference and nothing to photograph.
    renderWithStore(
      <RecordPaymentScreen
        event={NON_MEMBER_EVENT}
        farmerName="RADHA SINGH"
        mode="COD"
        sentTo="her number"
        code="123456"
        onCodeChange={jest.fn()}
        onResend={jest.fn()}
        onFinish={onFinish}
        onBack={jest.fn()}
        utr=""
        onUtrChange={jest.fn()}
        proofUri={null}
        onProofCaptured={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('payment-proof')).toBeNull();
    fireEvent.press(screen.getByTestId('payment-save'));
    expect(onFinish).toHaveBeenCalled();
  });
});
