/**
 * Where a half-finished capture stopped, and where picking it up puts the Mait.
 *
 * One insemination is six steps and four of them write to the server, so a capture can be
 * abandoned in four different places: the straw not chosen, the photo not taken, the payment
 * not recorded, the authorisation code not confirmed. Each of those needs the Mait dropped
 * back at a *different* screen — the app used to send every one of them to the photo step,
 * which is right for exactly one of the four and wrong for the rest. A Mait resumed at the
 * camera for a capture that already had its photo would take a second one and still not close
 * the event.
 *
 * The mapping lives here rather than in the navigator so the list and the resume agree by
 * construction: the row says "photo not taken" because this function said so, and tapping it
 * lands on the camera for the same reason. Two copies of this rule would drift, and the drift
 * would read as the app lying about what is missing.
 *
 * Which statuses count as unfinished at all is the server's rule, not this one — see the
 * `unfinished` filter on `/ai-events/`.
 */

import type { AIEvent } from '@api/types';

/** The steps a capture can be resumed at. Names match the navigator's own step machine. */
export type ResumeStep =
  'selectBreed' | 'capturePhoto' | 'memberStatement' | 'collectPayment' | 'recordPayment';

export interface ResumePoint {
  step: ResumeStep;
  /** What is missing, as an i18n key — the row's own label and the reason it is in the list. */
  missingKey: string;
  /**
   * How far through the six the capture got, for the progress the row shows.
   *
   * Counted in steps *done*, not in screens: a Mait reads "4 of 6" as four answered, and the
   * step they are about to be dropped on is the fifth.
   */
  done: number;
}

/**
 * A member owes nothing in the yard and a non-member pays on the spot, so the same status
 * resumes at two different screens depending on who the farmer is — which is the reason this
 * takes the whole event rather than just its status.
 */
export function resumePoint(event: AIEvent): ResumePoint {
  const member = event.owner_type === 'member';

  switch (event.status) {
    case 'draft':
      // No straw held yet. The app does not create these — it always opens an event with a
      // breed — but an event corrected by an admin can land here, and dropping the Mait at
      // the breed step is the honest answer rather than pretending it cannot happen.
      return { step: 'selectBreed', missingKey: 'unfinished.missingStraw', done: 4 };

    case 'photo_captured':
      // The animal is served and the evidence is up; nothing has been recorded about money.
      return {
        step: member ? 'memberStatement' : 'collectPayment',
        missingKey: member ? 'unfinished.missingCloseOff' : 'unfinished.missingPayment',
        done: 6,
      };

    case 'payment_pending':
      // A payment was started and her code never came back. This is the one a Mait is most
      // likely to be holding cash against.
      return { step: 'recordPayment', missingKey: 'unfinished.missingCode', done: 6 };

    case 'straw_verified':
    default:
      return { step: 'capturePhoto', missingKey: 'unfinished.missingPhoto', done: 5 };
  }
}

/**
 * How urgent it is, for the tone the row wears.
 *
 * Money outranks everything: a capture stopped after the photo is one where the service has
 * been given and nothing has been recorded about paying for it, and for a non-member that
 * means a Mait may already be carrying her cash. The rest are work in progress.
 */
export function resumeTone(event: AIEvent): 'accent' | 'muted' {
  return event.status === 'photo_captured' || event.status === 'payment_pending'
    ? 'accent'
    : 'muted';
}
