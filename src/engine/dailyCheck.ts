import Decimal from 'decimal.js';
import type { Alerter } from '../alerts/telegram.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import type { Ledger } from '../ledger/ledger.js';
import { orderStateFrom } from '../ledger/orderEvents.js';
import type { InstrumentRules } from '../market/types.js';
import type { AlertLog } from '../state/alertLog.js';
import type { Candle, StrategyFn, TargetState } from '../types.js';
import { cycleDateStart, DAY_MS, isoDate } from './cycleDate.js';
import {
  againstBacktestPrice,
  expensiveFillMessage,
  marketCost,
  percent,
  replayDecision,
  type RecordedSignal,
  type Replay,
} from './selfCheck.js';

/** How many cycle dates before today's the check looks back over. */
export const LOOK_BACK_DAYS = 7;

export type CheckDeps = {
  ledger: Ledger;
  alerter: Alerter;
  alertLog: AlertLog;
  strategy: StrategyFn;
  maPeriod: number;
};

/** What the check has to say: sentences for every account's summary, then each account's own. */
export type DailyCheck = { shared: string[]; byUser: Map<string, string[]> };

export function emptyCheck(): DailyCheck {
  return { shared: [], byUser: new Map() };
}

/** The check's sentences for one account's summary, with a leading space, or nothing. */
export function checkSentences(check: DailyCheck, userId: string): string {
  const sentences = [...check.shared, ...(check.byUser.get(userId) ?? [])];
  return sentences.length === 0 ? '' : ` ${sentences.join(' ')}`;
}

type Scope = { deps: CheckDeps; candles: Candle[]; date: string; at: Date; from: string; to: string; check: DailyCheck };

/**
 * The engine's daily self-check (spec: 2026-09-23-engine-self-check-design.md).
 * From the candles the tick already fetched, it replays the decisions of the
 * seven cycle dates before today's and costs their fills, records what it finds,
 * and says so. It never changes a decision, an order, or an account.
 */
export async function runDailyCheck(
  deps: CheckDeps,
  candles: Candle[],
  rules: InstrumentRules,
  date: string,
  at: Date,
): Promise<DailyCheck> {
  const start = cycleDateStart(date);
  const scope: Scope = {
    deps,
    candles,
    date,
    at,
    from: isoDate(start - LOOK_BACK_DAYS * DAY_MS),
    to: isoDate(start - DAY_MS),
    check: emptyCheck(),
  };
  await replayDecisions(scope);
  await costFills(scope, rules);
  return scope.check;
}

async function replayDecisions(scope: Scope): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const replayed = new Set((await deps.ledger.ofTypeBetween('DECISION_REPLAY', from, to)).map((e) => e.cycleDate));
  for (const signal of await deps.ledger.ofTypeBetween('SIGNAL', from, to)) {
    const day = signal.cycleDate;
    if (day === null || signal.userId !== null || replayed.has(day)) {
      continue;
    }
    const window = candles.filter((c) => c.time <= cycleDateStart(day));
    if (window.length === 0 || isoDate(window[window.length - 1]!.time) !== day) {
      continue;
    }
    const replay = replayDecision(window, recordedSignal(signal.payload), deps.strategy, deps.maPeriod);
    if (replay === null) {
      continue;
    }
    await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: day, type: 'DECISION_REPLAY', payload: { ...replay } });
    replayed.add(day);
    check.shared.push(replaySentence(day, replay));
    if (replay.verdict === 'DECISION_CHANGED' && (await deps.alertLog.claim(`${day}:system:decision-changed`, at))) {
      await deps.alerter.send(
        `Self-check: the ${day} decision would now be ${replay.replayedTarget}, not ${replay.recordedTarget}. ` +
          "Bybit's data for that day has changed since the engine traded on it. Nothing was frozen: today's run " +
          'already trades on the current data. If this happens again, the price data needs a closer look.',
      );
    }
  }
}

function recordedSignal(payload: Record<string, unknown>): RecordedSignal {
  const target = String(payload.target);
  if (target !== 'LONG' && target !== 'FLAT') {
    throw new Error(`a recorded signal has no valid target: "${target}"`);
  }
  return {
    target: target as TargetState,
    close: new Decimal(String(payload.close)),
    movingAverage: new Decimal(String(payload.movingAverage)),
  };
}

function replaySentence(day: string, replay: Replay): string {
  if (replay.verdict === 'HOLDS') {
    return `Checked ${day}: the decision still holds.`;
  }
  if (replay.verdict === 'DATA_REVISED') {
    return `Checked ${day}: Bybit revised that day's data, and the decision still holds.`;
  }
  return `Checked ${day}: the decision would now be different — see the separate alert.`;
}

/** Results that traded something, fully or partly. */
const TRADED = ['FILLED', 'PARTIALLY_FILLED_CANCELLED'];

async function costFills(scope: Scope, rules: InstrumentRules): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const costed = new Set((await deps.ledger.ofTypeBetween('FILL_COST', from, to)).map((e) => String(e.payload.clientOrderId)));
  const intents = new Map(
    (await deps.ledger.ofTypeBetween('ORDER_INTENT', from, to)).map((e) => [String(e.payload.clientOrderId), e]),
  );
  for (const result of await deps.ledger.ofTypeBetween('ORDER_RESULT', from, to)) {
    const id = String(result.payload.clientOrderId);
    const { userId, cycleDate: day } = result;
    if (userId === null || day === null || costed.has(id) || !TRADED.includes(String(result.payload.status))) {
      continue;
    }
    // The backtest fills a decision at the next day's open.
    const open = candles.find((c) => c.time === cycleDateStart(day) + DAY_MS)?.open;
    const intent = intents.get(id);
    if (open === undefined || intent === undefined) {
      continue;
    }
    const fill = orderStateFrom(result.payload);
    const mid = new Decimal(String(intent.payload.midPrice));
    const market = marketCost(fill, mid, rules, DEFAULT_COSTS);
    const backtest = againstBacktestPrice(fill, open, market.feeRate);
    const source = result.payload.source === 'operator' ? 'operator' : 'exchange';
    await deps.ledger.append({
      occurredAt: at,
      userId,
      cycleDate: day,
      type: 'FILL_COST',
      payload: {
        clientOrderId: id,
        side: fill.side,
        source,
        mid,
        avgPrice: fill.avgPrice,
        open,
        feeRate: market.feeRate,
        spreadAndImpact: market.spreadAndImpact,
        againstMarket: market.againstMarket,
        againstBacktestPrice: backtest,
        assumed: market.assumed,
      },
    });
    costed.add(id);
    // Normally sent on the day of the fill already; this catches a fill settled some other way.
    if (market.tooExpensive && (await deps.alertLog.claim(`${day}:${userId}:fill-cost:${id}`, at))) {
      await deps.alerter.send(expensiveFillMessage(id, market));
    }
    const by = source === 'operator' ? ', as recorded by a person,' : '';
    const sentences = check.byUser.get(userId) ?? [];
    sentences.push(
      `The ${day} ${fill.side === 'BUY' ? 'buy' : 'sell'}${by} cost ${percent(backtest)} against the backtest's price; ` +
        `the backtest assumes ${percent(market.assumed)}.`,
    );
    check.byUser.set(userId, sentences);
  }
}
