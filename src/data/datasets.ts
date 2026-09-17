import type { FetchCandlesOptions } from './bybit.js';

export type Dataset = {
  symbol: string;
  category: NonNullable<FetchCandlesOptions['category']>;
  file: string;
  purpose: string;
};

/**
 * Both datasets come from Bybit's public API; no credentials are involved.
 *
 * Spot history only begins 2021-07-05, which is too short to choose a
 * parameter on one period and verify it on another. The inverse BTCUSD
 * perpetual reaches back to 2018-11-14 and tracks spot closely: over the 1,900
 * days both exist, median daily close divergence is 0.05% and 50/100/200-day
 * moving-average signals agree on 99.84–100% of days (measured 2026-09-17).
 */
export const SPOT: Dataset = {
  symbol: 'BTCUSDT',
  category: 'spot',
  file: 'data/BTCUSDT-spot-1d.csv',
  purpose: 'the market the product trades',
};

export const LONG_HISTORY: Dataset = {
  symbol: 'BTCUSD',
  category: 'inverse',
  file: 'data/BTCUSD-inverse-1d.csv',
  purpose: 'long price history for research',
};

export const DATASETS: Dataset[] = [SPOT, LONG_HISTORY];
