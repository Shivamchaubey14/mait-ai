/**
 * The no-signal office code, worked out on the phone (`api/fieldCode`).
 *
 * The one thing that matters is agreement with the server: a phone that works out a different
 * six digits refuses the code the office read out. So the value here is the one pinned in
 * backend/apps/accounts/tests/test_field_codes.py, from the same key and the same number.
 */

import { fieldCode, fromBase64, hmacSha256, localDay, sha256 } from '../fieldCode';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const ascii = (text: string) => Uint8Array.from(text, ch => ch.charCodeAt(0));

// The server's key for Mait 42 on 2026-10-28 under the test's pinned secret.
const PINNED_KEY = '87CnkMDiNKEokx5ABXzZIvrnr8cp57KjwtJN5lDvTSQ=';

describe('the hash underneath', () => {
  it('is SHA-256', () => {
    expect(hex(sha256(ascii('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256(ascii('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is HMAC-SHA256 (RFC 4231, case 2)', () => {
    expect(hex(hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('reads the key the way the server wrote it', () => {
    expect(fromBase64(PINNED_KEY)).toHaveLength(32);
  });
});

describe('the code', () => {
  it('is the one the server gives for the same key and number', () => {
    expect(fieldCode(PINNED_KEY, '9811100001')).toBe('679261');
  });

  it('does not care how her number was written down', () => {
    expect(fieldCode(PINNED_KEY, '+91 98111 00001')).toBe('679261');
  });

  it('is a different code for a different farmer', () => {
    expect(fieldCode(PINNED_KEY, '9811100002')).not.toBe('679261');
  });
});

it('names the day the way the keys are named', () => {
  expect(localDay(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
});
