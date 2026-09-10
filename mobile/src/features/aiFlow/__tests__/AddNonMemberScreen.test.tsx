/**
 * Non-member registration tests (C5, M6).
 *
 * The case that matters is the Aadhaar check. The non-member path is the one place in this
 * app where a Mait asks a farmer for cash, so it is the one place worth being sure the farmer
 * is not already a member whose milk payment has covered the service.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import AddNonMemberScreen from '../AddNonMemberScreen';
import type { MPP } from '@api/types';
import { clearQueue, readQueue } from '@api/queue';
import { jsonResponse, renderWithStore } from '@/test-utils';

/**
 * The camera, reduced to the one thing this screen cares about: a photo came back.
 *
 * Framing a card is `FlowCamera`'s job and is tested nowhere near here. What matters on this
 * form is that both faces gate the button and both are sent.
 */
jest.mock('../FlowCamera', () => {
  const Actual = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      testIDPrefix,
      onCaptured,
    }: {
      testIDPrefix: string;
      onCaptured: (uri: string) => void;
    }) =>
      Actual.createElement(
        Pressable,
        {
          testID: `${testIDPrefix}-stub`,
          onPress: () => onCaptured(`file:///${testIDPrefix}.jpg`),
        },
        Actual.createElement(Text, null, 'capture'),
      ),
  };
});

/**
 * A field-level validation failure, shaped the way the API sends one (SRS §9.11).
 *
 * Built here rather than with the shared `problemResponse` helper because this test needs a
 * specific `errors` map, and `json` and `text` have to agree — the client reads one or the
 * other depending on the content type.
 */
function fieldErrorResponse(errors: Record<string, string[]>): Response {
  const body = {
    type: 'https://api.maitai.in/errors/validation-error',
    title: 'Error',
    status: 400,
    detail: 'error',
    errors,
  };
  const response = {
    ok: false,
    status: 400,
    statusText: '400',
    headers: new Headers({ 'content-type': 'application/problem+json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => response,
  };
  return response as unknown as Response;
}

/**
 * The body of the registration itself, whichever shape RTK Query happened to call it in.
 *
 * Found by URL rather than by call number. The form asks the server whether the number is
 * already on file while the Mait is typing, so the registration is no longer the first request
 * this screen makes — and a test that counted calls would be asserting against a check.
 *
 * `/non-members/check/` is excluded explicitly rather than by taking the last call: an upload
 * follows the create, and "the last one" would be the Aadhaar images.
 */
/** Every URL the screen has asked for, in order. */
function sentTo(pattern: RegExp): string[] {
  return (global.fetch as jest.Mock).mock.calls
    .map(([input]) => (typeof input === 'string' ? input : input.url))
    .filter((url: string) => pattern.test(url));
}

async function requestBody(): Promise<Record<string, unknown>> {
  const call = (global.fetch as jest.Mock).mock.calls.find(([input, init]) => {
    const href = typeof input === 'string' ? input : input.url;
    const method = init?.method ?? (typeof input === 'string' ? 'GET' : input.method);
    return href.endsWith('/non-members/') && String(method).toUpperCase() === 'POST';
  });
  if (!call) {
    throw new Error('The registration was never sent.');
  }
  const [input, init] = call;
  const raw = init?.body ?? (typeof input === 'string' ? undefined : await input.text());
  return JSON.parse(String(raw));
}

const MPP_FIXTURE: MPP = {
  id: 1,
  mpp_code: 'MPP0004120',
  mpp_name: 'Barsana MPP',
  plant_code: '2001',
  plant_name: 'BARSANA',
  district_code: '048',
  tehsil_code: '04803',
  village_code: '06081400',
  mobile_no: '9795402473',
  is_active: true,
  mait: 3,
  mait_name: 'SHIVKUMAR',
  member_count: 412,
};

function render(overrides: Partial<React.ComponentProps<typeof AddNonMemberScreen>> = {}) {
  return renderWithStore(
    <AddNonMemberScreen
      mpp={MPP_FIXTURE}
      accessToken="test-token"
      online
      onCreated={jest.fn()}
      onCancel={jest.fn()}
      {...overrides}
    />,
  );
}

/** Photograph one face of the card, through the stubbed camera. */
function captureFace(face: 'front' | 'back') {
  fireEvent.press(screen.getByTestId(`non-member-aadhaar-${face}`));
  fireEvent.press(screen.getByTestId(`aadhaar-camera-${face}-stub`));
}

/** Fills everything the form needs except whatever the test is about. */
function fillForm({
  aadhaar = '123456789012',
  relation = 'husband' as 'father' | 'husband' | '',
  cards = true,
  herd = true,
}: {
  aadhaar?: string;
  relation?: 'father' | 'husband' | '';
  cards?: boolean;
  /** Her animals and her milk, required since they became the only record of either. */
  herd?: boolean;
} = {}) {
  fireEvent.changeText(screen.getByTestId('non-member-name'), 'Radha Singh');
  fireEvent.changeText(screen.getByTestId('non-member-mobile'), '9876543210');
  if (herd) {
    fireEvent.changeText(screen.getByTestId('non-member-cows'), '2');
    fireEvent.changeText(screen.getByTestId('non-member-buffaloes'), '0');
    fireEvent.changeText(screen.getByTestId('non-member-litres'), '8');
  }
  if (aadhaar) {
    fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), aadhaar);
  }
  if (relation) {
    fireEvent.press(screen.getByTestId(`non-member-relation-${relation}`));
  }
  if (cards) {
    captureFace('front');
    captureFace('back');
  }
  fireEvent.press(screen.getByTestId('non-member-consent'));
}

describe('AddNonMemberScreen', () => {
  beforeEach(async () => {
    global.fetch = jest.fn() as jest.Mock;
    // A registration made with no signal lands on the queue, so each case starts with an
    // empty one — otherwise the offline tests read each other's work.
    await clearQueue();
  });

  afterEach(() => jest.resetAllMocks());

  it('will not save without an Aadhaar', () => {
    // It is the only field proving she is not already on the roll, so the form cannot be
    // completed around it.
    render();
    fillForm({ aadhaar: '' });
    expect(screen.getByTestId('non-member-save')).toBeDisabled();
  });

  it('will not save on a half-typed Aadhaar', () => {
    render();
    fillForm({ aadhaar: '12345' });
    expect(screen.getByTestId('non-member-save')).toBeDisabled();
  });

  it('will not save without consent', () => {
    render();
    fireEvent.changeText(screen.getByTestId('non-member-name'), 'Radha Singh');
    fireEvent.changeText(screen.getByTestId('non-member-mobile'), '9876543210');
    fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), '123456789012');
    fireEvent.press(screen.getByTestId('non-member-relation-husband'));
    captureFace('front');
    captureFace('back');
    expect(screen.getByTestId('non-member-save')).toBeDisabled();
  });

  it('will not save without saying whose name that is', () => {
    // The column has held both a father's and a husband's name since SAP. A record that
    // cannot say which cannot tell a daughter from a wife, and in a village where the same
    // names repeat that is two women collapsed into one row.
    render();
    fillForm({ relation: '' });
    expect(screen.getByTestId('non-member-save')).toBeDisabled();
  });

  it('will not save on only one face of the card', () => {
    // An optional evidence field is one that is always skipped, and half a card proves half
    // of nothing.
    render();
    fillForm({ cards: false });
    captureFace('front');
    expect(screen.getByTestId('non-member-save')).toBeDisabled();
  });

  it('sends the Aadhaar stripped of its grouping spaces', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ id: 5, name: 'Radha Singh' }, 201),
    );
    render();
    fillForm({ aadhaar: '1234 5678 9012' });

    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await requestBody()).toMatchObject({ aadhar_no: '123456789012' });
  });

  it('says which member the Aadhaar already belongs to', async () => {
    // The server does the matching — the app never holds the member list to search. What it
    // has to do is put the answer where the Mait just typed, naming her, so the next move is
    // obvious: go back and record this as a member.
    (global.fetch as jest.Mock).mockResolvedValue(
      fieldErrorResponse({
        aadhar_no: [
          'Radha Singh is already a member at Barsana MPP (M-9001). Record this as a member — she pays nothing today.',
        ],
      }),
    );

    const onCreated = jest.fn();
    render({ onCreated });
    fillForm();
    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(screen.getByText(/already a member at Barsana MPP/)).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('records that she consented, rather than only requiring it', async () => {
    // The tick gates the button, and a gate is not a record. Without this on the wire,
    // `consent_captured_at` is null on every non-member ever registered (SRS §7).
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 5 }, 201));
    render();
    fillForm();

    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await requestBody()).toMatchObject({ consent: true });
  });

  it('says so when the refusal belongs to no field on the form', async () => {
    // The bug this test exists for: the server refused with a key the form had no box for,
    // the screen filed it and drew nothing, and the Mait's tap was indistinguishable from a
    // dead button. Anything unplaceable must be spoken.
    (global.fetch as jest.Mock).mockResolvedValue(
      fieldErrorResponse({ mpp: ['This is not one of your MPPs.'] }),
    );

    render();
    fillForm();
    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(screen.getByTestId('non-member-error')).toBeTruthy());
    expect(screen.getByText('This is not one of your MPPs.')).toBeTruthy();
  });

  it('says so when the server refuses with no field map at all', async () => {
    // A plain problem detail with nothing this form has a box for. It may not end in silence,
    // and it may not be queued either: the server looked and said no.
    (global.fetch as jest.Mock).mockResolvedValue(
      fieldErrorResponse({ non_field_errors: ['That collection point is not yours.'] }),
    );

    render();
    fillForm();
    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(screen.getByTestId('non-member-error')).toBeTruthy());
  });

  describe('registering her with no signal', () => {
    it('registers her on the handset rather than refusing', async () => {
      // The business said yes to this. A Mait who meets an unregistered farmer in a village
      // with no signal can now serve her; her Aadhaar is checked when the queue drains.
      const onCreated = jest.fn();
      (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

      render({ online: false, onCreated });
      fillForm();
      fireEvent.press(screen.getByTestId('non-member-save'));

      await waitFor(() => expect(onCreated).toHaveBeenCalled());
      const [farmer, queued] = onCreated.mock.calls[0];
      expect(queued).toBe(true);
      // A provisional id the server has never seen. Nothing may ever put it in a URL.
      expect(farmer.id).toBeLessThan(0);
      expect(farmer.client_uuid).toBeTruthy();
    });

    it('queues her card with her', async () => {
      // It is the evidence behind the number that was typed, and a village dropping a JPEG
      // must not be the reason a registration has nothing standing behind it.
      (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

      render({ online: false });
      fillForm();
      fireEvent.press(screen.getByTestId('non-member-save'));

      await waitFor(async () =>
        expect((await readQueue()).map(job => job.kind)).toEqual([
          'createNonMember',
          'attachAadhaar',
        ]),
      );
    });

    it('says what is about to happen, before the button', async () => {
      // The next thing on this flow is the Mait asking her for cash, and with no signal her
      // details cannot be checked against the membership roll until the queue drains. The
      // person about to ask for money is the person who should know that.
      render({ online: false });

      expect(screen.getByTestId('non-member-offline')).toHaveTextContent(/membership roll/i);
    });

    it('still warns about a number already on this phone', async () => {
      // The check that matters most where the server cannot be reached: her Aadhaar is
      // validated hours later, after the cash, so catching her by her number now is what
      // prevents the mistake rather than reporting it.
      (global.fetch as jest.Mock).mockImplementation(async (input: string | Request) => {
        const href = typeof input === 'string' ? input : input.url;
        if (href.includes('/non-members/roster/')) {
          return jsonResponse([{ name: 'Kavita Devi', mobile_no: '9876543210', kind: 'member' }]);
        }
        return Promise.reject(new TypeError('Network request failed'));
      });

      render({ online: false });
      fireEvent.changeText(screen.getByTestId('non-member-mobile'), '9876543210');

      const warning = await screen.findByTestId('non-member-mobile-warning');
      expect(warning).toHaveTextContent(/Kavita Devi/);
      // Warned, never blocked: one phone per household is ordinary.
      expect(screen.queryByTestId('non-member-save')).toBeTruthy();
    });
  });

  it('sends whose name it is, so a wife is not filed as a daughter', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 5 }, 201));
    render();
    fillForm({ relation: 'father' });

    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(await requestBody()).toMatchObject({ relation: 'father' });
  });

  it('sends both faces of the card against the id she came back with', async () => {
    // The card cannot go first — there is nothing to attach it to. Found by URL rather than by
    // call number: the form also asks whether her number is already on file while the Mait is
    // typing, so the registration is not the first request this screen makes.
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 5 }, 201));
    render();
    fillForm();

    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(sentTo(/\/aadhaar\/$/)).toHaveLength(1));
    expect(sentTo(/\/aadhaar\/$/)[0]).toContain('/non-members/5/aadhaar/');
  });

  describe('catching a farmer who is already on file', () => {
    const FREE = { available: true, blocking: false, kind: '', detail: '' };

    /**
     * The server's answers to "is this already somebody's", one per field.
     *
     * Routed by which field the request asked about, not answered with one body for both. The
     * screen asks two questions with two different consequences — the Aadhaar stops the form,
     * the mobile only warns — and a mock that gave the same answer to both would make it
     * impossible to tell which one a test had actually proved.
     */
    function answering({
      aadhaar = FREE,
      mobile = FREE,
    }: {
      aadhaar?: Record<string, unknown>;
      mobile?: Record<string, unknown>;
    }) {
      (global.fetch as jest.Mock).mockImplementation(
        async (input: string | Request, init?: RequestInit) => {
          const href = typeof input === 'string' ? input : input.url;
          // The books this collection point keeps, which the form reads to warn about a
          // duplicate with no signal. Empty here: these cases are about the server's answer.
          if (href.includes('/non-members/roster/')) {
            return jsonResponse([]);
          }
          if (!href.endsWith('/non-members/check/')) {
            return jsonResponse({ id: 5, name: 'Radha Singh' }, 201);
          }
          const raw = init?.body ?? (typeof input === 'string' ? '{}' : await input.text());
          const asked = JSON.parse(String(raw)) as { aadhar_no?: string };
          return jsonResponse(asked.aadhar_no ? aadhaar : mobile);
        },
      );
    }

    it('says whose Aadhaar it is, before the farmer is asked for money', async () => {
      // The whole point of checking as it is typed rather than at Save: by the time a Mait
      // reaches the button they have already told her she is being registered as a
      // non-member, and a non-member pays cash in the yard.
      answering({
        aadhaar: {
          available: false,
          blocking: true,
          kind: 'member',
          detail: 'Kavita Devi is already a member at Barsana MPP (0906167700010001).',
        },
      });
      render();

      fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), '123456789012');

      expect(await screen.findByText(/Kavita Devi is already a member/)).toBeTruthy();
    });

    it('will not let the registration go on', async () => {
      answering({
        aadhaar: {
          available: false,
          blocking: true,
          kind: 'member',
          detail: 'Kavita Devi is already a member at Barsana MPP.',
        },
      });
      render();
      fillForm();

      // Waited for rather than asserted straight after the text appears: the mobile check and
      // the Aadhaar check are two requests, and the one that renders first is not necessarily
      // the one this case is about.
      await waitFor(() => expect(screen.getByTestId('non-member-save')).toBeDisabled());
    });

    it('lets go the moment the number is corrected', async () => {
      // A warning that outlived the number it was about would be worse than none: the Mait
      // fixes a mistyped digit and the form keeps refusing a farmer who was never on file.
      answering({
        aadhaar: {
          available: false,
          blocking: true,
          kind: 'member',
          detail: 'Kavita Devi is already a member at Barsana MPP.',
        },
      });
      render();
      fillForm();
      await waitFor(() => expect(screen.getByTestId('non-member-save')).toBeDisabled());

      answering({});
      fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), '123456789013');

      await waitFor(() => expect(screen.getByTestId('non-member-save')).toBeEnabled());
    });

    it('warns about a shared number without refusing it', async () => {
      // One phone per household is ordinary, and a mother and a daughter share a handset. This
      // is a question put to the Mait — go and look, or carry on because it really is a
      // different woman — not an answer given to them.
      answering({
        mobile: {
          available: false,
          blocking: false,
          kind: 'member',
          detail: 'This number is on file for Kavita Devi, a member at Barsana MPP.',
        },
      });
      render();
      fillForm();

      expect(await screen.findByTestId('non-member-mobile-warning')).toBeTruthy();
      // Warned, and still able to go on.
      expect(screen.getByTestId('non-member-save')).toBeEnabled();
    });

    it('says nothing at all when there is no signal to ask over', async () => {
      // The create is still the authority and still refuses. A form that announced "could not
      // check" on every keystroke in a village would teach a Mait to ignore the one message
      // that matters.
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));
      render();

      fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), '123456789012');

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(screen.queryByTestId('non-member-mobile-warning')).toBeNull();
    });

    it('does not block on an answer that never said so', async () => {
      // A `200` from something that is not this endpoint — a captive portal, a proxy page, a
      // body that lost a field. This warning stops a registration and names a farmer, so only
      // an answer that actually said "no" may raise it.
      answering({ aadhaar: { something: 'else' }, mobile: { something: 'else' } });
      render();
      fillForm();

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(screen.getByTestId('non-member-save')).toBeEnabled();
    });
  });

  describe('her herd', () => {
    it('sends what was entered', async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 5 }, 201));
      render();
      fillForm();

      fireEvent.changeText(screen.getByTestId('non-member-cows'), '3');
      fireEvent.changeText(screen.getByTestId('non-member-buffaloes'), '2');
      fireEvent.changeText(screen.getByTestId('non-member-litres'), '12.5');
      fireEvent.press(screen.getByTestId('non-member-save'));

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(await requestBody()).toMatchObject({
        cattle_cows: 3,
        cattle_buffaloes: 2,
        daily_yield_litres: '12.5',
      });
    });

    it('will not save while a box is unanswered', () => {
      // This is the only record the dairy will ever hold of the herd behind a farmer who is
      // not on the membership roll. Left optional it was left blank.
      render();
      fillForm({ herd: false });

      expect(screen.getByTestId('non-member-save')).toBeDisabled();
    });

    it('takes a zero, because a zero is an answer', () => {
      // A household that keeps no buffaloes and is milking nothing today is an ordinary
      // record. What is refused is silence, not nought.
      render();
      fillForm({ herd: false });

      fireEvent.changeText(screen.getByTestId('non-member-cows'), '1');
      fireEvent.changeText(screen.getByTestId('non-member-buffaloes'), '0');
      fireEvent.changeText(screen.getByTestId('non-member-litres'), '0');

      expect(screen.getByTestId('non-member-save')).toBeEnabled();
    });

    it('will not take a herd of nothing at all', () => {
      // She is being registered so her animal can be inseminated. Two zeroes is not an
      // answer, it is the fastest way past two boxes.
      render();
      fillForm({ herd: false });

      fireEvent.changeText(screen.getByTestId('non-member-cows'), '0');
      fireEvent.changeText(screen.getByTestId('non-member-buffaloes'), '0');
      fireEvent.changeText(screen.getByTestId('non-member-litres'), '0');

      expect(screen.getByTestId('non-member-save')).toBeDisabled();
    });

    it('sends the zero rather than dropping it', async () => {
      // A blank must never reach the server as 0 — but an answered zero must, or the record
      // says she was never asked.
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: 5 }, 201));
      render();
      fillForm();

      fireEvent.press(screen.getByTestId('non-member-save'));

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(await requestBody()).toMatchObject({
        cattle_cows: 2,
        cattle_buffaloes: 0,
        daily_yield_litres: '8',
      });
    });

    it('keeps a second decimal point out of the litres box', () => {
      render();

      fireEvent.changeText(screen.getByTestId('non-member-litres'), '12.5.7');

      expect(screen.getByTestId('non-member-litres').props.value).toBe('12.57');
    });
  });

  it('goes on when the card upload fails, because she is already registered', async () => {
    // The record is what the flow is standing on. Sending a Mait back to re-enter five fields
    // and re-photograph a document because a village dropped a JPEG would cost more than the
    // images are worth — they can be retried, the form cannot.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ id: 5, name: 'Radha Singh' }, 201))
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    const onCreated = jest.fn();
    render({ onCreated });
    fillForm();

    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 5 });
  });
});
