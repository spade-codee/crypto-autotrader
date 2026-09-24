import { readFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchCandles, INTERVAL_MS, type Interval } from '../data/bybit.js';
import { compareCandles, medianVolumeByYear } from '../data/compare.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity } from '../data/integrity.js';
import { aggregate, DAY_MS, FOUR_HOURS_MS } from '../strategy/bars.js';

// Set BYBIT_API_BASE to force a single host; otherwise hosts are tried in order.
const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;
const iso = (time: number | null) => (time === null ? 'none' : `${new Date(time).toISOString().slice(0, 16)}Z`);

/**
 * The data check before any result (spec 6.3, item 8): the 15-minute file's
 * integrity, the 4-hour and daily candles built from it against Bybit's own,
 * and each year's median volume, which shows how thin the early market was.
 */
async function main(): Promise<void> {
  const candles = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  console.log(formatIntegrity(checkCandles(candles, INTERVAL_MS['15'])));
  const first = candles[0]!.time;
  const end = candles[candles.length - 1]!.time + INTERVAL_MS['15'];
  const checks: Array<[Interval, number, string]> = [
    ['240', FOUR_HOURS_MS, '4-hour'],
    ['D', DAY_MS, 'daily'],
  ];
  for (const [interval, blockMs, label] of checks) {
    const official = await fetchCandles(LIQUIDITY_15M.symbol, interval, new Date(first), {
      category: LIQUIDITY_15M.category,
      hosts: HOSTS,
      end,
    });
    const c = compareCandles(aggregate(candles, blockMs), official);
    console.log(
      `${label}: ${c.compared} compared, ${c.identical} identical, largest difference ` +
        `${c.largestDifference.times(100).toFixed(4)}% at ${iso(c.worstTime)}, ` +
        `${c.missingOfficial} missing on Bybit, ${c.missingBuilt} not built`,
    );
  }
  for (const { year, median } of medianVolumeByYear(candles)) {
    console.log(`${year}: median 15-minute volume ${median.toFixed(3)} BTC`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
