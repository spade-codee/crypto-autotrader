import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { formatComparison } from '../backtest/report.js';
import { parseCandleCsv } from '../data/csv.js';
import { LONG_HISTORY, SPOT, type Dataset } from '../data/datasets.js';
import { buyAndHold, trendFilter } from '../strategy/trendFilter.js';
import type { Candle } from '../types.js';

const DAY = 86_400_000;
const CAPITAL = new Decimal(process.env.CAPITAL ?? 1000);
const SPLIT = new Date(process.env.SPLIT ?? '2023-01-01T00:00:00Z').getTime();
const PERIODS = [20, 30, 50, 75, 100, 125, 150, 175, 200, 225, 250, 300];
const MAX_PERIOD = Math.max(...PERIODS);

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

async function load(dataset: Dataset): Promise<Candle[]> {
  return parseCandleCsv(await readFile(dataset.file, 'utf8'));
}

/**
 * Runs every period plus buy-and-hold over one evaluation window. Every row is
 * measured over identical dates, and every strategy has at least a full period
 * of warm-up history before the window opens.
 */
function sweep(candles: Candle[], evaluateFrom: number, heading: string): void {
  const last = candles[candles.length - 1]!.time;
  console.log(`\n=== ${heading} ===`);
  console.log(`evaluated ${iso(evaluateFrom)} to ${iso(last)}, warm-up from ${iso(candles[0]!.time)}\n`);

  const results = PERIODS.map((period) =>
    runBacktest(candles, trendFilter({ maPeriod: period }), DEFAULT_COSTS, CAPITAL, `MA-${period}`, {
      evaluateFrom,
    }),
  );
  results.push(runBacktest(candles, buyAndHold, DEFAULT_COSTS, CAPITAL, 'Buy & Hold', { evaluateFrom }));

  console.log(formatComparison(results));
}

async function main(): Promise<void> {
  const long = await load(LONG_HISTORY);
  const spot = await load(SPOT);

  // In-sample uses only candles before the split, so nothing after it can leak
  // into the choice. Evaluation starts once the LONGEST period has a full
  // window, so every row covers the same dates.
  const inSample = long.filter((c) => c.time < SPLIT);
  const inSampleFrom = inSample[0]!.time + MAX_PERIOD * DAY;
  if (inSampleFrom >= SPLIT) {
    throw new Error('in-sample window is shorter than the longest period — move SPLIT later');
  }
  if (spot[0]!.time + MAX_PERIOD * DAY > SPLIT) {
    throw new Error('spot data has too little history before SPLIT to warm up the longest period');
  }

  console.log(
    `Costs: ${DEFAULT_COSTS.feeRate.times(100)}% fee, ${DEFAULT_COSTS.slippageRate.times(100)}% slippage, both sides`,
  );

  sweep(inSample, inSampleFrom, `IN-SAMPLE — ${LONG_HISTORY.symbol} ${LONG_HISTORY.category} (choose the period here)`);
  sweep(long, SPLIT, `OUT-OF-SAMPLE — ${LONG_HISTORY.symbol} ${LONG_HISTORY.category} (verify it here — do NOT choose here)`);
  sweep(spot, SPLIT, `OUT-OF-SAMPLE — ${SPOT.symbol} ${SPOT.category} (same window on the traded market)`);

  console.log(
    [
      '',
      'How to read this:',
      '  1. In the IN-SAMPLE table, look for a BROAD PLATEAU of periods that all',
      '     work, not a single period that spikes. A lone spike is curve fitting;',
      '     a plateau suggests the effect is real.',
      '  2. Take the middle of that plateau as the chosen period.',
      '  3. Check that period in the OUT-OF-SAMPLE tables. If it collapses there,',
      '     the strategy does not generalise, whatever the first table said.',
      '  4. Compare against Buy & Hold in EVERY table. Lower max drawdown is the',
      '     product promise; matching or beating CAGR is a bonus, not the point.',
      '  5. The two out-of-sample tables should broadly agree. If they do not, the',
      '     long-history proxy is not standing in for spot as well as assumed.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
