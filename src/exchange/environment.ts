export type Environment = 'testnet' | 'mainnet';

/** Reads BYBIT_ENV. Unset means testnet: real money always requires saying so. */
export function parseEnvironment(value: string | undefined): Environment {
  if (value === undefined || value === '' || value === 'testnet') {
    return 'testnet';
  }
  if (value === 'mainnet') {
    return 'mainnet';
  }
  throw new Error(`BYBIT_ENV must be "testnet" or "mainnet", not "${value}"`);
}
