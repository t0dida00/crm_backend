import { canEncrypt, CredentialsKeyError, decrypt, encrypt } from '../../src/lib/crypto';

const KEY = 'a'.repeat(64);

describe('crypto', () => {
  const original = process.env.CREDENTIALS_KEY;
  beforeEach(() => {
    process.env.CREDENTIALS_KEY = KEY;
  });
  afterAll(() => {
    process.env.CREDENTIALS_KEY = original;
  });

  it('round-trips a secret without leaving it readable', () => {
    const secret = 'postgresql://user:p4ss@db.example.com:5432/app?sslmode=require';
    const stored = encrypt(secret);
    expect(stored).not.toContain('p4ss');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(decrypt(stored)).toBe(secret);
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects a tampered value', () => {
    const [v, iv, tag, body] = encrypt('secret').split(':');
    const flipped = Buffer.from(body, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('rejects a value encrypted with another key', () => {
    const stored = encrypt('secret');
    process.env.CREDENTIALS_KEY = 'b'.repeat(64);
    expect(() => decrypt(stored)).toThrow();
  });

  it('requires a 32-byte hex key', () => {
    process.env.CREDENTIALS_KEY = 'too-short';
    expect(canEncrypt()).toBe(false);
    expect(() => encrypt('x')).toThrow(CredentialsKeyError);
    delete process.env.CREDENTIALS_KEY;
    expect(canEncrypt()).toBe(false);
  });
});
