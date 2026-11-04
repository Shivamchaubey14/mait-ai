/**
 * Farmer selection tests (SRS §6.3 step 2).
 *
 * The important case is the member with no usable mobile number. 1.5% of the real member
 * data is in that state, and letting one be selected would strand the Mait at the payment
 * step with the insemination already performed (docs/DATA_FINDINGS.md §2).
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectFarmerScreen from '../SelectFarmerScreen';
import type { MPP } from '@api/types';
import { jsonResponse, renderWithStore } from '@/test-utils';

const MPP_FIXTURE: MPP = {
  id: 1,
  mpp_code: '001303',
  mpp_name: 'BAROLI',
  plant_code: '2001',
  plant_name: 'AKBARPUR',
  district_code: '048',
  tehsil_code: '04803',
  village_code: '06081400',
  mobile_no: '9795402473',
  is_active: true,
  mait: 3,
  mait_name: 'SHIVKUMAR',
  member_count: 412,
};

const withMobile = {
  id: 1,
  member_code: '0906167700010001',
  member_name: 'REETA DEVI',
  father_husband_name: 'SHIV PRASAD',
  mobile_no: '7081820448',
  mpp_code: '001303',
  activation_status: 'Yes',
};

const withoutMobile = {
  id: 2,
  member_code: '0906167700010002',
  member_name: 'NO PHONE MEMBER',
  father_husband_name: 'SOMEONE',
  mobile_no: '',
  mpp_code: '001303',
  activation_status: 'Yes',
};

function mockMembers(results: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValue(
    jsonResponse({ count: results.length, next: null, previous: null, results }),
  );
}

describe('SelectFarmerScreen', () => {
  const onSelectMember = jest.fn();
  const onAddNonMember = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen() {
    return renderWithStore(
      <SelectFarmerScreen
        mpp={MPP_FIXTURE}
        onSelectMember={onSelectMember}
        onAddNonMember={onAddNonMember}
        onBack={onBack}
      />,
    );
  }

  it('lists the members at this MPP', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('REETA DEVI')).toBeTruthy());
  });

  it('selects a member who can receive an OTP', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    // Tapping the row marks the choice; the step is committed from the footer, so a mis-tap
    // in a list of a thousand names is a correction rather than a wrong event.
    fireEvent.press(screen.getByTestId(`member-${withMobile.member_code}`));
    fireEvent.press(screen.getByTestId('farmer-continue'));

    expect(onSelectMember).toHaveBeenCalledWith(
      expect.objectContaining({ member_name: 'REETA DEVI' }),
    );
  });

  it('will not continue until a farmer is chosen', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    fireEvent.press(screen.getByTestId('farmer-continue'));

    expect(onSelectMember).not.toHaveBeenCalled();
  });

  it('blocks a member with no mobile number and says why', async () => {
    mockMembers([withoutMobile]);
    renderScreen();

    await waitFor(() => screen.getByText('NO PHONE MEMBER'));

    fireEvent.press(screen.getByTestId(`member-${withoutMobile.member_code}`));
    fireEvent.press(screen.getByTestId('farmer-continue'));

    expect(onSelectMember).not.toHaveBeenCalled();
    expect(screen.getByText(/No mobile number on record/i)).toBeTruthy();
    // And what to do about it, once, under the list rather than on every blocked row.
    expect(screen.getByTestId('member-blocked-note')).toBeTruthy();
  });

  it('says nothing about mobile numbers when every member has one', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));

    expect(screen.queryByTestId('member-blocked-note')).toBeNull();
  });

  it('identifies a member by initials, code and a mobile grouped as it is spoken', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));

    expect(screen.getByText('RD')).toBeTruthy();
    expect(screen.getByText(`${withMobile.member_code} · 70818 20448`)).toBeTruthy();
  });

  it('offers non-member registration', async () => {
    mockMembers([]);
    renderScreen();

    await waitFor(() => screen.getByTestId('add-non-member'));
    fireEvent.press(screen.getByTestId('add-non-member'));

    expect(onAddNonMember).toHaveBeenCalled();
  });

  it('shows an empty state rather than a blank screen', async () => {
    mockMembers([]);
    renderScreen();

    await waitFor(() => expect(screen.getByText(/No members found/i)).toBeTruthy());
  });

  it('flags a member who has not poured enough milk to be eligible', async () => {
    mockMembers([{ ...withMobile, procurement_eligible: false }]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    expect(screen.getByText(/Not eligible/i)).toBeTruthy();
  });

  it('still lets an ineligible member be chosen — the pill informs, it does not block', async () => {
    mockMembers([{ ...withMobile, procurement_eligible: false }]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    fireEvent.press(screen.getByTestId(`member-${withMobile.member_code}`));
    fireEvent.press(screen.getByTestId('farmer-continue'));

    expect(onSelectMember).toHaveBeenCalledWith(
      expect.objectContaining({ member_name: 'REETA DEVI' }),
    );
  });

  it('shows no eligibility pill for a member who clears the bar (or when the gate is off)', async () => {
    mockMembers([
      { ...withMobile, procurement_eligible: true },
      { ...withMobile, id: 9, member_code: 'x', member_name: 'GATE OFF MEMBER', procurement_eligible: undefined },
    ]);
    renderScreen();

    await waitFor(() => screen.getByText('GATE OFF MEMBER'));
    expect(screen.queryByText(/Not eligible/i)).toBeNull();
  });

  it('shows the poured-vs-bar figures for a gated member', async () => {
    mockMembers([
      {
        ...withMobile,
        procurement_eligible: false,
        procurement: {
          eligible: false,
          gated: true,
          threshold: '100',
          amount: '50',
          period: {
            from_date: '2026-10-01',
            to_date: '2026-10-15',
            qty: '12.34',
            avg_fat: '4.0',
            avg_snf: '8.0',
            amount: '50',
            no_of_pouring_days: 10,
            no_of_pouring_shift: 18,
          },
        },
      },
    ]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    expect(screen.getByText(/₹50 poured · 12\.3 L · bar ₹100/)).toBeTruthy();
  });

  it('names the bar for a gated member with no milk on record', async () => {
    mockMembers([
      {
        ...withMobile,
        procurement_eligible: false,
        procurement: { eligible: false, gated: true, threshold: '100', amount: null },
      },
    ]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    expect(screen.getByText(/no milk on record · bar ₹100/)).toBeTruthy();
  });

  it('shows no procurement figures while the gate is off', async () => {
    mockMembers([
      {
        ...withMobile,
        procurement: { eligible: true, gated: false, threshold: '0', amount: null },
      },
    ]);
    renderScreen();

    await waitFor(() => screen.getByText('REETA DEVI'));
    expect(screen.queryByText(/poured|bar ₹/)).toBeNull();
  });

  it('scopes the request to the selected MPP', async () => {
    mockMembers([withMobile]);
    renderScreen();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string | Request;
    const href = typeof url === 'string' ? url : url.url;

    expect(href).toContain('mpp__mpp_code=001303');
    // The Mait is never named in the query — the server scopes by the token, so a filter
    // the client sends could be omitted or altered.
    expect(href).not.toContain('mait=');
  });
});
