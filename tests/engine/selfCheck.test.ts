import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { replayDecision, type RecordedSignal } from '../../src/engine/selfCheck.js';
import { mean } from '../../src/math.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';
import { trendingCandles } from '../helpers/candles.js';

const strategy = trendFilter({ maPeriod: CHOSEN_MA_PERIOD });
// Rising prices: the strategy says LONG on the last day, whose close is 50,000 + 199 × 100 = 69,900.
const WINDOW = trendingCandles('2026-01-01', 200, 'up');

/** What the engine would have recorded for the window's last day. */
function recorded(window: Candle[]): RecordedSignal {
  return {
    target: strategy(window),
    close: window[window.length - 1]!.close,
    movingAverage: mean(window.slice(-CHOSEN_MA_PERIOD).map((c) => c.close)),
  };
}

/** The window with one close replaced, as if the exchange revised it. */
function revised(window: Candle[], index: number, close: string): Candle[] {
  const price = new Decimal(close);
  return window.map((c, i) =>
    i === index ? { ...c, close: price, high: Decimal.max(c.high, price), low: Decimal.min(c.low, price) } : c,
  );
}

describe('replayDecision', () => {
  it('holds when nothing has changed', () => {
    expect(replayDecision(WINDOW, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)?.verdict).toBe('HOLDS');
  });

  it('notices a revised close that leaves the decision as it was', () => {
    const replay = replayDecision(revised(WINDOW, 199, '69901'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DATA_REVISED', recordedTarget: 'LONG', replayedTarget: 'LONG' });
    expect(replay?.currentClose.toFixed()).toBe('69901');
  });

  it('notices a revised earlier close that moves only the average', () => {
    const replay = replayDecision(revised(WINDOW, 190, '70000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay?.verdict).toBe('DATA_REVISED');
    expect(replay?.currentClose.equals(replay.recordedClose)).toBe(true);
    expect(replay?.currentAverage.equals(replay.recordedAverage)).toBe(false);
  });

  it('reports a decision the current data would not make', () => {
    const replay = replayDecision(revised(WINDOW, 199, '1000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DECISION_CHANGED', recordedTarget: 'LONG', replayedTarget: 'FLAT' });
  });

  it('refuses a window too short to give that day’s decision', () => {
    const short = WINDOW.slice(0, CHOSEN_MA_PERIOD - 1);
    expect(replayDecision(short, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)).toBeNull();
  });
});
