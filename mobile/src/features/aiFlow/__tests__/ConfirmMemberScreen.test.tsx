/**
 * Member confirmation tests (SRS §6.3 step 2, C4).
 *
 * The screen exists because a mistyped member code does not fail — it succeeds against
 * somebody else. So what matters is that the card says enough to catch that: her MPP, the
 * number the receipt goes to, whose household she is from, and what is already on her record.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import ConfirmMemberScreen from '../ConfirmMemberScreen';
import { jsonResponse, problemResponse, renderWithStore } from '@/test-utils';

const MEMBER = {
  id: 1,
  member_code: '0906167700010001',
  member_name: 'KAVITA DEVI',
  father_husband_name: 'RAM PRASAD',
  gender: 'F',
  age: 41,
  cattle_holding: 3,
  aadhar_no: 'XXXXXXXX1234',
  bank_name: 'PNB',
  folio_no: '4120',
  mobile_no: '9876543210',
  mpp_code: '001303',
  mpp_name: 'BAROLI',
  activation_status: 'Yes',
  can_receive_otp: true,
  animals: [
    { id: 7, animal_type: 'COW', breed: 'HF_CROSS', ear_tag_no: '4821' },
    { id: 8, animal_type: 'BUFF', breed: 'MURRAH', ear_tag_no: null },
  ],
};

describe('ConfirmMemberScreen', () => {
  const onConfirm = jest.fn();
  const onSearchAgain = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(MEMBER)) as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen() {
    return renderWithStore(
      <ConfirmMemberScreen
        memberCode={MEMBER.member_code}
        onConfirm={onConfirm}
        onSearchAgain={onSearchAgain}
      />,
    );
  }

  it('reads her back — name, the code that was typed, and her MPP', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByText('KAVITA DEVI')).toBeTruthy());
    expect(screen.getByText(MEMBER.member_code)).toBeTruthy();
    expect(screen.getByText('MPP')).toBeTruthy();
    expect(screen.getByText('BAROLI')).toBeTruthy();
  });

  it('carries the rest of her record, not her village', async () => {
    renderScreen();

    await waitFor(() => screen.getByText('KAVITA DEVI'));

    expect(screen.getByText('98765 43210')).toBeTruthy();
    expect(screen.getByText('RAM PRASAD')).toBeTruthy();
    expect(screen.getByText('2 on record')).toBeTruthy();
    expect(screen.queryByText(/village/i)).toBeNull();
  });

  it('says there is nothing to collect from a member', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('member-nothing-to-collect')).toBeTruthy());
    expect(screen.getByText(/comes out of her milk payment/i)).toBeTruthy();
  });

  it('confirms with the full detail record, so the next step needs no second fetch', async () => {
    renderScreen();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    fireEvent.press(screen.getByTestId('member-confirm'));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ member_code: MEMBER.member_code, mpp_name: 'BAROLI' }),
    );
  });

  it('sends a wrong one back to the roster rather than offering to edit it', async () => {
    renderScreen();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    fireEvent.press(screen.getByTestId('member-search-again'));

    expect(onSearchAgain).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cannot be confirmed while the record has not arrived', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(problemResponse(500, 'server-error'));
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('member-confirm-error')).toBeTruthy());
    fireEvent.press(screen.getByTestId('member-confirm'));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
