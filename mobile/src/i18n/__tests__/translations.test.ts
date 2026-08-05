/**
 * Translation parity (SRS §7 Usability).
 *
 * The app defaults to Hindi for a semi-literate field user base. A key present in English
 * but missing in Hindi renders as the raw key path on screen — which is worse than English
 * would have been, and only shows up in front of the user.
 */

import i18n from '../index';
import en from '../en.json';
import hi from '../hi.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('translations', () => {
  const enKeys = flatten(en).sort();

  it('defaults to Hindi', () => {
    // The field user base is semi-literate and Hindi-speaking. Defaulting to English would
    // put every Mait one settings screen away from being able to use the app at all.
    expect(i18n.language).toBe('hi');
  });

  const hiKeys = flatten(hi).sort();

  it('has the same keys in both languages', () => {
    expect(hiKeys).toEqual(enKeys);
  });

  it('leaves no Hindi string empty', () => {
    const empty = flatten(hi).filter(path => {
      const value = path
        .split('.')
        .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], hi);
      return typeof value === 'string' && value.trim() === '';
    });
    expect(empty).toEqual([]);
  });

  it('resolves plural forms rather than returning the key', () => {
    // Hermes has no Intl.PluralRules, so i18next falls back to its v3 plural format and
    // these v4 `_one` / `_other` keys stop resolving — on a device only, never in Node.
    // The polyfill imported by src/i18n fixes that; this asserts it is actually in place.
    for (const count of [1, 2, 5]) {
      const text = i18n.t('auth.wrongCodeBody', { count });
      expect(text).not.toContain('wrongCodeBody');
      expect(text.length).toBeGreaterThan(0);
    }
    // Singular and plural must actually differ, or the plural machinery is not running.
    expect(i18n.t('auth.wrongCodeBody', { count: 1 })).not.toBe(
      i18n.t('auth.wrongCodeBody', { count: 2 }),
    );
  });

  it('interpolates the count into the plural string', () => {
    expect(i18n.t('auth.wrongCodeBody', { count: 2 })).toContain('2');
  });

  it('keeps interpolation placeholders identical across languages', () => {
    // A placeholder dropped in translation silently renders nothing where a number should
    // be — "Step of 6" instead of "Step 3 of 6".
    const placeholders = (text: string) => (text.match(/\{\{(\w+)\}\}/g) ?? []).sort();

    const mismatched = enKeys.filter(path => {
      const read = (source: unknown) =>
        path
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], source);
      const enValue = read(en);
      const hiValue = read(hi);
      if (typeof enValue !== 'string' || typeof hiValue !== 'string') {
        return false;
      }
      return JSON.stringify(placeholders(enValue)) !== JSON.stringify(placeholders(hiValue));
    });

    expect(mismatched).toEqual([]);
  });
});
