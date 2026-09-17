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

  it('fetches every dataset, each to its own file', () => {
    const files = DATASETS.map((dataset) => dataset.file);
    expect(files).toHaveLength(4);
    expect(new Set(files).size).toBe(4);
  });
});

describe('parseAsset', () => {
  it('defaults to BTC', () => {
    expect(parseAsset(undefined)).toBe('BTC');
    expect(parseAsset('')).toBe('BTC');
  });

  it('accepts ETH', () => {
    expect(parseAsset('ETH')).toBe('ETH');
  });

  it('rejects anything else', () => {
    expect(() => parseAsset('SOL')).toThrow('ASSET must be one of BTC, ETH, not "SOL"');
  });

  it('rejects property names every object inherits', () => {
    expect(() => parseAsset('toString')).toThrow('ASSET must be one of BTC, ETH');
    expect(() => parseAsset('constructor')).toThrow('ASSET must be one of BTC, ETH');
  });
});
