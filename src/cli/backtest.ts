import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { formatComparison } from '../backtest/report.js';
import { parseCandleCsv } from '../data/csv.js';
import { LONG_HISTORY, SPOT } from '../data/datasets.js';
import { buyAndHold, trendFilter } from '../strategy/trendFilter.js';

const DAY = 86_400_000;
const MA_PERIOD = Number(process.env.MA_PERIOD ?? 200);
const CAPITAL = new Decimal(process.env.CAPITAL ?? 1000);

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

async function main(): Promise<void> {
  console.log(
    `Costs: ${DEFAULT_COSTS.feeRate.times(100)}% fee, ${DEFAULT_COSTS.slippageRate.times(100)}% slippage, both sides`,
  );

  for (const dataset of [LONG_HISTORY, SPOT]) {
    const candles = parseCandleCsv(await readFile(dataset.file, 'utf8'));

    // Both strategies are measured over the same window, starting once the
    // moving average has a full period of history behind it.
    const evaluateFrom = candles[0]!.time + MA_PERIOD * DAY;
    const last = candles[candles.length - 1]!.time;

    console.log(
      `\n${dataset.symbol} ${dataset.category} — ${dataset.purpose}` +
        `\nevaluated ${iso(evaluateFrom)} to ${iso(last)} (warm-up from ${iso(candles[0]!.time)})\n`,
    );

    const results = [
      runBacktest(candles, trendFilter({ maPeriod: MA_PERIOD }), DEFAULT_COSTS, CAPITAL, `MA-${MA_PERIOD}`, {
        evaluateFrom,
      }),
      runBacktest(candles, buyAndHold, DEFAULT_COSTS, CAPITAL, 'Buy & Hold', { evaluateFrom }),
    ];
    console.log(formatComparison(results));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
