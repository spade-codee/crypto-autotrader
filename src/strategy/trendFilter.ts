import { mean } from '../math.js';
import type { Candle, StrategyConfig, StrategyFn, TargetState } from '../types.js';

/**
 * Hold the asset while its close is above the simple moving average of the
 * last `maPeriod` closes; hold cash otherwise.
 *
 * Pure: no I/O, no clock, no randomness. This exact function runs in the
 * backtest and, from Phase 3, in production. There is deliberately no second
 * implementation anywhere.
 *
 * Equality resolves to FLAT. A close that merely matches its own average is
 * not evidence of an uptrend, and biasing toward cash is the safer default.
 */
export function trendFilter(config: StrategyConfig): StrategyFn {
  if (!Number.isInteger(config.maPeriod) || config.maPeriod <= 0) {
    throw new Error('maPeriod must be a positive integer');
  }

  return (candles: Candle[]): TargetState => {
    if (candles.length < config.maPeriod) {
      return 'FLAT';
    }
    const window = candles.slice(-config.maPeriod);
    const average = mean(window.map((c) => c.close));
    const latest = window[window.length - 1]!.close;
    return latest.gt(average) ? 'LONG' : 'FLAT';
  };
}

/** Baseline: always invested. Used to compare the strategy against doing nothing. */
export const buyAndHold: StrategyFn = () => 'LONG';
