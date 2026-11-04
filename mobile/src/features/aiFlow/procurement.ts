/**
 * The portal's "poured vs bar" line, for the member picker row and her confirm card.
 *
 * An AI charge is recovered from a member's milk payout, so she can only be sent an insemination
 * code once she has poured enough to cover it. The portal (admin-web `ai-events.js` and
 * `super-otp.js`) draws a one-line note for a gated member — how much she has poured against the
 * bar — and this is the same note for the handset, so a Mait in the yard and the office reading
 * the event see the same figures the same way.
 *
 * The server decides eligibility one way (`masterdata.procurement`) and ships the same block to
 * both; this only formats it. It returns `null` when there is nothing to say — no procurement
 * block at all (older payload), or the gate is not live — so a caller renders the line only when
 * it is there, and a dairy that has uploaded no procurement sees nothing new.
 */

import type { TFunction } from 'i18next';

import type { MemberProcurement } from '@api/types';

/** A rupee figure the way the portal rounds it — whole rupees, no paise in a yard. */
function rupees(value: string | null | undefined): number {
  return Math.round(parseFloat(value || '0'));
}

export function procurementLine(t: TFunction, p?: MemberProcurement): string | null {
  // Nothing until the gate is live: before any procurement is uploaded every member is eligible,
  // so there is no bar to read against and nothing honest to show.
  if (!p || !p.gated) {
    return null;
  }

  let poured: string;
  if (p.amount === null || p.amount === undefined) {
    // Gated but no milk on record — she is not on the latest roll, so the note names the bar she
    // has yet to reach rather than a figure she has poured.
    poured = t('aiFlow.procNoMilk');
  } else {
    poured = t('aiFlow.procPoured', { amount: rupees(p.amount) });
    // Her litres too, when the period carries them — the quantity behind the rupees, as the
    // portal shows it.
    if (p.period?.qty) {
      poured += ` · ${t('aiFlow.procQty', { qty: parseFloat(p.period.qty).toFixed(1) })}`;
    }
  }

  return `${poured} · ${t('aiFlow.procBar', { amount: rupees(p.threshold) })}`;
}
