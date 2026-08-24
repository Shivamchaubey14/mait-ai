/**
 * What a pregnancy diagnosis costs, and who settles it.
 *
 * **Two prices for one service, settled in different worlds.** A member hands over nothing in
 * the yard — the dairy takes it out of a milk payment it already owes her at the next payout —
 * and a non-member pays the Mait in cash before anybody leaves. The same split the
 * insemination rate makes, for the same reason, and the app has to say which one is happening
 * because they call for opposite actions from the Mait standing there.
 *
 * The figure is the server's. It arrives already resolved for this owner on the check itself
 * (`price`), rather than being looked up from a rates endpoint, because a Mait works a round
 * with no signal and because a price the handset works out for itself is a price that can
 * disagree with the one the dairy bills.
 *
 * **Three states, not two.** `unpriced` is what a null rate means: chargeable, but nobody has
 * said how much. It is not free, and the app must never round it down to a zero — a farmer
 * hears any figure a Mait reads out as final, and "nothing" is the one that cannot be walked
 * back. So the screens say the visit is chargeable and tell the Mait not to quote.
 *
 * Whether anything is owed at all is decided elsewhere: a refused visit is never billed, and
 * `settlementFor` returns `none` for it.
 */

import type { PdOutcome, PregnancyCheck } from '@api/types';

export type Settlement =
  /** A member: deducted from her milk payment, nothing changes hands here. */
  | { kind: 'member'; amount: number }
  /** A non-member: cash, in the yard, now. */
  | { kind: 'nonMember'; amount: number }
  /** Chargeable, but the office has not set a rate. Quote nothing. */
  | { kind: 'unpriced' }
  /** Nothing to settle — nobody examined the animal. */
  | { kind: 'none' };

/**
 * Rounded to whole rupees, the way every other amount in this app is shown.
 *
 * A Mait counts notes, not paise, and `₹ 150.00` in a yard is two extra characters to read
 * past. The stored figure keeps its decimals; this is only how it is said out loud.
 */
function rupees(price: string | null): number | null {
  const amount = Number(price);
  return price !== null && isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

/**
 * How this visit is settled.
 *
 * `outcome` is passed separately from the check because the screen that shows this before the
 * examination knows what is *about* to be recorded, while the check in hand still says nothing.
 * Omit it to ask about the visit as it stands.
 */
export function settlementFor(check: PregnancyCheck, outcome?: PdOutcome | null): Settlement {
  // A refusal is never billed. Nothing was examined, and charging for a visit the owner
  // turned away is the one thing that would make a Mait stop offering the choice honestly.
  if ((outcome ?? check.outcome) === 'declined') {
    return { kind: 'none' };
  }

  // What was actually stamped on the record wins over today's rate. A visit recorded last
  // month was charged at last month's price, and re-quoting it through the current one would
  // tell a Mait a figure the dairy is not billing.
  const amount = rupees(check.amount_charged ?? check.price);
  if (amount === null) {
    return { kind: 'unpriced' };
  }

  return check.owner_type === 'member' ? { kind: 'member', amount } : { kind: 'nonMember', amount };
}
