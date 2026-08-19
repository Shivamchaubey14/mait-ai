/**
 * The pin written inside a chosen photograph.
 *
 * This is the one piece of the gallery path that can be wrong without anybody noticing. A
 * missing pin is visible — the app falls back to the handset and says so on the screen and on
 * the record. A *mangled* one is filed as fact: an event billed to the wrong village, with a
 * coordinate nobody will ever re-check.
 *
 * So the rule under test is not "does it parse" but "does it refuse". Every shape it cannot
 * read with confidence must come back null, and the hemisphere must survive, because 26° N and
 * 26° S are two thousand miles apart and both look like a plausible number.
 */

import { exifCoords } from '../exif';

describe('exifCoords', () => {
  it('reads the rational triplets Android hands over', () => {
    const fix = exifCoords({
      GPSLatitude: '26/1,45/1,3096/100',
      GPSLatitudeRef: 'N',
      GPSLongitude: '82/1,8/1,2700/100',
      GPSLongitudeRef: 'E',
    });

    expect(fix?.lat).toBeCloseTo(26.7586, 3);
    expect(fix?.lng).toBeCloseTo(82.1408, 3);
  });

  it('reads the nested dictionary iOS hands over', () => {
    const fix = exifCoords({
      '{GPS}': { Latitude: 26.7524, LatitudeRef: 'N', Longitude: 82.1408, LongitudeRef: 'E' },
    });

    expect(fix).toEqual({ lat: 26.7524, lng: 82.1408 });
  });

  it('keeps the hemisphere', () => {
    const fix = exifCoords({
      GPSLatitude: 33.8688,
      GPSLatitudeRef: 'S',
      GPSLongitude: 151.2093,
      GPSLongitudeRef: 'W',
    });

    expect(fix).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it('does not negate a number that is already negative', () => {
    // iOS gives a signed value *and* a ref. Applying the ref twice would move a southern pin
    // into the northern hemisphere, which is the failure that looks most like a success.
    expect(
      exifCoords({
        '{GPS}': { Latitude: -33.8, LatitudeRef: 'S', Longitude: -70.6, LongitudeRef: 'W' },
      }),
    ).toEqual({ lat: -33.8, lng: -70.6 });
  });

  it('refuses a photograph with no GPS at all', () => {
    expect(exifCoords({ DateTimeOriginal: '2026:08:18 10:43:12' })).toBeNull();
    expect(exifCoords(null)).toBeNull();
    expect(exifCoords({})).toBeNull();
  });

  it('refuses half a fix', () => {
    expect(exifCoords({ GPSLatitude: 26.75, GPSLatitudeRef: 'N' })).toBeNull();
  });

  it('refuses nonsense rather than turning it into a coordinate', () => {
    expect(exifCoords({ GPSLatitude: 'north-ish', GPSLongitude: '82' })).toBeNull();
    expect(exifCoords({ GPSLatitude: '26/1,45/1', GPSLongitude: '82/1,8/1,27/1' })).toBeNull();
    expect(exifCoords({ GPSLatitude: '26/0,45/1,27/1', GPSLongitude: '82/1,8/1,27/1' })).toBeNull();
  });

  it('refuses a coordinate that is off the planet', () => {
    expect(exifCoords({ GPSLatitude: 118.4, GPSLongitude: 82.14 })).toBeNull();
    expect(exifCoords({ GPSLatitude: 26.75, GPSLongitude: 210.9 })).toBeNull();
  });

  it('refuses Null Island', () => {
    // What a camera writes when it never got a fix. It is a valid coordinate in the Gulf of
    // Guinea, which is why it survives every other check and has to be named here.
    expect(exifCoords({ GPSLatitude: 0, GPSLongitude: 0 })).toBeNull();
  });
});
