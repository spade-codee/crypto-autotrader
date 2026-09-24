import { mkdir, writeFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchCandles, INTERVAL_MS } from '../data/bybit.js';
import { toCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity } from '../data/integrity.js';

// Before Bybit spot's first 15-minute candle; the API answers from its first.
const START = new Date('2021-07-01T00:00:00Z');
// The locked period stays off the disk until its own pull request fetches with --until 2026-09-01.
const DEFAULT_UNTIL = '2025-01-01';
// Set BYBIT_API_BASE to force a single host; otherwise hosts are tried in order.
const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;

function until(argv: string[]): number {
  const index = argv.indexOf('--until');
  const value = index === -1 ? DEFAULT_UNTIL : argv[index + 1];
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--until needs a date: YYYY-MM-DD');
  }
  return Date.parse(`${value}T00:00:00Z`);
}

async function main(): Promise<void> {
  const end = until(process.argv.slice(2));
  await mkdir('data', { recursive: true });
  const day = new Date(end).toISOString().slice(0, 10);
  console.log(`Fetching ${LIQUIDITY_15M.symbol} ${LIQUIDITY_15M.category} 15-minute candles before ${day}...`);
  const candles = await fetchCandles(LIQUIDITY_15M.symbol, '15', START, {
    category: LIQUIDITY_15M.category,
    hosts: HOSTS,
    end,
  });
  if (candles.length === 0) {
    throw new Error('no candles returned');
  }
  await writeFile(LIQUIDITY_15M.file, toCandleCsv(candles), 'utf8');
  console.log(`  wrote ${candles.length} candles to ${LIQUIDITY_15M.file}`);
  console.log(formatIntegrity(checkCandles(candles, INTERVAL_MS['15'])));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
