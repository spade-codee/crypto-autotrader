import { describe, expect, it } from 'vitest';
import { explainError } from '../../src/cli/guidance.js';
import { BybitApiError } from '../../src/exchange/bybit/client.js';
import { VaultDecryptionError } from '../../src/vault/crypto.js';

describe('explainError', () => {
  it('turns a known Bybit code into an instruction', () => {
    expect(explainError(new BybitApiError(10004, 'error sign!'))).toContain(
      'The API secret does not match this key',
    );
  });

  it('shows the code and message for an unknown Bybit code', () => {
    expect(explainError(new BybitApiError(99999, 'something new'))).toBe(
      'Bybit returned error 99999: something new',
    );
  });

  it('explains a vault that cannot be decrypted', () => {
    expect(explainError(new VaultDecryptionError())).toContain('original master key');
  });

  it('falls back to the error message', () => {
    expect(explainError(new Error('plain failure'))).toBe('plain failure');
  });
});
