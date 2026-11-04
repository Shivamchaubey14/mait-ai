/**
 * The app's own confirmation card, which replaced the system alert for signing out.
 *
 * What matters: it says what it asks, Cancel does nothing else, and the acting button holds
 * still while its work runs so a slow sign-out cannot be pressed twice.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ConfirmDialog } from '../confirmDialog';
import '@/i18n';

function renderDialog(onConfirm: () => void | Promise<void>, onCancel = jest.fn()) {
  render(
    <ConfirmDialog
      visible
      title="Sign out?"
      body="You will need your username and password to sign back in."
      confirmLabel="Sign out"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return onCancel;
}

describe('ConfirmDialog', () => {
  it('shows the question and both buttons', () => {
    renderDialog(jest.fn());
    const card = screen.getByTestId('confirm-dialog');
    expect(card).toHaveTextContent(/Sign out\?/);
    expect(card).toHaveTextContent(/username and password/);
    expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Sign out');
  });

  it('cancels from the button and from the scrim, without confirming', () => {
    const onConfirm = jest.fn();
    const onCancel = renderDialog(onConfirm);
    fireEvent.press(screen.getByTestId('confirm-dialog-cancel'));
    // The scrim sits behind a modal card, so a screen reader rightly does not see it.
    fireEvent.press(screen.getByTestId('confirm-dialog-scrim', { includeHiddenElements: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('holds the confirm button busy while the work runs', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );
    const onCancel = renderDialog(onConfirm);

    fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));
    expect(screen.getByTestId('confirm-dialog-confirm').props.accessibilityState).toMatchObject({
      busy: true,
    });
    // Neither a second press nor a cancel gets through mid-sign-out.
    fireEvent.press(screen.getByTestId('confirm-dialog-confirm'));
    fireEvent.press(screen.getByTestId('confirm-dialog-cancel'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Sign out');
  });
});
