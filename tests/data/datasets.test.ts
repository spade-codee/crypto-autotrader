import { describe, expect, it } from 'vitest';
import { ASSETS, DATASETS, LONG_HISTORY, parseAsset, SPOT } from '../../src/data/datasets.js';

describe('datasets', () => {
  it('keeps BTC as the traded market', () => {
    expect(SPOT).toBe(ASSETS.BTC.spot);
    expect(LONG_HISTORY).toBe(ASSETS.BTC.longHistory);
    expect(SPOT).toMatchObject({ symbol: 'BTCUSDT', category: 'spot' });
  });

  it('has spot and long-history data for ETH', () => {
    expect(ASSETS.ETH.spot).toMatchObject({ symbol: 'ETHUSDT', category: 'spot' });
    expect(ASSETS.ETH.longHistory).toMatchObject({ symbol: 'ETHUSD', category: 'inverse' });
  });

  it('gives DOGE its linear perpetual, whose history starts before spot', () => {
    // The DOGEUSD inverse perpetual only begins 2025-03-05, too late to be useful.
    expect(ASSETS.DOGE.longHistory).toMatchObject({ symbol: 'DOGEUSDT', category: 'linear' });
    expect(ASSETS.DOGE.spot).toMatchObject({ symbol: 'DOGEUSDT', category: 'spot' });
  });

  it('separates datasets that share a symbol but not a market', () => {
    expect(ASSETS.DOGE.longHistory?.file).not.toBe(ASSETS.DOGE.spot.file);
  });

  it('leaves out a long history where no contract provides one', () => {
    expect(ASSETS.SHIB.longHistory).toBeUndefined();
    expect(ASSETS.PEPE.longHistory).toBeUndefined();
  });

  it('fetches every dataset, each to its own file', () => {
    const files = DATASETS.map((dataset) => dataset.file);
    expect(files).toHaveLength(8);
    expect(new Set(files).size).toBe(8);
  });

  it('includes the spot market of every asset', () => {
    for (const asset of Object.values(ASSETS)) {
      expect(DATASETS).toContain(asset.spot);
    }
  });
});

describe('parseAsset', () => {
  it('defaults to BTC', () => {
    expect(parseAsset(undefined)).toBe('BTC');
    expect(parseAsset('')).toBe('BTC');
  });

  it('accepts every asset in the table', () => {
    for (const asset of Object.keys(ASSETS)) {
      expect(parseAsset(asset)).toBe(asset);
    }
  });

  it('rejects anything else', () => {
    expect(() => parseAsset('SOL')).toThrow(
      'ASSET must be one of BTC, ETH, DOGE, SHIB, PEPE, not "SOL"',
    );
  });

  it('rejects property names every object inherits', () => {
    expect(() => parseAsset('toString')).toThrow('ASSET must be one of');
    expect(() => parseAsset('constructor')).toThrow('ASSET must be one of');
  });
});
