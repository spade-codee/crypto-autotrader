import type { Candle, StrategyFn, TargetState } from '../types.js';

/**
 * Combines strategies by majority vote: LONG only when more than half of them
 * say LONG. A tie resolves to FLAT, matching the trend filter's own bias toward
 * cash when the evidence is split.
 *
 * Exists to test whether results depend on one exact moving-average period: a
 * vote across neighbouring periods should behave similarly if the effect is
 * real, and very differently if one period was merely lucky.
 */
export function majorityVote(strategies: StrategyFn[]): StrategyFn {
  if (strategies.length === 0) {
    throw new Error('majorityVote needs at least one strategy');
  }
  return (candles: Candle[]): TargetState => {
    const longVotes = strategies.filter((strategy) => strategy(candles) === 'LONG').length;
    return longVotes * 2 > strategies.length ? 'LONG' : 'FLAT';
  };
}
