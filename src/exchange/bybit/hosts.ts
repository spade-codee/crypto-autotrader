import type { Environment } from '../environment.js';

/**
 * Bybit API hosts, primary first. On Nigerian networks the bybit.com hosts fail
 * DNS resolution under the NCC's February 2024 block, while Bybit's official
 * alternate bytick.com hosts answer (verified 2026-09-17). Requests fall back in
 * this order.
 */
const HOSTS: Record<Environment, readonly string[]> = {
  mainnet: ['https://api.bybit.com', 'https://api.bytick.com'],
  testnet: ['https://api-testnet.bybit.com', 'https://api-testnet.bytick.com'],
};

export function bybitHosts(environment: Environment): string[] {
  return [...HOSTS[environment]];
}
