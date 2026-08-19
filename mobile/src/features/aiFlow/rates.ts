/**
 * What a non-member pays, before anybody has chosen a breed.
 *
 * The first and third steps of the capture both say what a farmer pays — the non-member's
 * cash on step 1, the member's deduction on step 3 — and both are asked before the straw is
 * picked, so neither can call the pricing endpoint, which needs a breed to answer. What they
 * can do is read the breed list, which the app already holds for the picker and which carries
 * every rate the administrator has set.
 *
 * A figure is only named when there is one figure to name. Where the dairy prices breeds
 * differently — which it is free to do, and which is the whole reason the rate lives on the
 * breed rather than in a build — no number is quoted at all: a farmer hears any figure a Mait
 * reads out as final, and a wrong one is a Mait to be argued with in a yard.
 *
 * This replaces `NON_MEMBER_FEE`, a value in `app.json` that was null in every build and
 * would have gone stale the day the dairy re-priced anything. `apps/payments/pricing.py` says
 * it plainly: the price is admin data, never a constant in a build.
 */

import { useListBreedsQuery } from '@api/endpoints';

/**
 * The single rate every breed shares for this kind of farmer, or null when they do not share
 * one.
 *
 * Null covers all three of "the list has not loaded", "nobody has priced anything" and "the
 * breeds are priced differently" — the screens read it the same way in each case, because the
 * honest answer is the same: there is an amount, and it is settled at the straw.
 */
export function useServiceRate(owner: 'member' | 'nonMember'): number | null {
  const breeds = useListBreedsQuery();

  const rates = new Set(
    (breeds.data ?? [])
      .map(breed => Number(owner === 'member' ? breed.rate : breed.non_member_rate))
      .filter(rate => isFinite(rate) && rate > 0),
  );

  const [only] = Array.from(rates);
  return rates.size === 1 && only !== undefined ? only : null;
}
