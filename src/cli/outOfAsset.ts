import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { DEFAULT_COSTS, THIN_MARKET_COSTS } from '../backtest/costs.js';
import { runBacktest } from '../backtest/engine.js';
import { formatComparison } from '../backtest/report.js';
import { parseCandleCsv } from '../data/csv.js';
import { ASSETS, parseAsset, type Dataset } from '../data/datasets.js';
import { buyAndHold, CHOSEN_MA_PERIOD, trendFilter } from '../strategy/trendFilter.js';
import type { Candle, CostModel } from '../types.js';

/**
 * Judges the period ALREADY CHOSEN on BTC against buy-and-hold on another
 * asset, over that asset's whole usable history.
 *
 * This is not `sweep`. Nothing here chooses a parameter: re-tuning the period
 * per asset would make every asset look good and prove nothing. An asset
 * passes only if BTC's own setting, unchanged, protects the holder.
 *
 * Usage: ASSET=DOGE npm run out-of-asset
 */

const DAY = 86_400_000;
const CAPITAL = new Decimal(process.env.CAPITAL ?? 1000);
/** Shown for information only — never to pick a winner. See the footer. */
const PERIODS = [20, 30, 50, 75, 100, 125, 150, 175, 200, 225, 250, 300];
const MAX_PERIOD = Math.max(...PERIODS, CHOSEN_MA_PERIOD);

const ASSET = parseAsset(process.env.ASSET);

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

async function load(dataset: Dataset): Promise<Candle[]> {
  return parseCandleCsv(await readFile(dataset.file, 'utf8'));
}

function window(candles: Candle[], warmUpDays: number): { from: number; label: string } {
  const from = candles[0]!.time + warmUpDays * DAY;
  const last = candles[candles.length - 1]!.time;
  if (from >= last) {
    throw new Error(
      `${ASSET} has only ${candles.length} candles — too few to warm up ${warmUpDays} days and still measure anything`,
    );
  }
  return { from, label: `${iso(from)} to ${iso(last)}, warm-up from ${iso(candles[0]!.time)}` };
}

/** BTC's chosen period against buy-and-hold, at one cost assumption. */
function headline(candles: Candle[], costs: CostModel, heading: string): void {
  const { from, label } = window(candles, CHOSEN_MA_PERIOD);
  console.log(`\n--- ${heading} ---`);
  console.log(`${label}\n`);
  console.log(
    formatComparison([
      runBacktest(candles, trendFilter({ maPeriod: CHOSEN_MA_PERIOD }), costs, CAPITAL, `MA-${CHOSEN_MA_PERIOD}`, {
        evaluateFrom: from,
      }),
      runBacktest(candles, buyAndHold, costs, CAPITAL, 'Buy & Hold', { evaluateFrom: from }),
    ]),
  );
}

/**
 * Every period over one window, so the reader can see whether ANY trend filter
 * would have helped this asset. Warm-up covers the longest period so all rows
 * span identical dates.
 */
function allPeriods(candles: Candle[]): void {
  const { from, label } = window(candles, MAX_PERIOD);
  console.log(`\n--- For information only — every period, standard costs ---`);
  console.log(`${label}\n`);
  const results = PERIODS.map((maPeriod) =>
    runBacktest(candles, trendFilter({ maPeriod }), DEFAULT_COSTS, CAPITAL, `MA-${maPeriod}`, {
      evaluateFrom: from,
    }),
  );
  results.push(runBacktest(candles, buyAndHold, DEFAULT_COSTS, CAPITAL, 'Buy & Hold', { evaluateFrom: from }));
  console.log(formatComparison(results));
}

async function main(): Promise<void> {
  const { spot, longHistory } = ASSETS[ASSET];
  const datasets = longHistory === undefined ? [spot] : [longHistory, spot];

  console.log(
    `${ASSET} — judging BTC's MA-${CHOSEN_MA_PERIOD}, unchanged. No parameter is chosen here.`,
  );

  for (const dataset of datasets) {
    const candles = await load(dataset);
    console.log(`\n=== ${dataset.symbol} ${dataset.category} (${dataset.purpose}) ===`);
    headline(candles, DEFAULT_COSTS, `standard costs: ${DEFAULT_COSTS.slippageRate.times(100)}% slippage`);
    headline(candles, THIN_MARKET_COSTS, `thin-market costs: ${THIN_MARKET_COSTS.slippageRate.times(100)}% slippage`);
    allPeriods(candles);
  }

  console.log(
    [
      '',
      'How to read this:',
      '  1. The product promise is a SMALLER MaxDD than buy-and-hold. Judge that',
      '     first; CAGR is secondary.',
      '  2. A drop the filter cannot prevent is a drop the user lives through. Ask',
      '     whether the remaining MaxDD is one a real person would accept, not',
      '     merely whether it beat holding.',
      '  3. If the result survives standard costs but not thin-market costs, it',
      '     depends on fills this market may not give you.',
      '  4. Do NOT pick a period from the information table. It shows whether the',
      '     idea has any grip on this asset. Choosing from it is curve fitting,',
      '     and a period that only works on one asset is noise.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
