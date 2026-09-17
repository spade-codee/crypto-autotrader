import Decimal from 'decimal.js';
import type { Candle } from '../types.js';

const HEADER = 'time,open,high,low,close,volume';

export function toCandleCsv(candles: Candle[]): string {
  const rows = candles.map((c) =>
    [c.time, c.open, c.high, c.low, c.close, c.volume].join(','),
  );
  return [HEADER, ...rows].join('\n') + '\n';
}

/**
 * Parses candles from CSV. Values go straight from string to Decimal without
 * passing through a JavaScript number, so no precision is lost on the way in.
 *
 * Accepts both LF and CRLF line endings: the project is developed on Windows,
 * where a CSV opened and re-saved gains a trailing \r on every row.
 */
export function parseCandleCsv(csv: string): Candle[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines[0]!.trim() !== HEADER) {
    throw new Error(`unexpected CSV header: expected "${HEADER}"`);
  }

  return lines.slice(1).map((line, index) => {
    const parts = line.split(',');
    if (parts.length !== 6) {
      throw new Error(`malformed CSV row at line ${index + 2}: expected 6 columns`);
    }
    return {
      time: Number(parts[0]),
      open: new Decimal(parts[1]!),
      high: new Decimal(parts[2]!),
      low: new Decimal(parts[3]!),
      close: new Decimal(parts[4]!),
      volume: new Decimal(parts[5]!),
    };
  });
}
