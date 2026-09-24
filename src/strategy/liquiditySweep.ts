import Decimal from 'decimal.js';
import type { Candle } from '../types.js';
import { combine, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from './bars.js';
import { structureIsUp } from './structure.js';
import { swingsAt, type Swing } from './swings.js';

/**
 * The liquidity-sweep research candidate, version 0: rules R1 to R13 of
 * docs/research/liquidity-sweep-candidate.md (branch product-prototype, commit
 * a079748). Research only; nothing trades it.
 *
 * Fed completed 15-minute candles one at a time, oldest first, it says what it
 * saw: a level broken, a setup armed or discarded, an entry to make at the next
 * open. It keeps its own history, rebuilt by replaying candles, so the same
 * candles always give the same events. Exits (R9) and size (R10) are the
 * executor's; their settings live here with the rest of the version.
 */

export type LiquiditySweepConfig = {
  /** R2: candles on each side of a swing, on both timeframes. */
  swingSize: number;
  /** R7: closes a setup waits for confirmation. */
  waitCandles: number;
  /** R8: skip an entry whose planned risk is below this share of the confirmation close. */
  minRiskFraction: Decimal;
  /** R9: how far below the sweep low the stop triggers: one exchange price step. */
  priceStep: Decimal;
  /** A neighbour only: place the stop this many 14-candle ATRs below the sweep low instead. */
  stopAtrMultiple: Decimal | null;
  /** R9: the target, in multiples of the entry fill's distance to its stop. */
  targetMultiple: Decimal;
  /** R9: completed candles, counting the entry candle, before the time exit. */
  timeLimitCandles: number;
};

/** Version 0, fixed before any data was examined. */
export const VERSION_0: LiquiditySweepConfig = {
  swingSize: 2,
  waitCandles: 8,
  minRiskFraction: new Decimal('0.006'),
  priceStep: new Decimal('0.1'),
  stopAtrMultiple: null,
  targetMultiple: new Decimal(2),
  timeLimitCandles: 32,
};

export type NotArmed = 'NOT_FLAT' | 'SETUP_WAITING' | 'STRUCTURE_NOT_UP' | 'NO_REFERENCE' | 'NO_ATR';
export type Discarded = 'SWEEP_LOW_BROKEN' | 'STRUCTURE_TURNED' | 'EXPIRED' | 'STOP_TOO_CLOSE';

export type SweepEvent =
  | { kind: 'RESTARTED'; time: number }
  | { kind: 'LEVEL_BROKE'; time: number; level: Decimal }
  | { kind: 'NOT_ARMED'; time: number; reason: NotArmed }
  | { kind: 'ARMED'; time: number; level: Decimal; sweepLow: Decimal; reference: Decimal; stopTrigger: Decimal }
  | { kind: 'DISCARDED'; time: number; reason: Discarded }
  | { kind: 'ENTER'; time: number; confirmationClose: Decimal; stopTrigger: Decimal; plannedRisk: Decimal };

export type EnterEvent = Extract<SweepEvent, { kind: 'ENTER' }>;

export type CandleInput = {
  candle: Candle;
  /** The account held no trade once this candle's opening actions were done (R13). */
  flatAtOpen: boolean;
};

export type SweepStatus = { structureUp: boolean; level: Decimal | null };

export type LiquiditySweep = {
  onCandle(input: CandleInput): SweepEvent[];
  /** Where things stand after the last candle: where a placebo may enter at the next open. */
  status(): SweepStatus;
};

const ATR_PERIOD = 14;
const CANDLES_PER_DAY = DAY_MS / QUARTER_HOUR_MS;
const CANDLES_PER_FOUR_HOURS = FOUR_HOURS_MS / QUARTER_HOUR_MS;

type Setup = { level: Decimal; sweepLow: Decimal; reference: Decimal; stopTrigger: Decimal; closes: number };

type History = {
  last: Candle | null;
  recent15: Candle[];
  /** Known 15-minute swing highs, each lower than the one before: no other can be the most recent one above a price. */
  highs15: Swing[];
  block4: Candle[];
  recent4: Candle[];
  highs4: Decimal[];
  lows4: Decimal[];
  close4: Decimal | null;
  dayLow: Decimal | null;
  dayCount: number;
  level: Decimal | null;
  touched: boolean;
  setup: Setup | null;
  ranges: Decimal[];
  atr: Decimal | null;
};

const fresh = (): History => ({
  last: null,
  recent15: [],
  highs15: [],
  block4: [],
  recent4: [],
  highs4: [],
  lows4: [],
  close4: null,
  dayLow: null,
  dayCount: 0,
  level: null,
  touched: false,
  setup: null,
  ranges: [],
  atr: null,
});

export function createLiquiditySweep(config: LiquiditySweepConfig): LiquiditySweep {
  const width = 2 * config.swingSize + 1;
  let h = fresh();
  const structureUp = () => structureIsUp(h.highs4, h.lows4, h.close4);

  return {
    status: () => ({ structureUp: structureUp(), level: h.level }),

    onCandle({ candle, flatAtOpen }: CandleInput): SweepEvent[] {
      const events: SweepEvent[] = [];
      if (candle.time % QUARTER_HOUR_MS !== 0) {
        throw new Error(`not on a 15-minute boundary: ${candle.time}`);
      }
      if (h.last !== null && candle.time <= h.last.time) {
        throw new Error(`candles out of order at ${candle.time}`);
      }
      if (h.last !== null && candle.time !== h.last.time + QUARTER_HOUR_MS) {
        // R13: after a missing candle every level and swing is in doubt, so start again.
        h = fresh();
        events.push({ kind: 'RESTARTED', time: candle.time });
      }
      const previousClose = h.last?.close ?? null;

      // R4: at 00:00 UTC, yesterday's low becomes the level if yesterday was complete.
      if (candle.time % DAY_MS === 0) {
        h.level = h.dayCount === CANDLES_PER_DAY ? h.dayLow : null;
        h.dayLow = null;
        h.dayCount = 0;
        h.touched = false;
      }
      h.dayLow = h.dayLow === null || candle.low.lt(h.dayLow) ? candle.low : h.dayLow;
      h.dayCount += 1;

      // R1–R3: a 4-hour candle completing at this close, and any swing it confirms.
      h.block4.push(candle);
      if ((candle.time + QUARTER_HOUR_MS) % FOUR_HOURS_MS === 0) {
        if (h.block4.length === CANDLES_PER_FOUR_HOURS) {
          const four = combine(h.block4);
          h.close4 = four.close;
          h.recent4 = [...h.recent4, four].slice(-width);
          if (h.recent4.length === width) {
            for (const swing of swingsAt(h.recent4, FOUR_HOURS_MS)) {
              if (swing.kind === 'HIGH') {
                h.highs4 = [...h.highs4, swing.price].slice(-2);
              } else {
                h.lows4 = [...h.lows4, swing.price].slice(-2);
              }
            }
          }
        }
        h.block4 = [];
      }
      const up = structureUp();

      // R7: a setup waiting for confirmation. Discards come before the confirmation.
      const waiting = h.setup;
      if (waiting !== null) {
        waiting.closes += 1;
        h.setup = null;
        if (candle.low.lt(waiting.sweepLow)) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'SWEEP_LOW_BROKEN' });
        } else if (!up) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'STRUCTURE_TURNED' });
        } else if (candle.close.gt(waiting.reference)) {
          const plannedRisk = candle.close.minus(waiting.stopTrigger);
          if (plannedRisk.lt(candle.close.times(config.minRiskFraction))) {
            events.push({ kind: 'DISCARDED', time: candle.time, reason: 'STOP_TOO_CLOSE' });
          } else {
            events.push({
              kind: 'ENTER',
              time: candle.time,
              confirmationClose: candle.close,
              stopTrigger: waiting.stopTrigger,
              plannedRisk,
            });
          }
        } else if (waiting.closes >= config.waitCandles) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'EXPIRED' });
        } else {
          h.setup = waiting;
        }
      }

      // R5, R6: the day's first touch of the level, spent whether or not it arms.
      if (h.level !== null && !h.touched && candle.low.lt(h.level)) {
        h.touched = true;
        if (candle.close.lte(h.level)) {
          events.push({ kind: 'LEVEL_BROKE', time: candle.time, level: h.level });
        } else {
          const reference = [...h.highs15].reverse().find((swing) => swing.price.gt(candle.close));
          const reason: NotArmed | null = !flatAtOpen
            ? 'NOT_FLAT'
            : waiting !== null
              ? 'SETUP_WAITING'
              : !up
                ? 'STRUCTURE_NOT_UP'
                : reference === undefined
                  ? 'NO_REFERENCE'
                  : config.stopAtrMultiple !== null && h.atr === null
                    ? 'NO_ATR'
                    : null;
          if (reason !== null) {
            events.push({ kind: 'NOT_ARMED', time: candle.time, reason });
          } else {
            const buffer = config.stopAtrMultiple === null ? config.priceStep : config.stopAtrMultiple.times(h.atr!);
            const setup: Setup = {
              level: h.level,
              sweepLow: candle.low,
              reference: reference!.price,
              stopTrigger: candle.low.minus(buffer),
              closes: 0,
            };
            h.setup = setup;
            events.push({
              kind: 'ARMED',
              time: candle.time,
              level: setup.level,
              sweepLow: setup.sweepLow,
              reference: setup.reference,
              stopTrigger: setup.stopTrigger,
            });
          }
        }
      }

      // Last, so that a swing this close confirms was not known when this candle opened (R6).
      h.recent15 = [...h.recent15, candle].slice(-width);
      if (h.recent15.length === width) {
        for (const swing of swingsAt(h.recent15, QUARTER_HOUR_MS)) {
          if (swing.kind === 'HIGH') {
            h.highs15 = [...h.highs15.filter((older) => older.price.gt(swing.price)), swing];
          }
        }
      }
      updateAtr(h, candle, previousClose);
      h.last = candle;
      return events;
    },
  };
}

/** Wilder's 14-candle average true range, for the ATR neighbour. */
function updateAtr(h: History, candle: Candle, previousClose: Decimal | null): void {
  const range = candle.high.minus(candle.low);
  const trueRange =
    previousClose === null
      ? range
      : Decimal.max(range, candle.high.minus(previousClose).abs(), candle.low.minus(previousClose).abs());
  if (h.atr === null) {
    h.ranges.push(trueRange);
    if (h.ranges.length === ATR_PERIOD) {
      h.atr = h.ranges.reduce((total, r) => total.plus(r), new Decimal(0)).div(ATR_PERIOD);
    }
  } else {
    h.atr = h.atr.times(ATR_PERIOD - 1).plus(trueRange).div(ATR_PERIOD);
  }
}
