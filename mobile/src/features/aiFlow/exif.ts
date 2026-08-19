/**
 * The pin written inside a photograph.
 *
 * Only used for a photo chosen from the gallery. A live capture is pinned by the handset,
 * which is standing in the yard; a chosen one may have been taken an hour ago in a different
 * village, and the handset's current position would then put the insemination — and the
 * money that follows it — in the wrong place. What the camera wrote into the file is the
 * better answer whenever it is there.
 *
 * **Deliberately hard to please.** Every path returns null rather than a guess, because a
 * confident wrong pin is worse than no pin: a missing one falls back to the handset and the
 * record says so, while a mangled one is filed as fact. EXIF from a phone gallery arrives in
 * whatever shape the platform feels like — a signed float on iOS, a rational triplet and a
 * separate hemisphere letter on Android, occasionally a string of a float — so each is
 * handled explicitly and anything else is refused.
 */

/** Where a chosen photograph says it was taken. */
export interface ExifFix {
  lat: number;
  lng: number;
}

/**
 * `26/1,45/1,3096/100` — degrees, minutes and seconds, each as a rational.
 *
 * Android hands the tag over exactly as it sits in the file. Any part that does not divide
 * cleanly into a number takes the whole reading down with it.
 */
function fromRationals(value: string): number | null {
  const parts = value.split(',');
  if (parts.length !== 3) {
    return null;
  }

  let degrees = 0;
  for (let index = 0; index < 3; index += 1) {
    const [top, bottom = '1'] = (parts[index] ?? '').trim().split('/');
    const numerator = Number(top);
    const denominator = Number(bottom);
    if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) {
      return null;
    }
    degrees += numerator / denominator / 60 ** index;
  }
  return degrees;
}

/** A coordinate in any of the shapes the two platforms produce, or null. */
function toDegrees(value: unknown, ref: unknown): number | null {
  let magnitude: number | null = null;

  if (typeof value === 'number' && isFinite(value)) {
    magnitude = value;
  } else if (typeof value === 'string') {
    magnitude = value.includes('/') ? fromRationals(value) : Number(value);
    if (magnitude !== null && !isFinite(magnitude)) {
      return null;
    }
  }

  if (magnitude === null) {
    return null;
  }

  // The hemisphere letter, where there is one. iOS gives a signed number *and* a ref, so the
  // sign is taken off the magnitude first rather than applied twice — a southern pin arriving
  // as -26 with "S" must not come back as 26.
  const hemisphere = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  if (hemisphere === 'S' || hemisphere === 'W') {
    return -Math.abs(magnitude);
  }
  if (hemisphere === 'N' || hemisphere === 'E') {
    return Math.abs(magnitude);
  }
  return magnitude;
}

/** iOS nests the GPS tags; Android leaves them flat. Both are looked at, in that order. */
function gpsBag(exif: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['{GPS}', 'GPS']) {
    const bag = exif[key];
    if (bag && typeof bag === 'object') {
      return bag as Record<string, unknown>;
    }
  }
  return null;
}

export function exifCoords(exif: Record<string, unknown> | null | undefined): ExifFix | null {
  if (!exif) {
    return null;
  }

  const bag = gpsBag(exif);
  const lat = toDegrees(bag?.Latitude ?? exif.GPSLatitude, bag?.LatitudeRef ?? exif.GPSLatitudeRef);
  const lng = toDegrees(
    bag?.Longitude ?? exif.GPSLongitude,
    bag?.LongitudeRef ?? exif.GPSLongitudeRef,
  );

  if (lat === null || lng === null) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  // Null Island. A camera that could not get a fix writes zeroes rather than nothing, and a
  // pin in the Gulf of Guinea against a village in Uttar Pradesh is the one wrong answer that
  // would survive every other check here.
  if (lat === 0 && lng === 0) {
    return null;
  }

  return { lat, lng };
}
