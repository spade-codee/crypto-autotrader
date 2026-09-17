import { mkdir, writeFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchDailyCandles } from '../data/bybit.js';
import { toCandleCsv } from '../data/csv.js';

const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';
// Bybit spot BTCUSDT daily history begins 2021-07-05 (verified 2026-09-17).
// An earlier start date is harmless: the API simply returns from the first
// candle it has.
const START = new Date(process.env.START ?? '2017-01-01T00:00:00Z');
// Set BYBIT_API_BASE to force a single host; otherwise hosts are tried in order.
const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;

async function main(): Promise<void> {
  console.log(`Fetching ${SYMBOL} daily candles from ${START.toISOString().slice(0, 10)}...`);
  const candles = await fetchDailyCandles(SYMBOL, START, HOSTS);

  if (candles.length === 0) {
    throw new Error('no candles returned — check the symbol and start date');
  }

  await mkdir('data', { recursive: true });
  const path = `data/${SYMBOL}-1d.csv`;
  await writeFile(path, toCandleCsv(candles), 'utf8');

  const firstDate = new Date(candles[0]!.time).toISOString().slice(0, 10);
  const lastDate = new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
  console.log(`Wrote ${candles.length} candles to ${path} (${firstDate} to ${lastDate}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
