/**
 * The problem card.
 *
 * The old error state said "Could not load your history" over a red cloud and offered Try
 * again. That names *our* problem. A Mait standing in a yard needs two different answers
 * depending on the cause — walk somewhere with signal, or carry on working because the phone
 * is holding everything safely — and one sentence cannot give both.
 *
 * So what is defended here is that the card is built from the cause, that no signal is never
 * dressed as a fault, and above all that the reassurance line is true: a Mait who is told
 * their work might be lost will re-enter an insemination they have already recorded, and a
 * duplicate is worse than a wrong error message.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

import Problem, { PROBLEM_TONE } from '../problem';
import { clearQueue, enqueue } from '@api/queue';
import i18n from '@/i18n';

describe('the tone', () => {
  it('calls no signal a situation, not a fault', () => {
    // Amber, not red. A village with no bars is the ordinary condition this app was built
    // for — the queue exists precisely for it — and a Mait told it is an error starts
    // doubting the handset every time they walk into a dip.
    expect(PROBLEM_TONE.offline).toBe('warning');
    expect(PROBLEM_TONE.exhausted).toBe('warning');
  });

  it('calls a silent server a fault, because it is ours', () => {
    expect(PROBLEM_TONE.server).toBe('error');
    expect(PROBLEM_TONE.signIn).toBe('error');
  });
});

describe('no network', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('names the records being held, rather than promising vaguely that work is safe', () => {
    // "Your 3 saved records are safe" answers the question. "Your work is safe" invites a
    // Mait to wonder which work.
    render(<Problem kind="offline" onRetry={jest.fn()} pending={3} />);

    expect(screen.getByTestId('problem-title')).toHaveTextContent(i18n.t('problem.offline.title'));
    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(/3/);
  });

  it('does not claim to be holding records when it is holding none', () => {
    render(<Problem kind="offline" onRetry={jest.fn()} pending={0} />);

    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(
      i18n.t('problem.offline.nothingHeld'),
    );
  });

  it('counts the queue itself when the screen does not know', async () => {
    // Five of the seven screens that can show this card have no idea how many records are
    // waiting. Rather than plumb the number through all of them, the card reads the queue —
    // which is what makes the sentence true wherever it appears.
    await enqueue('completeEvent', 'uuid-a', { eventId: 1 });
    await enqueue('completeEvent', 'uuid-b', { eventId: 2 });

    render(<Problem kind="offline" onRetry={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(/2/));
  });

  it('says nothing about counts until it knows one', async () => {
    // The bug this closes. `pending` used to default to zero, so a screen that simply did not
    // know announced "nothing is waiting to send" — on a handset that might be holding a
    // day's inseminations. Better to say something true and general than something specific
    // and wrong.
    await enqueue('completeEvent', 'uuid-c', { eventId: 3 });

    render(<Problem kind="offline" onRetry={jest.fn()} />);

    // Before the read resolves.
    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(
      i18n.t('problem.offline.unknownHeld'),
    );
    expect(screen.queryByText(i18n.t('problem.offline.nothingHeld'))).toBeNull();
  });

  it('offers a way out of the card as well as a retry', () => {
    render(<Problem kind="offline" onRetry={jest.fn()} onDismiss={jest.fn()} />);

    expect(screen.getByTestId('problem-retry')).toBeTruthy();
    expect(screen.getByTestId('problem-dismiss')).toBeTruthy();
  });
});

describe('the server not answering', () => {
  it('says nothing recorded is affected — the only question a Mait actually has', () => {
    render(<Problem kind="server" onRetry={jest.fn()} />);

    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(
      i18n.t('problem.server.reassurance'),
    );
  });

  it('says when the server was last reached, where that is known', () => {
    render(<Problem kind="server" onRetry={jest.fn()} lastReachedAt="9:48" />);

    expect(screen.getByText(/9:48/)).toBeTruthy();
  });

  it('leaves the time out rather than printing an empty sentence', () => {
    render(<Problem kind="server" onRetry={jest.fn()} lastReachedAt={null} />);

    expect(screen.getByText(i18n.t('problem.server.subtitle'))).toBeTruthy();
  });

  it('shows no second button while there is no number to reach', () => {
    // `extra.itSupportPhone` is unset, so Report and Call have nowhere to go. A button that
    // does nothing costs a Mait a tap and their belief that the app does what it says.
    render(<Problem kind="server" onRetry={jest.fn()} />);

    expect(screen.queryByTestId('problem-call')).toBeNull();
  });
});

describe('signing in', () => {
  it('says the one step that cannot work offline, and why', () => {
    render(<Problem kind="signIn" onRetry={jest.fn()} />);

    expect(screen.getByTestId('problem-title')).toHaveTextContent(i18n.t('problem.signIn.title'));
    // And that everything *after* it does work offline, or a Mait with one bar gives up on
    // the whole app rather than on this screen.
    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(/capture flow/i);
  });
});

describe('retrying having given up', () => {
  it('shows how many attempts were made and says why it stopped', () => {
    render(
      <Problem
        kind="exhausted"
        onRetry={jest.fn()}
        attempts={{ made: 5, of: 5 }}
        lastReachedAt="10:12"
      />,
    );

    expect(screen.getByText('5 / 5')).toBeTruthy();
    expect(screen.getByTestId('problem-reassurance')).toHaveTextContent(/battery/i);
  });
});

describe('every variant', () => {
  const kinds = ['offline', 'server', 'signIn', 'exhausted'] as const;

  it('always answers "is my work lost" in the same place', () => {
    // The question underneath all four. Answering it somewhere different each time is how a
    // Mait learns to stop looking for the answer.
    kinds.forEach(kind => {
      render(<Problem kind={kind} onRetry={jest.fn()} />);
      expect(screen.getByTestId('problem-reassurance')).toBeTruthy();
      screen.unmount();
    });
  });

  it('always offers a way forward — no dead ends', () => {
    kinds.forEach(kind => {
      render(<Problem kind={kind} onRetry={jest.fn()} />);
      expect(screen.getByTestId('problem-retry')).toBeTruthy();
      screen.unmount();
    });
  });

  it('resolves every string in both languages', () => {
    // A missing key renders as its own path, and this card is only ever seen at the worst
    // moment — nobody is going to be forgiving about "problem.server.reassurance" on screen.
    ['en', 'hi'].forEach(lng => {
      const t = i18n.getFixedT(lng);
      kinds.forEach(kind => {
        ['title', 'subtitle', 'primary'].forEach(part => {
          const key = `problem.${kind}.${part}`;
          expect(t(key)).not.toBe(key);
        });
      });
    });
  });
});
