import type { Candle } from '../types.js';

/** A run of missing candles: `missing` of them after the candle opening at `after`. */
export type Gap = { after: number; missing: number };

export type IntegrityReport = {
  intervalMs: number;
  count: number;
  first: number | null;
  last: number | null;
  gaps: Gap[];
  duplicates: number[];
  outOfOrder: number[];
  misaligned: number[];
  invalid: Array<{ time: number; reason: string }>;
};

/**
 * Checks candles of one interval for what would make a result about wicks
 * untrustworthy: a missing candle, one repeated or out of order, one that does
 * not start on its interval's boundary, and prices that cannot all belong to one
 * candle. Gaps are reported, not fatal: the strategy starts again after one
 * (R13). Anything else means the file is wrong.
 */
export function checkCandles(candles: Candle[], intervalMs: number): IntegrityReport {
  const report: IntegrityReport = {
    intervalMs,
    count: candles.length,
    first: candles[0]?.time ?? null,
    last: candles[candles.length - 1]?.time ?? null,
    gaps: [],
    duplicates: [],
    outOfOrder: [],
    misaligned: [],
    invalid: [],
  };
  let previous: Candle | undefined;
  for (const candle of candles) {
    if (candle.time % intervalMs !== 0) {
      report.misaligned.push(candle.time);
    }
    const reason = impossiblePrices(candle);
    if (reason !== null) {
      report.invalid.push({ time: candle.time, reason });
    }
    if (previous !== undefined) {
      const step = candle.time - previous.time;
      if (step === 0) {
        report.duplicates.push(candle.time);
      } else if (step < 0) {
        report.outOfOrder.push(candle.time);
      } else if (step > intervalMs) {
        report.gaps.push({ after: previous.time, missing: Math.round(step / intervalMs) - 1 });
      }
    }
    previous = candle;
  }
  return report;
}

/** True when nothing but gaps was found. Gaps are survivable; the rest are not. */
export function usable(report: IntegrityReport): boolean {
  return (
    report.duplicates.length === 0 &&
    report.outOfOrder.length === 0 &&
    report.misaligned.length === 0 &&
    report.invalid.length === 0
  );
}

function impossiblePrices(candle: Candle): string | null {
  if (candle.low.lte(0)) {
    return 'a price at or below zero';
  }
  if (candle.volume.isNeg()) {
    return 'negative volume';
  }
  if (candle.high.lt(candle.low)) {
    return 'high below low';
  }
  if (candle.high.lt(candle.open) || candle.high.lt(candle.close)) {
    return 'high below the open or close';
  }
  if (candle.low.gt(candle.open) || candle.low.gt(candle.close)) {
    return 'low above the open or close';
  }
  return null;
}

const iso = (time: number) => new Date(time).toISOString().replace('.000Z', 'Z');

/** A short summary for the research commands. */
export function formatIntegrity(report: IntegrityReport): string {
  const missing = report.gaps.reduce((total, gap) => total + gap.missing, 0);
  const span = report.first === null ? '' : `, ${iso(report.first)} to ${iso(report.last!)}`;
  const lines = [
    `${report.count} candles${span}`,
    `gaps: ${report.gaps.length} (${missing} candles missing)`,
    `duplicates: ${report.duplicates.length}, out of order: ${report.outOfOrder.length}, ` +
      `misaligned: ${report.misaligned.length}, impossible prices: ${report.invalid.length}`,
  ];
  for (const gap of report.gaps.slice(0, 10)) {
    lines.push(`  missing ${gap.missing} after ${iso(gap.after)}`);
  }
  if (report.gaps.length > 10) {
    lines.push(`  and ${report.gaps.length - 10} more gaps`);
  }
  return lines.join('\n');
}
