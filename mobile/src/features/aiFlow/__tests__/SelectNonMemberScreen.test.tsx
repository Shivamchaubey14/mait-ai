/**
 * Non-member selection tests (SRS §6.3 step 2, C4b).
 *
 * The case worth pinning is where "Register a new farmer" sits. It closed the list once, which
 * reads well and works badly: an MPP with forty registrations put it forty cards down, so a
 * Mait standing in front of a woman who is not on the list had to scroll the whole roster to
 * reach the one thing that helps — having already scrolled it once to find out she was not
 * there. It belongs directly under the search field, and it has to stay there while a search
 * filters the list, because that is exactly when it is wanted.
 */

import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SelectNonMemberScreen from '../SelectNonMemberScreen';
import type { MPP, NonMemberSummary } from '@api/types';
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

function farmer(id: number, name: string, over: Partial<NonMemberSummary> = {}): NonMemberSummary {
  return {
    id,
    name,
    father_husband_name: 'RAM SINGH',
    relation: 'husband',
    relation_display: 'Husband',
    mobile_no: '9876543210',
    animal_count: 1,
    ai_event_count: 0,
    last_ai_at: null,
    created_at: '2026-08-01T10:00:00Z',
    ...over,
  };
}

function mockFarmers(results: NonMemberSummary[]) {
  (global.fetch as jest.Mock).mockResolvedValue(
    jsonResponse({ count: results.length, next: null, previous: null, results }),
  );
}

describe('SelectNonMemberScreen', () => {
  const onSelect = jest.fn();
  const onAddNew = jest.fn();
  const onBack = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn() as jest.Mock;
  });

  afterEach(() => jest.resetAllMocks());

  function renderScreen() {
    return renderWithStore(
      <SelectNonMemberScreen
        mpp={MPP_FIXTURE}
        onSelect={onSelect}
        onAddNew={onAddNew}
        onBack={onBack}
      />,
    );
  }

  it('lists the non-members registered at this MPP', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI')]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('SUNITA DEVI')).toBeTruthy());
  });

  it('puts "Register a new farmer" above the roster, not after it', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI'), farmer(2, 'RADHA SINGH'), farmer(3, 'KAMLA')]);
    renderScreen();

    await waitFor(() => screen.getByText('KAMLA'));

    // Order in the tree is order down the screen: whatever the roster holds, the way out is
    // the first card under the search field rather than something at the end of a scroll.
    const ids = screen
      .getAllByTestId(/^non-member-(add-card|\d+)$/)
      .map(node => String(node.props.testID));

    expect(ids[0]).toBe('non-member-add-card');
    expect(ids).toEqual(['non-member-add-card', 'non-member-1', 'non-member-2', 'non-member-3']);
  });

  it('offers it on an MPP where nobody has been registered yet', async () => {
    mockFarmers([]);
    renderScreen();

    await waitFor(() => screen.getByTestId('non-member-empty'));
    expect(screen.getByTestId('non-member-add-card')).toBeTruthy();
  });

  it('keeps it in reach while a search is filtering', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI')]);
    renderScreen();

    await waitFor(() => screen.getByText('SUNITA DEVI'));
    // "She is not in here" is the moment it is wanted, so a search that matches nothing must
    // still leave it on screen.
    mockFarmers([]);
    fireEvent.changeText(screen.getByTestId('non-member-search'), 'ZZZZ');

    await waitFor(() => expect(screen.getByTestId('non-member-add-card')).toBeTruthy());
  });

  it('registers somebody genuinely new', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI')]);
    renderScreen();

    await waitFor(() => screen.getByText('SUNITA DEVI'));
    fireEvent.press(screen.getByTestId('non-member-add-card'));

    expect(onAddNew).toHaveBeenCalled();
  });

  it('commits the chosen farmer from the footer, not the row', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI')]);
    renderScreen();

    await waitFor(() => screen.getByText('SUNITA DEVI'));
    // A mis-tap in a roster read aloud in a yard should be a correction, not a wrong event.
    fireEvent.press(screen.getByTestId('non-member-1'));
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('non-member-continue'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'SUNITA DEVI' }));
  });

  it('will not continue until one is chosen', async () => {
    mockFarmers([farmer(1, 'SUNITA DEVI')]);
    renderScreen();

    await waitFor(() => screen.getByText('SUNITA DEVI'));
    fireEvent.press(screen.getByTestId('non-member-continue'));

    expect(onSelect).not.toHaveBeenCalled();
  });
});
