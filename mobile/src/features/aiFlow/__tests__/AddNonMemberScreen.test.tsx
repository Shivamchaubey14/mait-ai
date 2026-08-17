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
import { jsonResponse, renderWithStore } from '@/test-utils';

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

/** The body of the nth fetch, whichever shape RTK Query happened to call it in. */
async function requestBody(call: number): Promise<Record<string, unknown>> {
  const [input, init] = (global.fetch as jest.Mock).mock.calls[call];
  const raw = init?.body ?? (typeof input === 'string' ? undefined : await input.text());
  return JSON.parse(String(raw));
}

const MPP_FIXTURE: MPP = {
  id: 1,
  mpp_code: 'MPP0004120',
  mpp_name: 'Barsana MPP',
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
      onCreated={jest.fn()}
      onCancel={jest.fn()}
      {...overrides}
    />,
  );
}

/** Fills everything the form needs except whatever the test is about. */
function fillForm({ aadhaar = '123456789012' }: { aadhaar?: string } = {}) {
  fireEvent.changeText(screen.getByTestId('non-member-name'), 'Radha Singh');
  fireEvent.changeText(screen.getByTestId('non-member-mobile'), '9876543210');
  if (aadhaar) {
    fireEvent.changeText(screen.getByTestId('non-member-aadhaar'), aadhaar);
  }
  fireEvent.press(screen.getByTestId('non-member-consent'));
}

describe('AddNonMemberScreen', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
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
    expect(await requestBody(0)).toMatchObject({ aadhar_no: '123456789012' });
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
    expect(await requestBody(0)).toMatchObject({ consent: true });
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
    // A plain problem detail, or a request that never arrived. Neither may end in silence.
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    render();
    fillForm();
    fireEvent.press(screen.getByTestId('non-member-save'));

    await waitFor(() => expect(screen.getByTestId('non-member-error')).toBeTruthy());
  });
});
