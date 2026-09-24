import Decimal from 'decimal.js';
import { roundDown } from '../math.js';
import { QUARTER_HOUR_MS } from '../strategy/bars.js';
import {
  createLiquiditySweep,
  type EnterEvent,
  type LiquiditySweepConfig,
  type SweepEvent,
} from '../strategy/liquiditySweep.js';
import type { Candle, CostModel } from '../types.js';

const ONE = new Decimal(1);

export type ExitReason = 'STOP' | 'TARGET' | 'TIME' | 'GAP' | 'END';

export type Exit = {
  /** The candle the exit happened on. */
  index: number;
  /** The price before slippage: the trigger, the target, an open or the last close. */
  rawPrice: Decimal;
  /** The fill, after slippage. */
  price: Decimal;
  reason: ExitReason;
  /** The candle also reached the target; the stop was taken to come first (R9). */
  ambiguous: boolean;
};

/**
 * R9: how a trade entered at candles[entryIndex]'s open ends. Every exit is a
 * market sell once triggered, so each pays slippage (R11). Checked on every
 * candle from the entry candle itself: a missing candle takes the worse of the
 * next open and the stop; the time limit sells at the open after the last
 * candle allowed; the stop sells at its trigger, or at the open if the candle
 * opened below it; the target sells at the target; a candle reaching both is a
 * stop, since a candle cannot say which came first; and candles that end first
 * sell at the last close.
 */
export function simulateExit(
  candles: Candle[],
  entryIndex: number,
  stopTrigger: Decimal,
  target: Decimal,
  timeLimitCandles: number,
  costs: CostModel,
): Exit {
  const exit = (index: number, rawPrice: Decimal, reason: ExitReason, ambiguous = false): Exit => ({
    index,
    rawPrice,
    price: rawPrice.times(ONE.minus(costs.slippageRate)),
    reason,
    ambiguous,
  });
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i]!;
    if (i > entryIndex && candle.time !== candles[i - 1]!.time + QUARTER_HOUR_MS) {
      return exit(i, candle.low.lte(stopTrigger) ? Decimal.min(candle.open, stopTrigger) : candle.open, 'GAP');
    }
    if (i - entryIndex === timeLimitCandles) {
      return exit(i, candle.open, 'TIME');
    }
    const reached = candle.high.gte(target);
    if (candle.low.lte(stopTrigger)) {
      return exit(i, Decimal.min(candle.open, stopTrigger), 'STOP', reached);
    }
    if (reached) {
      return exit(i, target, 'TARGET');
    }
  }
  const last = candles.length - 1;
  return exit(last, candles[last]!.close, 'END');
}

/** Net R (spec section 3): profit per BTC after both fees, over the planned risk. Slippage is already in the prices. */
export function netR(entryPrice: Decimal, exitPrice: Decimal, feeRate: Decimal, plannedRisk: Decimal): Decimal {
  return exitPrice.minus(entryPrice).minus(entryPrice.plus(exitPrice).times(feeRate)).div(plannedRisk);
}

export type BracketTrade = {
  confirmationTime: number;
  confirmationClose: Decimal;
  entryIndex: number;
  entryTime: number;
  /** The entry candle's open, before slippage. */
  entryOpen: Decimal;
  /** The fill, after slippage. */
  entryPrice: Decimal;
  stopTrigger: Decimal;
  target: Decimal;
  plannedRisk: Decimal;
  quantity: Decimal;
  /** The account's value when the trade opened: it was flat, so this is its USDT. */
  equityAtEntry: Decimal;
  exit: Exit;
  exitTime: number;
  /** Net R: after fees and slippage. */
  r: Decimal;
  /** Gross R: the same trade before any cost. */
  grossR: Decimal;
  /** Net profit or loss in USDT. */
  pnl: Decimal;
};

export type SkipReason = 'MISSED_ENTRY' | 'TOO_SMALL' | 'OPEN_AT_OR_BELOW_STOP';
export type Skip = { time: number; reason: SkipReason };

export type ExchangeRules = { lotStep: Decimal; minOrderAmt: Decimal };

/** BTCUSDT on Bybit spot, from its instrument rules on 2026-09-23. */
export const BTCUSDT_RULES: ExchangeRules = { lotStep: new Decimal('0.000001'), minOrderAmt: new Decimal(5) };

/** R10: the research risk per trade, 0.25% of the account. Not a product decision. */
export const RESEARCH_RISK = new Decimal('0.0025');

export type BracketOptions = {
  config: LiquiditySweepConfig;
  costs: CostModel;
  capital: Decimal;
  riskFraction: Decimal;
  rules: ExchangeRules;
  /** Epoch ms. Earlier candles only warm the strategy up; no trade starts before this. */
  evaluateFrom: number;
};

export type EquityMark = { time: number; equity: Decimal; holding: boolean };

export type BracketRun = {
  trades: BracketTrade[];
  skips: Skip[];
  events: SweepEvent[];
  /** Candles at whose open a placebo may enter: each directly follows a close with the structure up and a level. */
  placeboEntries: number[];
  equity: EquityMark[];
};

/**
 * Runs a version over candles with a simulated account of `capital` USDT. At
 * each candle: a time or gap exit at the open, then an entry confirmed at the
 * last close, then a stop, target or end during the candle, then the strategy
 * sees the candle. Equity is marked at every evaluated close.
 */
export function runBracketBacktest(candles: Candle[], options: BracketOptions): BracketRun {
  const { costs } = options;
  const strategy = createLiquiditySweep(options.config);
  const run: BracketRun = { trades: [], skips: [], events: [], placeboEntries: [], equity: [] };
  let cash = options.capital;
  let open: BracketTrade | null = null;
  let pending: EnterEvent | null = null;

  const settle = (trade: BracketTrade) => {
    const proceeds = trade.quantity.times(trade.exit.price);
    cash = cash.plus(proceeds).minus(proceeds.times(costs.feeRate));
    run.trades.push(trade);
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    if (open !== null && open.exit.index === i && (open.exit.reason === 'TIME' || open.exit.reason === 'GAP')) {
      settle(open);
      open = null;
    }
    if (pending !== null) {
      const enter: EnterEvent = pending;
      pending = null;
      if (candle.time !== enter.time + QUARTER_HOUR_MS) {
        run.skips.push({ time: enter.time, reason: 'MISSED_ENTRY' });
      } else {
        const entered = enterTrade(candles, i, enter, cash, options);
        if ('reason' in entered) {
          run.skips.push({ time: enter.time, reason: entered.reason });
        } else {
          cash = cash.minus(entered.spent);
          open = entered.trade;
        }
      }
    }
    const flatAtOpen = open === null;
    if (open !== null && open.exit.index === i) {
      settle(open);
      open = null;
    }

    const events = strategy.onCandle({ candle, flatAtOpen });
    if (candle.time < options.evaluateFrom) {
      continue;
    }
    run.events.push(...events);
    for (const event of events) {
      if (event.kind === 'ENTER') {
        pending = event;
      }
    }
    const status = strategy.status();
    const next = candles[i + 1];
    if (status.structureUp && status.level !== null && next !== undefined && next.time === candle.time + QUARTER_HOUR_MS) {
      run.placeboEntries.push(i + 1);
    }
    const holding: BracketTrade | null = open;
    run.equity.push({
      time: candle.time,
      equity: holding === null ? cash : cash.plus(holding.quantity.times(candle.close)),
      holding: holding !== null,
    });
  }
  return run;
}

type Entered = { trade: BracketTrade; spent: Decimal };

/** R8, R10: the entry at candles[index]'s open, sized only from what was known at the confirmation close. */
function enterTrade(
  candles: Candle[],
  index: number,
  enter: EnterEvent,
  cash: Decimal,
  options: BracketOptions,
): Entered | { reason: SkipReason } {
  const { config, costs, rules } = options;
  const candle = candles[index]!;
  if (candle.open.lte(enter.stopTrigger)) {
    return { reason: 'OPEN_AT_OR_BELOW_STOP' };
  }
  const buyAt = enter.confirmationClose.times(ONE.plus(costs.slippageRate));
  const sellAt = enter.stopTrigger.times(ONE.minus(costs.slippageRate));
  const riskPerBtc = buyAt.minus(sellAt).plus(buyAt.plus(sellAt).times(costs.feeRate));
  const quoteAmount = Decimal.min(
    cash.times(options.riskFraction).div(riskPerBtc).times(buyAt),
    cash.div(ONE.plus(costs.feeRate)),
  );
  const entryPrice = candle.open.times(ONE.plus(costs.slippageRate));
  const quantity = roundDown(quoteAmount.div(entryPrice), rules.lotStep);
  const cost = quantity.times(entryPrice);
  if (quantity.isZero() || cost.lt(rules.minOrderAmt)) {
    return { reason: 'TOO_SMALL' };
  }
  const target = entryPrice.plus(config.targetMultiple.times(entryPrice.minus(enter.stopTrigger)));
  const exit = simulateExit(candles, index, enter.stopTrigger, target, config.timeLimitCandles, costs);
  const entryFee = cost.times(costs.feeRate);
  const proceeds = quantity.times(exit.price);
  return {
    spent: cost.plus(entryFee),
    trade: {
      confirmationTime: enter.time,
      confirmationClose: enter.confirmationClose,
      entryIndex: index,
      entryTime: candle.time,
      entryOpen: candle.open,
      entryPrice,
      stopTrigger: enter.stopTrigger,
      target,
      plannedRisk: enter.plannedRisk,
      quantity,
      equityAtEntry: cash,
      exit,
      exitTime: candles[exit.index]!.time,
      r: netR(entryPrice, exit.price, costs.feeRate, enter.plannedRisk),
      grossR: exit.rawPrice.minus(candle.open).div(enter.plannedRisk),
      pnl: proceeds.minus(proceeds.times(costs.feeRate)).minus(cost).minus(entryFee),
    },
  };
}
