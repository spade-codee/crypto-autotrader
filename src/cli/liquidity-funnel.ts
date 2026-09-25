import { readFile } from 'node:fs/promises';
import type Decimal from 'decimal.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { periodCandles } from '../backtest/liquidityPeriods.js';
import { runVersion } from '../backtest/liquidityReport.js';
import { resolveVersion } from '../backtest/liquidityVersions.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { aggregate, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../strategy/bars.js';
import type { LiquiditySweepConfig, SweepEvent } from '../strategy/liquiditySweep.js';
import { structureIsUp } from '../strategy/structure.js';
import { findSwings } from '../strategy/swings.js';
import type { Candle } from '../types.js';

/**
 * Where a version's setups drop out in the development period, and an
 * independent check that each step follows the spec. --version and --step pick
 * the version, as for the research command.
 *
 * It prints rule outcomes only: counts of sweep candidates, setups and their
 * ends. It never prints a price, an R or a profit, so it can be run before or
 * instead of the full evaluation. The check recomputes, batch-wise from
 * aggregate() and findSwings() rather than the strategy's step-by-step state:
 * - every day's sweep candidate, and the verdict at each (R3 to R6), under the
 *   version's sweep, structure and confirmation settings;
 * - every armed setup's reference and waiting outcome (R6, R7).
 * It then counts how often the two agree. Whether a trade was open, or a setup
 * still waiting, when a candidate came is read from the run itself.
 */

type Armed = Extract<SweepEvent, { kind: 'ARMED' }>;
type End = Extract<SweepEvent, { kind: 'ENTER' | 'DISCARDED' }>;

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

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
function structureAt(segment: Candle[], config: LiquiditySweepConfig): (closeAt: number) => boolean {
  const fours = aggregate(segment, FOUR_HOURS_MS);
  const swings = findSwings(fours, config.swingSize, FOUR_HOURS_MS);
  return (closeAt) => {
    const known = swings.filter((s) => s.knownAt <= closeAt);
    const done = fours.filter((f) => f.time + FOUR_HOURS_MS <= closeAt);
    return structureIsUp(
      known.filter((s) => s.kind === 'HIGH').map((s) => s.price),
      known.filter((s) => s.kind === 'LOW').map((s) => s.price),
      done.length === 0 ? null : done[done.length - 1]!.close,
      config.structure,
    );
  };
}

/** R6 recomputed: the reference a sweep at `index` would take, or undefined when there is none. */
function referenceFor(segment: Candle[], sweep: Candle, config: LiquiditySweepConfig): Decimal | undefined {
  if (config.confirmation === 'SWEEP_HIGH') {
    return sweep.high;
  }
  const highs = findSwings(segment, config.swingSize, QUARTER_HOUR_MS).filter(
    (s) => s.kind === 'HIGH' && s.knownAt <= sweep.time,
  );
  return [...highs].reverse().find((s) => s.price.gt(sweep.close))?.price;
}

const label = (event: SweepEvent): string => ('reason' in event ? `${event.kind} ${event.reason}` : event.kind);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const version = resolveVersion(flag(argv, '--version'), flag(argv, '--step'), true);
  const { config } = version;
  const all = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  const { candles, evaluateFrom, evaluateTo } = periodCandles(all, 'development', false);
  const run = runVersion(candles, config, DEFAULT_COSTS, evaluateFrom);

  const tally = new Map<string, number>();
  for (const event of run.events) {
    tally.set(label(event), (tally.get(label(event)) ?? 0) + 1);
  }
  console.log(`Liquidity sweep ${version.name}, development period: ${(evaluateTo - evaluateFrom) / DAY_MS} days`);
  for (const [key, value] of [...tally].sort()) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`  trades: ${run.trades.length}`);

  // What the run itself says about the account at each candle's open.
  const index = new Map(candles.map((c, i) => [c.time, i]));
  const notFlat = new Set<number>();
  for (const trade of run.trades) {
    const heldAtLastOpen = trade.exit.reason === 'STOP' || trade.exit.reason === 'TARGET' || trade.exit.reason === 'END';
    for (let i = trade.entryIndex; i < trade.exit.index + (heldAtLastOpen ? 1 : 0); i++) {
      notFlat.add(i);
    }
  }
  const ends = run.events.filter((e): e is End => e.kind === 'ENTER' || e.kind === 'DISCARDED');
  const restarts = run.events.filter((e) => e.kind === 'RESTARTED').map((e) => e.time);
  const armed = run.events.filter((e): e is Armed => e.kind === 'ARMED');
  const waitingAt = (time: number) =>
    armed.some((a) => {
      if (a.time >= time) {
        return false;
      }
      const end = ends.find((e) => e.time > a.time)?.time ?? Infinity;
      const restart = restarts.find((r) => r > a.time) ?? Infinity;
      return time <= end && time < restart;
    });

  // Every day's sweep candidate, and each break recorded before it, recomputed.
  const candidateEvents = new Map(
    run.events.filter((e) => e.kind === 'LEVEL_BROKE' || e.kind === 'ARMED' || e.kind === 'NOT_ARMED').map((e) => [e.time, e]),
  );
  const firstTouch = config.sweep === 'FIRST_TOUCH';
  let expected = 0;
  let agreeing = 0;
  for (const segment of segments(candles)) {
    const lowByDay = new Map(aggregate(segment, DAY_MS).map((d) => [d.time, d.low]));
    const up = structureAt(segment, config);
    const done = new Set<number>();
    const broke = new Set<number>();
    for (const candle of segment) {
      const day = candle.time - (candle.time % DAY_MS);
      const level = lowByDay.get(day - DAY_MS);
      if (candle.time < evaluateFrom || level === undefined || done.has(day) || !candle.low.lt(level)) {
        continue;
      }
      if (!firstTouch && candle.open.lt(level)) {
        continue;
      }
      let want: string | null;
      if (candle.close.lte(level)) {
        want = firstTouch || !broke.has(day) ? 'LEVEL_BROKE' : null;
        broke.add(day);
        if (firstTouch) {
          done.add(day);
        }
      } else {
        done.add(day);
        const i = index.get(candle.time)!;
        want = notFlat.has(i)
          ? 'NOT_ARMED NOT_FLAT'
          : waitingAt(candle.time)
            ? 'NOT_ARMED SETUP_WAITING'
            : !up(candle.time + QUARTER_HOUR_MS)
              ? 'NOT_ARMED STRUCTURE_NOT_UP'
              : referenceFor(segment, candle, config) === undefined
                ? 'NOT_ARMED NO_REFERENCE'
                : 'ARMED';
      }
      if (want === null) {
        continue;
      }
      expected += 1;
      const event = candidateEvents.get(candle.time);
      if (event !== undefined && label(event) === want) {
        agreeing += 1;
      }
    }
  }
  console.log(`\nCandidates and breaks recomputed: ${expected}; the strategy recorded ${candidateEvents.size}; agreeing: ${agreeing}`);

  // Every armed setup's reference (R6) and waiting outcome (R7), recomputed.
  const parts = segments(candles);
  let armedAgree = 0;
  for (const setup of armed) {
    const i = index.get(setup.time)!;
    const segment = parts.find((p) => p[0]!.time <= setup.time && setup.time <= p[p.length - 1]!.time)!;
    const reference = referenceFor(segment, candles[i]!, config);
    const up = structureAt(segment, config);
    let outcome = 'EXPIRED';
    let at = 0;
    for (let k = 1; k <= config.waitCandles; k++) {
      const candle = candles[i + k];
      if (candle === undefined || candle.time !== candles[i + k - 1]!.time + QUARTER_HOUR_MS) {
        outcome = 'RESTARTED';
        break;
      }
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
        outcome = candle.close.minus(setup.stopTrigger).lt(candle.close.times(config.minRiskFraction))
          ? 'STOP_TOO_CLOSE'
          : 'ENTER';
        break;
      }
    }
    const end = ends.find((e) => e.time > setup.time);
    const actual =
      outcome === 'RESTARTED'
        ? end === undefined || end.time > at + QUARTER_HOUR_MS * config.waitCandles
          ? 'RESTARTED'
          : 'ended'
        : end === undefined || end.time !== at
          ? 'none'
          : end.kind === 'ENTER'
            ? 'ENTER'
            : end.reason;
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
