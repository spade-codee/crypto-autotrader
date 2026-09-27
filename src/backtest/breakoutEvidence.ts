import Decimal from 'decimal.js';
import type { EquityPoint, Trade } from '../types.js';

/** The year CAGR uses: 365 days. */
const YEAR_MS = 365 * 86_400_000;

export type RoundTrip = { entry: Trade; exit: Trade; netReturn: Decimal };

/** Completed buy-then-sell pairs, each judged net of both fees, as the win rate judges them. */
export function roundTrips(trades: Trade[]): RoundTrip[] {
  const trips: RoundTrip[] = [];
  let entry: Trade | null = null;
  for (const trade of trades) {
    if (trade.side === 'BUY') {
      entry = trade;
    } else if (entry !== null) {
      const cost = entry.price.times(entry.quantity).plus(entry.fee);
      const proceeds = trade.price.times(trade.quantity).minus(trade.fee);
      trips.push({ entry, exit: trade, netReturn: proceeds.minus(cost).div(cost) });
      entry = null;
    }
  }
  return trips;
}

export type TradeStats = {
  roundTrips: number;
  perYear: Decimal;
  longestLosingRun: number;
  averageLoss: Decimal | null;
};

/** Round trips a year, the longest run of losing ones, and the average losing one. A trip that made nothing lost. */
export function tradeStats(trades: Trade[], years: Decimal): TradeStats {
  const trips = roundTrips(trades);
  const losses: Decimal[] = [];
  let run = 0;
  let longest = 0;
  for (const trip of trips) {
    if (trip.netReturn.lte(0)) {
      losses.push(trip.netReturn);
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return {
    roundTrips: trips.length,
    perYear: new Decimal(trips.length).div(years),
    longestLosingRun: longest,
    averageLoss:
      losses.length === 0 ? null : losses.reduce((sum, loss) => sum.plus(loss), new Decimal(0)).div(losses.length),
  };
}

/** A run's length from its first mark to its last, in the years CAGR uses. */
export function yearsOf(curve: EquityPoint[]): Decimal {
  return new Decimal(curve[curve.length - 1]!.time - curve[0]!.time).div(YEAR_MS);
}

export type Fall = { depth: Decimal; peak: number; trough: number };

/** The deepest fall from a running peak, as the maximum drawdown measures it, with when the peak and trough were marked. */
export function worstFall(curve: EquityPoint[]): Fall {
  if (curve.length === 0) {
    throw new Error('a worst fall needs at least one marked day');
  }
  let peak = curve[0]!;
  let worst: Fall = { depth: new Decimal(0), peak: peak.time, trough: peak.time };
  for (const point of curve) {
    if (point.equity.gt(peak.equity)) {
      peak = point;
    }
    if (peak.equity.gt(0)) {
      const depth = peak.equity.minus(point.equity).div(peak.equity);
      if (depth.gt(worst.depth)) {
        worst = { depth, peak: peak.time, trough: point.time };
      }
    }
  }
  return worst;
}

function requireSameDates(a: EquityPoint[], b: EquityPoint[]): void {
  if (a.length !== b.length || a.some((point, i) => point.time !== b[i]!.time)) {
    throw new Error('the two runs must cover identical dates');
  }
}

/** The share of days on which two runs held the same position. */
export function sameDays(a: EquityPoint[], b: EquityPoint[]): Decimal {
  requireSameDates(a, b);
  const same = a.filter((point, i) => point.state === b[i]!.state).length;
  return new Decimal(same).div(a.length);
}

const dailyReturns = (curve: EquityPoint[]): Decimal[] =>
  curve.slice(1).map((point, i) => point.equity.div(curve[i]!.equity).minus(1));

/** The correlation of two runs' daily returns, or null when there are too few or either never moves. */
export function returnCorrelation(a: EquityPoint[], b: EquityPoint[]): Decimal | null {
  requireSameDates(a, b);
  const x = dailyReturns(a);
  const y = dailyReturns(b);
  if (x.length < 2) {
    return null;
  }
  const mean = (values: Decimal[]) => values.reduce((sum, v) => sum.plus(v), new Decimal(0)).div(values.length);
  const meanX = mean(x);
  const meanY = mean(y);
  let sxy = new Decimal(0);
  let sxx = new Decimal(0);
  let syy = new Decimal(0);
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]!.minus(meanX);
    const dy = y[i]!.minus(meanY);
    sxy = sxy.plus(dx.times(dy));
    sxx = sxx.plus(dx.times(dx));
    syy = syy.plus(dy.times(dy));
  }
  if (sxx.isZero() || syy.isZero()) {
    return null;
  }
  return sxy.div(sxx.times(syy).sqrt());
}

export type Stretch = { return: Decimal; worstFall: Decimal };

/** A run's return from the close of `from` to the close of `to`, and its worst fall between them. */
export function stretch(curve: EquityPoint[], from: number, to: number): Stretch {
  const inside = curve.filter((point) => point.time >= from && point.time <= to);
  if (inside.length === 0 || inside[0]!.time !== from || inside[inside.length - 1]!.time !== to) {
    throw new Error('a stretch must start and end on marked days');
  }
  return {
    return: inside[inside.length - 1]!.equity.div(inside[0]!.equity).minus(1),
    worstFall: worstFall(inside).depth,
  };
}
