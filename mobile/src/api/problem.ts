/**
 * Turning a refusal into something the Mait can see.
 *
 * The API answers a bad write with RFC 7807 problem details: a `detail` sentence and, for a
 * validation failure, an `errors` map keyed by field. A form renders the keys it has boxes
 * for — `mobile_no` under the mobile field, `ear_tag_no` under the tag.
 *
 * **The keys it has no box for are the whole reason this file exists.** A screen that dropped
 * them showed the Mait nothing at all: they tapped the button, the spinner turned over, and
 * the screen sat exactly as it was. That is what a duplicate registration looked like — the
 * server refused it with `non_field_errors`, no field on the form owned that key, and the tap
 * became a no-op with no way to tell it from a dead button.
 *
 * So every rejection is split in two here, and what the form cannot place, it must say.
 */

import type { ProblemDetails } from './types';

export interface Rejection {
  /** Errors the form can render against its own boxes. */
  fields: Record<string, string[]>;
  /**
   * One sentence for everything the form cannot place, or null when it can place all of it.
   *
   * Never empty when the write failed: a caller that shows this whenever it is set can never
   * leave a refusal invisible.
   */
  message: string | null;
}

/**
 * Split a failed mutation into what the form can show inline and what it must announce.
 *
 * `owned` is the set of keys the calling screen actually renders. Anything outside it — a
 * `non_field_errors`, a field the form does not collect, a plain `detail` with no map at all,
 * or a network failure with no body — comes back as `message`.
 *
 * `fallback` is used when the server said nothing usable, so the return is never silent.
 */
export function splitRejection(err: unknown, owned: string[], fallback: string): Rejection {
  const problem = (err as { data?: ProblemDetails })?.data;
  const errors = problem?.errors;

  if (!errors) {
    // No map: either a plain problem detail, or something that never reached the server.
    return { fields: {}, message: problem?.detail || fallback };
  }

  const fields: Record<string, string[]> = {};
  const orphans: string[] = [];

  for (const [key, messages] of Object.entries(errors)) {
    const lines = (messages ?? []).filter(Boolean);
    if (lines.length === 0) {
      continue;
    }
    if (owned.includes(key)) {
      fields[key] = lines;
    } else {
      orphans.push(...lines);
    }
  }

  // A map that placed everything needs no announcement; one that placed nothing still gets a
  // sentence, because the alternative is a button that does nothing.
  const placed = Object.keys(fields).length > 0;
  const message = orphans.length > 0 ? orphans.join(' ') : placed ? null : fallback;

  return { fields, message };
}
