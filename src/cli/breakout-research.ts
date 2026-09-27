import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { FINGERPRINTS } from '../backtest/breakoutPreregistration.js';
import {
  attemptLine,
  baselinesOf,
  evaluate,
  formatEvaluation,
  reproductionProblems,
  requireFingerprint,
  windowsOf,
} from '../backtest/breakoutResearch.js';
import { parseCandleCsv } from '../data/csv.js';
import { LONG_HISTORY, SPOT } from '../data/datasets.js';
import type { Candle } from '../types.js';

/**
 * The channel-breakout research, as pre-registered in
 * docs/research/channel-breakout-candidate.md on product-prototype.
 *
 * It refuses any file that is not Phase 0's, stops if Phase 0's rows do not
 * reproduce, and only then runs version 0: once, printing every figure, the
 * three tests, the verdict and an attempt line. With --check-only it stops
 * after the reproduction check, before any breakout run.
 */

async function load(file: string, fingerprint: string): Promise<Candle[]> {
  const bytes = await readFile(file);
  requireFingerprint(file, bytes, fingerprint);
  return parseCandleCsv(bytes.toString('utf8'));
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const windows = windowsOf(await load(LONG_HISTORY.file, FINGERPRINTS.long), await load(SPOT.file, FINGERPRINTS.spot));
  console.log('Files: both are the Phase 0 files, by SHA-256.');

  const baselines = baselinesOf(windows);
  const problems = reproductionProblems(baselines);
  if (problems.length > 0) {
    throw new Error(`the reproduction check failed, so no breakout was run:\n${problems.join('\n')}`);
  }
  console.log("Reproduction check: all ten of Phase 0's rows reproduce.");
  if (process.argv.includes('--check-only')) {
    console.log('--check-only: stopping before any breakout run.');
    return;
  }

  const evaluation = evaluate(windows, baselines);
  console.log(`\n${formatEvaluation(windows, baselines, evaluation)}`);
  console.log(`\nAttempt: ${attemptLine(evaluation, commit(), new Date())}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
