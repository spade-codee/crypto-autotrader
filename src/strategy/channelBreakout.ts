import type { Candle, StrategyFn, TargetState } from '../types.js';

/** How many closes before the signal day each channel spans. */
export type ChannelBreakoutConfig = {
  /** Enter on a close above every close of this many days before it. */
  entryDays: number;
  /** Exit on a close below every close of this many days before it. */
  exitDays: number;
};

/**
 * Version 0, fixed in docs/research/channel-breakout-candidate.md (on
 * product-prototype) before any breakout result: the window lengths of the
 * published Turtle rules' slower system, and nothing else of that system.
 */
export const BREAKOUT_V0: ChannelBreakoutConfig = { entryDays: 55, exitDays: 20 };

export type BreakoutSignal = 'ENTER' | 'EXIT';

/**
 * Whether the close at `index` is strictly beyond every close of the `days`
 * before it: above them all when `direction` is 1, below them all when it is
 * -1. The signal day is never part of its own window, and a close equal to
 * one of them is not beyond it. With fewer than `days` earlier closes, it is
 * never beyond.
 */
function beyondChannel(candles: Candle[], index: number, days: number, direction: 1 | -1): boolean {
  if (index < days) {
    return false;
  }
  const close = candles[index]!.close;
  for (let k = index - 1; k >= index - days; k--) {
    const earlier = candles[k]!.close;
    if (direction === 1 ? !close.gt(earlier) : !close.lt(earlier)) {
      return false;
    }
  }
  return true;
}

/** The signal at the close of `candles[index]`, or null when that day has none. */
export function signalAt(
  candles: Candle[],
  index: number,
  config: ChannelBreakoutConfig,
): BreakoutSignal | null {
  if (beyondChannel(candles, index, config.entryDays, 1)) {
    return 'ENTER';
  }
  if (beyondChannel(candles, index, config.exitDays, -1)) {
    return 'EXIT';
  }
  return null;
}

/**
 * A daily channel breakout, long or flat. Research only: nothing trades it.
 *
 * Hold BTC after an entry signal and USDT after an exit signal. A day with no
 * signal keeps the position, and before any signal it is USDT. The two
 * signals never fall on the same day: a close above the entry channel is
 * above the previous close, which is at or above the exit channel's low.
 *
 * Pure, like the trend filter. The position is whatever the most recent
 * signal says, so it is found by looking back from the latest close, and it
 * depends on the history alone.
 */
export function channelBreakout(config: ChannelBreakoutConfig): StrategyFn {
  for (const name of ['entryDays', 'exitDays'] as const) {
    if (!Number.isInteger(config[name]) || config[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }

  return (candles: Candle[]): TargetState => {
    for (let index = candles.length - 1; index >= 0; index--) {
      const signal = signalAt(candles, index, config);
      if (signal !== null) {
        return signal === 'ENTER' ? 'LONG' : 'FLAT';
      }
    }
    return 'FLAT';
  };
}
