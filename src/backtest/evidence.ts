import Decimal from 'decimal.js';
import { mean } from '../math.js';
import type { LiquiditySweepConfig } from '../strategy/liquiditySweep.js';
import type { Candle, CostModel } from '../types.js';
import { netR, simulateExit } from './bracket.js';

const ONE = new Decimal(1);

/** Spec 6.4: fixed before any data, and printed in every report. */
export const BOOTSTRAP_SEED = 20260924;
export const PLACEBO_SEED = 20260925;
export const BOOTSTRAP_RESAMPLES = 10_000;
export const PLACEBO_SETS = 1_000;

/**
 * A seeded pseudo-random generator, mulberry32: the same seed always gives the
 * same draws, so every result can be reproduced exactly.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The nearest-rank percentile of sorted values. */
export function percentile(sorted: Decimal[], fraction: number): Decimal {
  if (sorted.length === 0) {
    throw new Error('percentile needs at least one value');
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/** The UTC calendar month of a moment, as YYYY-MM. */
export function monthOf(time: number): string {
  return new Date(time).toISOString().slice(0, 7);
}

/** Every UTC calendar month that a period from `from` up to, not including, `to` touches. */
export function monthsBetween(from: number, to: number): string[] {
  const first = new Date(from);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const months: string[] = [];
  while (Date.UTC(year, month, 1) < to) {
    months.push(monthOf(Date.UTC(year, month, 1)));
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

export type Interval = { low: Decimal; high: Decimal };

/**
 * Spec 6.4: an interval for mean R from bootstrap resamples of whole calendar
 * months. Each resample draws as many months as the period has, with
 * replacement, and takes the mean R of every trade in them; a resample with no
 * trade is drawn again. Months that bunch trades together are therefore not
 * treated as independent draws.
 */
export function monthBlockInterval(
  trades: Array<{ month: string; r: Decimal }>,
  months: string[],
  resamples: number,
  level: number,
  seed: number,
): Interval | null {
  if (trades.length === 0 || months.length === 0) {
    return null;
  }
  const byMonth = new Map<string, Decimal[]>(months.map((month) => [month, []]));
  for (const trade of trades) {
    const list = byMonth.get(trade.month);
    if (list === undefined) {
      throw new Error(`a trade in ${trade.month} is outside the period`);
    }
    list.push(trade.r);
  }
  const blocks = months.map((month) => byMonth.get(month)!);
  const random = seededRandom(seed);
  const means: Decimal[] = [];
  while (means.length < resamples) {
    let total = new Decimal(0);
    let count = 0;
    for (let k = 0; k < blocks.length; k++) {
      const block = blocks[Math.floor(random() * blocks.length)]!;
      for (const r of block) {
        total = total.plus(r);
      }
      count += block.length;
    }
    if (count > 0) {
      means.push(total.div(count));
    }
  }
  means.sort((a, b) => a.comparedTo(b));
  const tail = (1 - level) / 2;
  return { low: percentile(means, tail), high: percentile(means, 1 - tail) };
}

/**
 * One placebo trade: entered at candles[index]'s open with its stop `share` of
 * that open below it, the version's target and time limit, and the same costs
 * and exits as a real trade. Measured in its own planned risk: the open's
 * distance to its stop.
 */
export function placeboR(
  candles: Candle[],
  index: number,
  share: Decimal,
  config: LiquiditySweepConfig,
  costs: CostModel,
): Decimal {
  const open = candles[index]!.open;
  const plannedRisk = open.times(share);
  const stopTrigger = open.minus(plannedRisk);
  const entryPrice = open.times(ONE.plus(costs.slippageRate));
  const target = entryPrice.plus(config.targetMultiple.times(entryPrice.minus(stopTrigger)));
  const exit = simulateExit(candles, index, stopTrigger, target, config.timeLimitCandles, costs);
  return netR(entryPrice, exit.price, costs.feeRate, plannedRisk);
}

export type PlaceboResult = {
  /** Mean R of each placebo set, sorted. */
  means: Decimal[];
  median: Decimal;
  p95: Decimal;
  real: Decimal;
  /** The share of placebo means below the real mean. */
  rankOfReal: number;
};

export type PlaceboSource = { entryTime: number; plannedRisk: Decimal; confirmationClose: Decimal; r: Decimal };

/**
 * Spec 6.4: for each real trade, a random eligible entry in the same calendar
 * month, with the real trade's stop distance as a share of price. `entries`
 * holds the candles at whose open a real entry could have been decided. One set
 * per draw of as many trades as the real run; `sets` of them.
 */
export function placebo(
  candles: Candle[],
  entries: number[],
  trades: PlaceboSource[],
  config: LiquiditySweepConfig,
  costs: CostModel,
  sets: number,
  seed: number,
): PlaceboResult | null {
  if (trades.length === 0) {
    return null;
  }
  const pools = new Map<string, number[]>();
  for (const index of entries) {
    const month = monthOf(candles[index]!.time);
    const pool = pools.get(month);
    if (pool === undefined) {
      pools.set(month, [index]);
    } else {
      pool.push(index);
    }
  }
  const draws = trades.map((trade) => {
    const pool = pools.get(monthOf(trade.entryTime));
    if (pool === undefined || pool.length === 0) {
      throw new Error(`no placebo entry in ${monthOf(trade.entryTime)}, where a real trade entered`);
    }
    return { pool, share: trade.plannedRisk.div(trade.confirmationClose) };
  });
  const random = seededRandom(seed);
  const means: Decimal[] = [];
  for (let s = 0; s < sets; s++) {
    let total = new Decimal(0);
    for (const draw of draws) {
      const index = draw.pool[Math.floor(random() * draw.pool.length)]!;
      total = total.plus(placeboR(candles, index, draw.share, config, costs));
    }
    means.push(total.div(draws.length));
  }
  means.sort((a, b) => a.comparedTo(b));
  const real = mean(trades.map((trade) => trade.r));
  return {
    means,
    median: percentile(means, 0.5),
    p95: percentile(means, 0.95),
    real,
    rankOfReal: means.filter((m) => m.lt(real)).length / means.length,
  };
}
