import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { DEVELOPMENT, periodCandles, type PeriodName } from '../backtest/liquidityPeriods.js';
import {
  attemptLine,
  developmentVerdict,
  formatEvidence,
  gatherEvidence,
  lockedVerdict,
  runVersion,
  summarizeTrades,
} from '../backtest/liquidityReport.js';
import { resolveVersion } from '../backtest/liquidityVersions.js';
import { INTERVAL_MS } from '../data/bybit.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity, usable } from '../data/integrity.js';

const YEAR_MS = 365.25 * 86_400_000;

/** The value after a flag, or undefined when the flag is absent. */
function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function period(argv: string[]): PeriodName {
  const value = flag(argv, '--period');
  if (value !== 'development' && value !== 'locked') {
    throw new Error('--period must be development or locked');
  }
  return value;
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The liquidity-sweep research (spec 6.3, items 8 and 9). --version picks
 * version 0 (the default) or version 1, and --step names a version 1 ladder
 * step, which is only ever counted. With --count-only it prints the trade count
 * and nothing else, so the count is seen before any result. The locked period
 * needs --unlock-locked-period, and is run only in its own pull request.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const name = period(argv);
  const countOnly = argv.includes('--count-only');
  const version = resolveVersion(flag(argv, '--version'), flag(argv, '--step'), countOnly);
  const all = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  const integrity = checkCandles(all, INTERVAL_MS['15']);
  console.log(formatIntegrity(integrity));
  if (!usable(integrity)) {
    throw new Error('the candle file has duplicates, misordered or misaligned candles, or impossible prices: fetch it again');
  }
  const { candles, evaluateFrom, evaluateTo } = periodCandles(all, name, argv.includes('--unlock-locked-period'));

  if (countOnly) {
    const trades = runVersion(candles, version.config, DEFAULT_COSTS, evaluateFrom).trades.length;
    console.log(`\n${version.name}, ${name}: ${trades} trades. Nothing else is shown until the full run.`);
    return;
  }

  const evidence = gatherEvidence(candles, name, evaluateFrom, evaluateTo, version);
  let verdict: ReturnType<typeof developmentVerdict>;
  if (name === 'development') {
    verdict = developmentVerdict(evidence);
  } else {
    const developmentCandles = candles.filter((candle) => candle.time < DEVELOPMENT.to);
    const developmentTrades = runVersion(developmentCandles, version.config, DEFAULT_COSTS, DEVELOPMENT.from).trades;
    const developmentYears = new Decimal(DEVELOPMENT.to - DEVELOPMENT.from).div(YEAR_MS);
    verdict = lockedVerdict(evidence, summarizeTrades(developmentTrades, developmentYears).perYear);
  }
  console.log(`\n${formatEvidence(evidence, verdict)}`);
  console.log(`\nAttempt: ${attemptLine(evidence, verdict.verdict, commit(), new Date())}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
