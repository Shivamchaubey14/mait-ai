/**
 * The capture flow in the coloured screen pattern.
 *
 * The six steps are built from a dozen shared pieces, so the colour lives in them: every card
 * in the wash of its tone with its glyph on a solid chip, a chosen row green and drawn heavier,
 * straws blue with the syringe, a photograph blue until it is taken and green once it is.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { AddCard, CaptureTile, IdentityCard, OptionCard, Segmented } from '../components';
import { colors, yolk } from '@theme/tokens';

describe('the flow in colour', () => {
  it('draws an option card in its tone, with its glyph on a solid chip', () => {
    render(<OptionCard title="Barsana" tone="info" icon="home" testID="row" />);

    expect(screen.getByTestId('row')).toHaveStyle({
      backgroundColor: colors.infoWash,
      borderColor: colors.info,
    });
  });

  it('turns a chosen row green and draws its edge heavier', () => {
    render(<OptionCard title="Kavita Devi" tone="info" selected testID="row" />);

    expect(screen.getByTestId('row')).toHaveStyle({
      backgroundColor: colors.primaryWash,
      borderColor: colors.primary,
      borderWidth: 2,
    });
  });

  it('draws a person in yolk', () => {
    render(<OptionCard title="Ramesh" tone="accent" testID="row" />);

    expect(screen.getByTestId('row')).toHaveStyle({ backgroundColor: colors.secondaryWash });
  });

  it('draws the way to add a record as a dashed blue card with a solid plus', () => {
    render(<AddCard title="Add an animal" onPress={jest.fn()} testID="add" />);

    expect(screen.getByTestId('add')).toHaveStyle({
      backgroundColor: colors.infoWash,
      borderStyle: 'dashed',
    });
  });

  it('draws a photograph still to take in blue, and one taken in green', () => {
    const { rerender } = render(
      <CaptureTile label="Front" hint="Tap to take" uri={null} onPress={jest.fn()} testID="t" />,
    );
    expect(screen.getByTestId('t')).toHaveStyle({ backgroundColor: colors.infoWash });

    rerender(
      <CaptureTile
        label="Front"
        hint="Tap to take"
        uri="file://front.jpg"
        onPress={jest.fn()}
        testID="t"
      />,
    );
    expect(screen.getByTestId('t')).toHaveStyle({ backgroundColor: colors.primaryWash });
  });

  it('draws cow or buffalo as a blue control, the chosen half filled', () => {
    render(
      <Segmented
        options={[
          { value: 'COW', label: 'Cow' },
          { value: 'BUFF', label: 'Buffalo' },
        ]}
        value="COW"
        onChange={jest.fn()}
        testID="type"
      />,
    );

    expect(screen.getByTestId('type-COW')).toHaveStyle({ backgroundColor: colors.info });
  });

  it('draws the farmer being confirmed in yolk, the colour of people', () => {
    render(
      <IdentityCard
        name="Kavita Devi"
        code="MEM00000412"
        facts={[{ label: 'MPP', value: 'Barsana' }]}
        testID="who"
      />,
    );

    expect(screen.getByTestId('who')).toHaveStyle({
      backgroundColor: colors.secondaryWash,
      borderColor: yolk[300],
    });
  });
});
