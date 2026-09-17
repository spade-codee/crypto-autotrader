import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { DEFAULT_COSTS, buyFillPrice, sellFillPrice, feeOn } from '../../src/backtest/costs.js';

const d = (n: string | number) => new Decimal(n);

describe('DEFAULT_COSTS', () => {
  it('uses Bybit spot taker fee of 0.1% and 0.05% slippage', () => {
    expect(DEFAULT_COSTS.feeRate.toString()).toBe('0.001');
    expect(DEFAULT_COSTS.slippageRate.toString()).toBe('0.0005');
  });
});

describe('buyFillPrice', () => {
  it('pays worse than the quoted price', () => {
    // 100 * (1 + 0.0005) = 100.05
    expect(buyFillPrice(d(100), DEFAULT_COSTS).toString()).toBe('100.05');
  });
});

describe('sellFillPrice', () => {
  it('receives worse than the quoted price', () => {
    // 100 * (1 - 0.0005) = 99.95
    expect(sellFillPrice(d(100), DEFAULT_COSTS).toString()).toBe('99.95');
  });
});

describe('feeOn', () => {
  it('charges the fee rate against notional', () => {
    // 1000 * 0.001 = 1
    expect(feeOn(d(1000), DEFAULT_COSTS).toString()).toBe('1');
  });

  it('is zero when the fee rate is zero', () => {
    const free = { feeRate: d(0), slippageRate: d(0) };
    expect(feeOn(d(1000), free).toString()).toBe('0');
  });
});
