import { mkdir, writeFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchDailyCandles } from '../data/bybit.js';
import { toCandleCsv } from '../data/csv.js';
import { DATASETS } from '../data/datasets.js';

// Early enough for every dataset; the API returns from its first candle.
const START = new Date('2017-01-01T00:00:00Z');
// Set BYBIT_API_BASE to force a single host; otherwise hosts are tried in order.
const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;

async function main(): Promise<void> {
  await mkdir('data', { recursive: true });

  for (const dataset of DATASETS) {
    console.log(`Fetching ${dataset.symbol} ${dataset.category} (${dataset.purpose})...`);
    const candles = await fetchDailyCandles(dataset.symbol, START, {
      category: dataset.category,
      hosts: HOSTS,
    });
    if (candles.length === 0) {
      throw new Error(`no candles returned for ${dataset.symbol} ${dataset.category}`);
    }

    await writeFile(dataset.file, toCandleCsv(candles), 'utf8');
    const first = new Date(candles[0]!.time).toISOString().slice(0, 10);
    const last = new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
    console.log(`  wrote ${candles.length} candles to ${dataset.file} (${first} to ${last})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
