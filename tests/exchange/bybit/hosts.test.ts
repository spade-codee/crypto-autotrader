import { describe, expect, it } from 'vitest';
import { bybitHosts } from '../../../src/exchange/bybit/hosts.js';

describe('bybitHosts', () => {
  it('lists mainnet hosts, primary first', () => {
    expect(bybitHosts('mainnet')).toEqual(['https://api.bybit.com', 'https://api.bytick.com']);
  });

  it('lists testnet hosts, primary first', () => {
    expect(bybitHosts('testnet')).toEqual([
      'https://api-testnet.bybit.com',
      'https://api-testnet.bytick.com',
    ]);
  });

  it('returns a copy, so a caller cannot change the list for everyone', () => {
    bybitHosts('mainnet').pop();
    expect(bybitHosts('mainnet')).toHaveLength(2);
  });
});
