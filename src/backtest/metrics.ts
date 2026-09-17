import Decimal from 'decimal.js';
import type { EquityPoint, Metrics, Trade } from '../types.js';

const MS_PER_YEAR = 365 * 86_400_000;

/**
 * Sharpe is computed from daily returns with a zero risk-free rate and
 * annualised by sqrt(365). Crypto trades every day, so 365 rather than 252.
 * The risk-free rate is omitted deliberately: it would add a parameter without
 * changing which strategy ranks higher, and Phase 0 exists to rank strategies.
 */
export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: Trade[],
  initialCapital: Decimal,
): Metrics {
  if (equityCurve.length === 0) {
    throw new Error('metrics require at least one equity point');
  }

  const first = equityCurve[0]!;
  const last = equityCurve[equityCurve.length - 1]!;
  const finalEquity = last.equity;

  const totalReturn = finalEquity.minus(initialCapital).div(initialCapital);

  // CAGR. A span shorter than a day cannot be annualised meaningfully.
  const elapsedMs = last.time - first.time;
  const years = elapsedMs / MS_PER_YEAR;
  const cagr =
    years > 0
      ? new Decimal(
          Math.pow(finalEquity.div(initialCapital).toNumber(), 1 / years) - 1,
        )
      : new Decimal(0);

  // Max drawdown against the running peak.
  let peak = first.equity;
  let maxDrawdown = new Decimal(0);
  for (const point of equityCurve) {
    if (point.equity.gt(peak)) {
      peak = point.equity;
    }
    if (peak.gt(0)) {
      const drawdown = peak.minus(point.equity).div(peak);
      if (drawdown.gt(maxDrawdown)) {
        maxDrawdown = drawdown;
      }
    }
  }

  // Sharpe from daily returns.
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    if (prev.gt(0)) {
      dailyReturns.push(equityCurve[i]!.equity.minus(prev).div(prev).toNumber());
    }
  }
  let sharpe = new Decimal(0);
  if (dailyReturns.length > 1) {
    const avg = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((acc, r) => acc + (r - avg) ** 2, 0) / (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpe = new Decimal((avg / stdDev) * Math.sqrt(365));
    }
  }

  // Exposure: fraction of marked days holding the asset.
  const longDays = equityCurve.filter((p) => p.state === 'LONG').length;
  const exposure = new Decimal(longDays).div(equityCurve.length);

  // Win rate over completed BUY -> SELL round trips, judged NET of fees. A trade
  // whose price gain is smaller than its fees lost money, and counting it as a
  // win would flatter a strategy that trades often — exactly the bias this
  // backtest exists to catch.
  let wins = 0;
  let roundTrips = 0;
  let entry: Trade | null = null;
  for (const trade of trades) {
    if (trade.side === 'BUY') {
      entry = trade;
    } else if (entry !== null) {
      roundTrips++;
      const cost = entry.price.times(entry.quantity).plus(entry.fee);
      const proceeds = trade.price.times(trade.quantity).minus(trade.fee);
      if (proceeds.gt(cost)) {
        wins++;
      }
      entry = null;
    }
  }
  const winRate = roundTrips > 0 ? new Decimal(wins).div(roundTrips) : new Decimal(0);

  const totalFees = trades.reduce((acc, t) => acc.plus(t.fee), new Decimal(0));

  return {
    initialCapital,
    finalEquity,
    totalReturn,
    cagr,
    maxDrawdown,
    sharpe,
    tradeCount: trades.length,
    exposure,
    winRate,
    totalFees,
  };
}
