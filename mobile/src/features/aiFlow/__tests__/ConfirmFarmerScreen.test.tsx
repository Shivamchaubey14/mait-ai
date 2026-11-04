/**
 * Farmer confirmation tests (SRS §6.3 step 2, §6.5, C4).
 *
 * The screen exists because a mistyped member code does not fail — it succeeds against
 * somebody else. So what matters is that the card says enough to catch that, and that the
 * flow cannot go on until her own phone has answered.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import NetInfo from '@react-native-community/netinfo';

import ConfirmFarmerScreen from '../ConfirmFarmerScreen';
import { loggedIn } from '@/features/auth/authSlice';
import { jsonResponse, makeStore, problemResponse, renderWithStore } from '@/test-utils';
import * as offlinePack from '@api/offlinePack';
import { fieldCode, localDay } from '@api/fieldCode';
import { colors } from '@theme/tokens';

// Any day's key will do: the screen and the test work the code out the same way, and the
// agreement with the server is pinned in api/__tests__/fieldCode.test.ts.
const DAY_KEY = '87CnkMDiNKEokx5ABXzZIvrnr8cp57KjwtJN5lDvTSQ=';

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

/** Routes by URL, because this screen reads a record and then talks to two OTP endpoints. */
function mockApi(record: unknown, over: { send?: Response; check?: Response } = {}) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
    const href = typeof input === 'string' ? input : input.url;
    if (href.includes('/farmers/otp/send/')) {
      return over.send ?? jsonResponse({ mobile_no: '••••• 43210', expires_in_seconds: 300 });
    }
    if (href.includes('/farmers/otp/verify/')) {
      return over.check ?? jsonResponse({ verified: true, mobile_no: '••••• 43210' });
    }
    // The breed list, which the screen reads for the one rate every breed shares — that is
    // where "she owes nothing today, it comes off her milk" gets its figure. A bare array,
    // like the endpoint's own answer: handed a record instead, the screen calls `.map` on an
    // object and throws.
    if (href.includes('/config/breeds/')) {
      return jsonResponse([
        {
          code: 'MURRAH',
          name: 'Murrah',
          name_hi: '',
          animal_type: 'BUFF',
          rate: '50.00',
          non_member_rate: '100.00',
          display_order: 1,
        },
      ]);
    }
    return jsonResponse(record);
  });
}

describe('ConfirmFarmerScreen', () => {
  const onConfirm = jest.fn();
  const onSearchAgain = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderMember() {
    return renderWithStore(
      <ConfirmFarmerScreen
        farmer={{ kind: 'member', memberCode: MEMBER.member_code }}
        onConfirm={onConfirm}
        onSearchAgain={onSearchAgain}
      />,
    );
  }

  function renderNonMember() {
    return renderWithStore(
      <ConfirmFarmerScreen
        farmer={{ kind: 'nonMember', id: NON_MEMBER.id }}
        onConfirm={onConfirm}
        onSearchAgain={onSearchAgain}
      />,
    );
  }

  /**
   * Open the sheet and send her the code.
   *
   * Two taps rather than one: the screen's button opens the sheet, which shows the number the
   * code is about to go to, and the sheet's own button sends it. The number is read back
   * before anything leaves, because it is the one part of this a Mait can check against the
   * woman standing in front of them.
   */
  async function askForTheCode() {
    fireEvent.press(screen.getByTestId('farmer-verify'));
    await waitFor(() => expect(screen.getByTestId('farmer-send-code')).toBeTruthy());
    fireEvent.press(screen.getByTestId('farmer-send-code'));
    await waitFor(() => expect(screen.getByTestId('farmer-otp-input')).toBeTruthy());
  }

  /** Send the code and answer it, as a Mait would with the farmer beside them. */
  async function verify() {
    await askForTheCode();
    fireEvent.changeText(screen.getByTestId('farmer-otp-input'), '123456');
    fireEvent.press(screen.getByTestId('farmer-check-code'));
    await waitFor(() => expect(screen.getByTestId('farmer-verified')).toBeTruthy());
  }

  it('reads her back — name, the code that was typed, and her MPP', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => expect(screen.getByText('KAVITA DEVI')).toBeTruthy());
    expect(screen.getByText(MEMBER.member_code)).toBeTruthy();
    expect(screen.getByText('BAROLI')).toBeTruthy();
    expect(screen.getByText('98765 43210')).toBeTruthy();
    expect(screen.queryByText(/village/i)).toBeNull();
  });

  it('will not let the flow past until her phone has answered', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));

    // The only button on the screen is the one that sends her a code.
    expect(screen.queryByTestId('farmer-confirm')).toBeNull();
    expect(screen.getByTestId('farmer-verify')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sends the code without saying where it should go', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    await askForTheCode();

    const call = (global.fetch as jest.Mock).mock.calls.find(([input]) => {
      const href = typeof input === 'string' ? input : input.url;
      return href.includes('/farmers/otp/send/');
    });
    const [input, init] = call as [string | Request, RequestInit | undefined];
    const raw = init?.body ?? (typeof input === 'string' ? undefined : await input.text());
    const body = JSON.parse(String(raw));

    expect(body).toEqual({ member_code: MEMBER.member_code });
    // The number is the server's to decide. A Mait who could name it could name their own.
    expect(Object.keys(body)).not.toContain('mobile_no');
  });

  /**
   * A tap in a dead patch used to spin until the Mait gave up, and coming back into signal did
   * nothing — the stuck request stayed stuck and the code never went.
   */
  it('says there is no signal, and sends the code by itself once it returns', async () => {
    mockApi(MEMBER);
    let listener: ((state: object) => void) | undefined;
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    (NetInfo.addEventListener as jest.Mock).mockImplementation(fn => {
      listener = fn;
      return jest.fn();
    });
    renderMember();
    await waitFor(() => screen.getByText('KAVITA DEVI'));

    fireEvent.press(screen.getByTestId('farmer-verify'));
    fireEvent.press(await screen.findByTestId('farmer-send-code'));
    expect(await screen.findByTestId('farmer-otp-sheet-problem')).toHaveTextContent(
      /No signal right now/,
    );
    const sent = () =>
      (global.fetch as jest.Mock).mock.calls.filter(([input]) =>
        String(typeof input === 'string' ? input : input.url).includes('/farmers/otp/send/'),
      ).length;
    expect(sent()).toBe(0);

    // Signal comes back. Nobody presses anything.
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    await waitFor(() => expect(listener).toBeDefined());
    listener!({ isConnected: true, isInternetReachable: true });

    expect(await screen.findByTestId('farmer-otp-input')).toBeTruthy();
    expect(sent()).toBe(1);
  });

  it('names a request that got no answer as no signal, not as a failed send', async () => {
    mockApi(MEMBER);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    const answer = (global.fetch as jest.Mock).getMockImplementation()!;
    (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
      const href = typeof input === 'string' ? input : input.url;
      if (href.includes('/farmers/otp/send/')) {
        throw new TypeError('Network request failed');
      }
      return answer(input);
    });
    renderMember();
    await waitFor(() => screen.getByText('KAVITA DEVI'));

    fireEvent.press(screen.getByTestId('farmer-verify'));
    fireEvent.press(await screen.findByTestId('farmer-send-code'));

    expect(await screen.findByTestId('farmer-otp-sheet-problem')).toHaveTextContent(
      /sent as soon as signal returns/,
    );
  });

  it('offers Yes, continue only once she has answered', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    await verify();

    fireEvent.press(screen.getByTestId('farmer-confirm'));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 7 })]),
    );
  });

  it('tells a wrong code apart from an expired one', async () => {
    mockApi(MEMBER, { check: problemResponse(400, 'otp-invalid') });
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    await askForTheCode();
    fireEvent.changeText(screen.getByTestId('farmer-otp-input'), '000000');
    fireEvent.press(screen.getByTestId('farmer-check-code'));

    await waitFor(() => expect(screen.getByText(/not right/i)).toBeTruthy());
    // Still in the sheet, on the code, not sent back to the start.
    expect(screen.getByTestId('farmer-otp-input')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sends the Mait back to a fresh code when the attempts run out', async () => {
    mockApi(MEMBER, { check: problemResponse(400, 'otp-attempts-exceeded') });
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    await askForTheCode();
    fireEvent.changeText(screen.getByTestId('farmer-otp-input'), '000000');
    fireEvent.press(screen.getByTestId('farmer-check-code'));

    // Back to the number, where the only thing left to do is send a fresh code.
    await waitFor(() => expect(screen.getByTestId('farmer-send-code')).toBeTruthy());
    expect(screen.getByText(/Too many wrong codes/i)).toBeTruthy();
  });

  it('says a farmer with no number cannot be verified at all', async () => {
    mockApi({ ...MEMBER, mobile_no: '' });
    renderMember();

    await waitFor(() => expect(screen.getByTestId('farmer-no-mobile')).toBeTruthy());
    fireEvent.press(screen.getByTestId('farmer-verify'));

    // The button is inert, so the sheet never opens and no code is ever asked for.
    expect(screen.queryByTestId('farmer-send-code')).toBeNull();
    expect(screen.queryByTestId('farmer-otp-input')).toBeNull();
  });

  it('verifies a non-member the same way, on the number just typed in', async () => {
    mockApi(NON_MEMBER);
    renderNonMember();

    await waitFor(() => expect(screen.getByText('RADHA SINGH')).toBeTruthy());
    expect(screen.getByText('90000 11111')).toBeTruthy();
    await verify();

    fireEvent.press(screen.getByTestId('farmer-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('says nothing about milk payments to a non-member, who pays today', async () => {
    mockApi(NON_MEMBER);
    renderNonMember();

    await waitFor(() => screen.getByText('RADHA SINGH'));

    expect(screen.queryByTestId('member-nothing-to-collect')).toBeNull();
  });

  it('warns the Mait not to take money from a member', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() =>
      expect(screen.getByTestId('member-nothing-to-collect')).toHaveTextContent(
        /Please do not take money from the member/,
      ),
    );
  });

  it('offers searching again as a button of its own, not small print', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    expect(screen.getByTestId('farmer-reject')).toHaveTextContent('No, search again');
    expect(screen.getByTestId('farmer-reject')).toHaveStyle({ borderColor: colors.info });
  });

  it('sends a wrong one back rather than offering to edit it', async () => {
    mockApi(MEMBER);
    renderMember();

    await waitFor(() => screen.getByText('KAVITA DEVI'));
    fireEvent.press(screen.getByTestId('farmer-reject'));

    expect(onSearchAgain).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe('with no signal at all — the office’s code by phone', () => {
    /** A Mait signed in, so the screen knows whose keys to read. */
    function renderSignedIn() {
      const store = makeStore();
      store.dispatch(
        loggedIn({
          access: 'a',
          refresh: 'r',
          user: {
            id: 7,
            fullName: 'Rohit',
            role: 'mait',
            mobileNo: '',
            maitId: 1,
            sahayakVendorCode: null,
          },
          assignedMppCodes: ['001303'],
        }),
      );
      return renderWithStore(
        <ConfirmFarmerScreen
          farmer={{ kind: 'member', memberCode: MEMBER.member_code }}
          onConfirm={onConfirm}
          onSearchAgain={onSearchAgain}
        />,
        { store },
      );
    }

    async function reachTheCall(key: string | null = DAY_KEY) {
      jest
        .spyOn(offlinePack, 'fieldCheckFor')
        .mockResolvedValue({ key, officePhone: '01234567890' });
      mockApi(MEMBER);
      (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
      (NetInfo.addEventListener as jest.Mock).mockImplementation(() => jest.fn());
      renderSignedIn();
      await waitFor(() => screen.getByText('KAVITA DEVI'));

      fireEvent.press(screen.getByTestId('farmer-verify'));
      fireEvent.press(await screen.findByTestId('farmer-send-code'));
      fireEvent.press(await screen.findByTestId('farmer-field-start'));
      await screen.findByTestId('farmer-field-call');
    }

    const herCode = () => fieldCode(DAY_KEY, MEMBER.mobile_no);

    it('is offered once the SMS cannot go, and says what to tell the office', async () => {
      await reachTheCall();

      expect(screen.getByTestId('farmer-field-call')).toHaveTextContent(
        new RegExp(MEMBER.member_code),
      );
      expect(screen.getByTestId('farmer-field-call-dial')).toHaveTextContent(/01234567890/);
    });

    it('checks her code on the phone, and hands it on for the server to match', async () => {
      await reachTheCall();

      fireEvent.changeText(screen.getByTestId('farmer-field-input'), herCode());
      fireEvent.press(screen.getByTestId('farmer-field-check'));
      expect(await screen.findByTestId('farmer-verified')).toHaveTextContent(/office's code/);

      fireEvent.press(screen.getByTestId('farmer-confirm'));
      expect(onConfirm).toHaveBeenCalledWith(expect.any(Array), {
        code: herCode(),
        day: localDay(),
      });
      // Nothing about it needed the network.
      const verifies = (global.fetch as jest.Mock).mock.calls.filter(([input]) =>
        String(typeof input === 'string' ? input : input.url).includes('/otp/verify/'),
      );
      expect(verifies).toHaveLength(0);
    });

    it('counts wrong codes down, then stops taking them', async () => {
      await reachTheCall();
      const wrong = herCode() === '000000' ? '111111' : '000000';

      for (let left = 4; left >= 1; left--) {
        fireEvent.changeText(screen.getByTestId('farmer-field-input'), wrong);
        fireEvent.press(screen.getByTestId('farmer-field-check'));
        expect(await screen.findByTestId('farmer-otp-sheet-problem')).toHaveTextContent(
          new RegExp(`${left} tries left`),
        );
      }
      fireEvent.changeText(screen.getByTestId('farmer-field-input'), wrong);
      fireEvent.press(screen.getByTestId('farmer-field-check'));
      await waitFor(() =>
        expect(screen.getByTestId('farmer-otp-sheet-problem')).toHaveTextContent(/Too many/),
      );

      // Not even the right one, now.
      fireEvent.changeText(screen.getByTestId('farmer-field-input'), herCode());
      fireEvent.press(screen.getByTestId('farmer-field-check'));
      await waitFor(() =>
        expect(screen.getByTestId('farmer-otp-sheet-problem')).toHaveTextContent(/Too many/),
      );
      expect(screen.queryByTestId('farmer-verified')).toBeNull();
    });

    it('says to find signal when the phone has no key for today', async () => {
      await reachTheCall(null);
      expect(await screen.findByTestId('farmer-otp-sheet-problem')).toHaveTextContent(
        /no office key for today/,
      );
    });
  });
});
