import type Decimal from 'decimal.js';
import type { OrderState } from '../exchange/trading.js';
import type { InstrumentRules } from '../market/types.js';
import { mean } from '../math.js';
import type { Candle, CostModel, StrategyFn, TargetState } from '../types.js';

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

export type MarketCost = {
  /** The fee, as a fraction of the amount filled. */
  feeRate: Decimal;
  /** Against the mid when the order was sized; positive when it cost us. */
  spreadAndImpact: Decimal;
  /** The fee plus the spread and impact: what the fill cost against the market. */
  againstMarket: Decimal;
  /** What the backtest assumes one trade costs: its fee plus its slippage. */
  assumed: Decimal;
  /** More than the backtest assumes. */
  tooExpensive: boolean;
};

/**
 * What a fill cost against the market when its order was sized, seconds before
 * it was sent. A fee charged in the base coin is priced at the fill's average
 * price. Throws on a fill with nothing filled, or a fee in a coin it cannot price.
 */
export function marketCost(fill: OrderState, mid: Decimal, rules: InstrumentRules, costs: CostModel): MarketCost {
  if (fill.avgPrice === null || fill.filledQuoteAmount.lte(0)) {
    throw new Error(`order ${fill.clientOrderId} has nothing filled to cost`);
  }
  let feeInQuote: Decimal;
  if (fill.feeCoin === rules.baseCoin) {
    feeInQuote = fill.fee.times(fill.avgPrice);
  } else if (fill.feeCoin === rules.quoteCoin) {
    feeInQuote = fill.fee;
  } else {
    throw new Error(`order ${fill.clientOrderId} paid its fee in ${fill.feeCoin}, which cannot be priced`);
  }
  const feeRate = feeInQuote.div(fill.filledQuoteAmount);
  const gap = fill.side === 'BUY' ? fill.avgPrice.minus(mid) : mid.minus(fill.avgPrice);
  const spreadAndImpact = gap.div(mid);
  const againstMarket = feeRate.plus(spreadAndImpact);
  const assumed = costs.feeRate.plus(costs.slippageRate);
  return { feeRate, spreadAndImpact, againstMarket, assumed, tooExpensive: againstMarket.gt(assumed) };
}

/**
 * What a fill cost against the price the backtest would have paid — the open of
 * the day after its decision — plus the fee. Minutes between that open and the
 * fill move this both ways, so single trades are noise; only the average says
 * anything.
 */
export function againstBacktestPrice(fill: OrderState, open: Decimal, feeRate: Decimal): Decimal {
  if (fill.avgPrice === null) {
    throw new Error(`order ${fill.clientOrderId} has nothing filled to cost`);
  }
  const gap = fill.side === 'BUY' ? fill.avgPrice.minus(open) : open.minus(fill.avgPrice);
  return gap.div(open).plus(feeRate);
}

/** 0.0011 → "0.11%" */
export function percent(fraction: Decimal): string {
  return `${fraction.times(100).toFixed(2)}%`;
}

export function expensiveFillMessage(clientOrderId: string, cost: MarketCost): string {
  return (
    `Self-check: order ${clientOrderId} cost ${percent(cost.againstMarket)} against the market, ` +
    `more than the ${percent(cost.assumed)} the backtest assumes: ` +
    `fee ${percent(cost.feeRate)}, spread and impact ${percent(cost.spreadAndImpact)}.`
  );
}
