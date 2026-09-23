import type Decimal from 'decimal.js';
import { mean } from '../math.js';
import type { Candle, StrategyFn, TargetState } from '../types.js';

export type Verdict = 'HOLDS' | 'DATA_REVISED' | 'DECISION_CHANGED';

/** What the engine recorded for a day, in its SIGNAL. */
export type RecordedSignal = { target: TargetState; close: Decimal; movingAverage: Decimal };

export type Replay = {
  verdict: Verdict;
  recordedTarget: TargetState;
  replayedTarget: TargetState;
  recordedClose: Decimal;
  currentClose: Decimal;
  recordedAverage: Decimal;
  currentAverage: Decimal;
};

/**
 * Evaluates the strategy again on `window` — today's candles, up to and
 * including the day being checked — and compares the decision with the one the
 * engine recorded for that day. Null when the window is too short to give that
 * day's decision, so a truncated window can never pass for a changed one.
 */
export function replayDecision(
  window: Candle[],
  recorded: RecordedSignal,
  strategy: StrategyFn,
  maPeriod: number,
): Replay | null {
  if (window.length < maPeriod) {
    return null;
  }
  const replayedTarget = strategy(window);
  const currentClose = window[window.length - 1]!.close;
  const currentAverage = mean(window.slice(-maPeriod).map((c) => c.close));
  let verdict: Verdict = 'DATA_REVISED';
  if (replayedTarget !== recorded.target) {
    verdict = 'DECISION_CHANGED';
  } else if (currentClose.equals(recorded.close) && currentAverage.equals(recorded.movingAverage)) {
    verdict = 'HOLDS';
  }
  return {
    verdict,
    recordedTarget: recorded.target,
    replayedTarget,
    recordedClose: recorded.close,
    currentClose,
    recordedAverage: recorded.movingAverage,
    currentAverage,
  };
}
