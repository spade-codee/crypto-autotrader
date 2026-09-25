import { readFile } from 'node:fs/promises';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { periodCandles } from '../backtest/liquidityPeriods.js';
import { runVersion } from '../backtest/liquidityReport.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { aggregate, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../strategy/bars.js';
import { VERSION_0, type SweepEvent } from '../strategy/liquiditySweep.js';
import { structureIsUp } from '../strategy/structure.js';
import { findSwings } from '../strategy/swings.js';
import type { Candle } from '../types.js';

/**
 * Where version 0's setups drop out in the development period, and an
 * independent check that each drop follows the spec.
 *
 * It prints rule outcomes only: counts of first touches, sweeps, setups and
 * their ends. It never prints a price, an R or a profit, so it can be run
 * before or instead of the full evaluation. The check recomputes every first
 * touch, the structure at every sweep, and every armed setup's reference and
 * outcome from aggregate() and findSwings(). It does this batch-wise, apart
 * from the strategy's own step-by-step state, and counts how often the two
 * agree.
 */

type Armed = Extract<SweepEvent, { kind: 'ARMED' }>;

/** The candles split where one is missing: the strategy starts again after a gap, so each part is its own history. */
function segments(candles: Candle[]): Candle[][] {
  const parts: Candle[][] = [[]];
  for (const candle of candles) {
    const current = parts[parts.length - 1]!;
    const last = current[current.length - 1];
    if (last !== undefined && candle.time !== last.time + QUARTER_HOUR_MS) {
      parts.push([candle]);
    } else {
      current.push(candle);
    }
  }
  return parts;
}

/** R3 recomputed in one pass: is the 4-hour structure up at a given close? */
function structureAt(segment: Candle[]): (closeAt: number) => boolean {
  const fours = aggregate(segment, FOUR_HOURS_MS);
  const swings = findSwings(fours, VERSION_0.swingSize, FOUR_HOURS_MS);
  return (closeAt) => {
    const known = swings.filter((s) => s.knownAt <= closeAt);
    const done = fours.filter((f) => f.time + FOUR_HOURS_MS <= closeAt);
    return structureIsUp(
      known.filter((s) => s.kind === 'HIGH').map((s) => s.price),
      known.filter((s) => s.kind === 'LOW').map((s) => s.price),
      done.length === 0 ? null : done[done.length - 1]!.close,
    );
  };
}

async function main(): Promise<void> {
  const all = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  const { candles, evaluateFrom, evaluateTo } = periodCandles(all, 'development', false);
  const run = runVersion(candles, VERSION_0, DEFAULT_COSTS, evaluateFrom);

  const tally = new Map<string, number>();
  for (const event of run.events) {
    const key = 'reason' in event ? `${event.kind} ${event.reason}` : event.kind;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`Development period: ${(evaluateTo - evaluateFrom) / DAY_MS} days`);
  for (const [key, value] of [...tally].sort()) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`  trades: ${run.trades.length}`);

  // First touches and the structure at each sweep, recomputed.
  const touchEvents = new Map(
    run.events.filter((e) => e.kind === 'LEVEL_BROKE' || e.kind === 'ARMED' || e.kind === 'NOT_ARMED').map((e) => [e.time, e]),
  );
  let touches = 0;
  let touchesAgree = 0;
  for (const segment of segments(candles)) {
    const lowByDay = new Map(aggregate(segment, DAY_MS).map((d) => [d.time, d.low]));
    const up = structureAt(segment);
    const seen = new Set<number>();
    for (const candle of segment) {
      const day = candle.time - (candle.time % DAY_MS);
      const level = lowByDay.get(day - DAY_MS);
      if (candle.time < evaluateFrom || level === undefined || seen.has(day) || !candle.low.lt(level)) {
        continue;
      }
      seen.add(day);
      touches += 1;
      const event = touchEvents.get(candle.time);
      const actual = event === undefined ? 'none' : 'reason' in event ? `${event.kind} ${event.reason}` : event.kind;
      const expected = !candle.close.gt(level)
        ? 'LEVEL_BROKE'
        : !up(candle.time + QUARTER_HOUR_MS)
          ? 'NOT_ARMED STRUCTURE_NOT_UP'
          : 'ARMED';
      if (actual === expected || (expected === 'ARMED' && actual.startsWith('NOT_ARMED NO_'))) {
        touchesAgree += 1;
      }
    }
  }
  console.log(`\nFirst touches recomputed: ${touches}; the strategy recorded ${touchEvents.size}; agreeing: ${touchesAgree}`);

  // Every armed setup's reference (R6) and waiting outcome (R7), recomputed.
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const parts = segments(candles);
  const armed = run.events.filter((e): e is Armed => e.kind === 'ARMED');
  let armedAgree = 0;
  for (const setup of armed) {
    const i = index.get(setup.time)!;
    const segment = parts.find((p) => p[0]!.time <= setup.time && setup.time <= p[p.length - 1]!.time)!;
    const highs = findSwings(segment, VERSION_0.swingSize, QUARTER_HOUR_MS).filter(
      (s) => s.kind === 'HIGH' && s.knownAt <= setup.time,
    );
    const reference = [...highs].reverse().find((s) => s.price.gt(candles[i]!.close))?.price;
    const up = structureAt(segment);
    let outcome = 'EXPIRED';
    let at = candles[i + VERSION_0.waitCandles]?.time ?? 0;
    for (let k = 1; k <= VERSION_0.waitCandles; k++) {
      const candle = candles[i + k]!;
      at = candle.time;
      if (candle.low.lt(setup.sweepLow)) {
        outcome = 'SWEEP_LOW_BROKEN';
        break;
      }
      if (!up(candle.time + QUARTER_HOUR_MS)) {
        outcome = 'STRUCTURE_TURNED';
        break;
      }
      if (reference !== undefined && candle.close.gt(reference)) {
        outcome = candle.close.minus(setup.stopTrigger).lt(candle.close.times(VERSION_0.minRiskFraction))
          ? 'STOP_TOO_CLOSE'
          : 'ENTER';
        break;
      }
    }
    const end = run.events.find(
      (e): e is Extract<SweepEvent, { kind: 'ENTER' | 'DISCARDED' }> =>
        e.time === at && (e.kind === 'ENTER' || e.kind === 'DISCARDED'),
    );
    const actual = end === undefined ? 'none' : end.kind === 'ENTER' ? 'ENTER' : end.reason;
    if (actual === outcome && reference !== undefined && reference.eq(setup.reference)) {
      armedAgree += 1;
    }
  }
  console.log(`Armed setups recomputed: ${armed.length}; reference and outcome agreeing: ${armedAgree}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
