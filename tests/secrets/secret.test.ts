import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../src/secrets/secret.js';

const VALUE = 'sk-very-secret-value-123';

describe('Secret', () => {
  it('reveals its value only when asked explicitly', () => {
    expect(new Secret(VALUE).reveal()).toBe(VALUE);
  });

  it('redacts itself in string interpolation and concatenation', () => {
    const secret = new Secret(VALUE);
    expect(`${secret}`).toBe('[redacted]');
    expect(String(secret)).toBe('[redacted]');
    expect('key=' + secret).toBe('key=[redacted]');
  });

  it('redacts itself in JSON', () => {
    const json = JSON.stringify({ apiSecret: new Secret(VALUE) });
    expect(json).toBe('{"apiSecret":"[redacted]"}');
  });

  it('redacts itself when inspected, including when nested', () => {
    const secret = new Secret(VALUE);
    expect(inspect(secret)).not.toContain(VALUE);
    expect(inspect({ nested: { secret } }, { depth: 10 })).not.toContain(VALUE);
    expect(inspect(secret)).toContain('[redacted]');
  });

  it('does not leak through error messages built from it', () => {
    const error = new Error(`request failed for ${new Secret(VALUE)}`);
    expect(error.message).not.toContain(VALUE);
    expect(inspect(error)).not.toContain(VALUE);
  });

  it('exposes no enumerable properties', () => {
    const secret = new Secret(VALUE);
    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify({ ...secret })).toBe('{}');
  });

  it('rejects an empty value', () => {
    expect(() => new Secret('')).toThrow('a secret cannot be empty');
  });
});
