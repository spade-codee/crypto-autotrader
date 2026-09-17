import type { FetchCandlesOptions } from './bybit.js';

export type Dataset = {
  symbol: string;
  category: NonNullable<FetchCandlesOptions['category']>;
  file: string;
  purpose: string;
};

export type Asset = 'BTC' | 'ETH';

export type AssetDatasets = {
  /** The spot market, which is what the product trades. */
  spot: Dataset;
  /** The inverse perpetual, whose history starts years before spot. */
  longHistory: Dataset;
};

/**
 * Every dataset comes from Bybit's public API; no credentials are involved.
 *
 * Spot history only begins 2021-07-05, which is too short to choose a
 * parameter on one period and verify it on another, so each asset also has its
 * inverse perpetual as a longer price history. For BTC the perpetual reaches
 * back to 2018-11-14 and tracks spot closely: over the 1,900 days both exist,
 * median daily close divergence is 0.05% and 50/100/200-day moving-average
 * signals agree on 99.84–100% of days (measured 2026-09-17).
 *
 * BTC is the only asset the product trades. ETH exists solely as an
 * out-of-asset check: a strategy tuned on BTC should still behave sensibly on
 * an asset it was never tuned on.
 */
export const ASSETS: Record<Asset, AssetDatasets> = {
  BTC: {
    spot: {
      symbol: 'BTCUSDT',
      category: 'spot',
      file: 'data/BTCUSDT-spot-1d.csv',
      purpose: 'the market the product trades',
    },
    longHistory: {
      symbol: 'BTCUSD',
      category: 'inverse',
      file: 'data/BTCUSD-inverse-1d.csv',
      purpose: 'long price history for research',
    },
  },
  ETH: {
    spot: {
      symbol: 'ETHUSDT',
      category: 'spot',
      file: 'data/ETHUSDT-spot-1d.csv',
      purpose: 'out-of-asset check, spot',
    },
    longHistory: {
      symbol: 'ETHUSD',
      category: 'inverse',
      file: 'data/ETHUSD-inverse-1d.csv',
      purpose: 'out-of-asset check, long history',
    },
  },
};

export const SPOT = ASSETS.BTC.spot;
export const LONG_HISTORY = ASSETS.BTC.longHistory;

export const DATASETS: Dataset[] = Object.values(ASSETS).flatMap((asset) => [
  asset.spot,
  asset.longHistory,
]);

/** Reads ASSET for the research commands. Defaults to BTC, the traded asset. */
export function parseAsset(value: string | undefined): Asset {
  if (value === undefined || value === '') {
    return 'BTC';
  }
  // Object.hasOwn, not `in`: `in` also matches inherited names such as "toString".
  if (Object.hasOwn(ASSETS, value)) {
    return value as Asset;
  }
  throw new Error(`ASSET must be one of ${Object.keys(ASSETS).join(', ')}, not "${value}"`);
}
