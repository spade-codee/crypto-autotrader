import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DAY_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { createLiquiditySweep, VERSION_0, type SweepEvent } from '../../src/strategy/liquiditySweep.js';
import type { Candle } from '../../src/types.js';
import {
  beforeSweep,
  candle,
  confirmationCandle,
  day4,
  DAY4,
  enteringScenario,
  START,
  sweepCandle,
  zigzagDays,
} from '../helpers/liquidity.js';

/** Feeds candles in order, flat except at the given open times, and returns every event. */
function run(candles: Candle[], config = VERSION_0, notFlatAt = new Set<number>()): SweepEvent[] {
  const strategy = createLiquiditySweep(config);
  return candles.flatMap((c) => strategy.onCandle({ candle: c, flatAtOpen: !notFlatAt.has(c.time) }));
}

/** Each event as [kind, reason?] for compact expectations. */
const kinds = (events: SweepEvent[]) => events.map((e) => ('reason' in e ? [e.kind, e.reason] : [e.kind]));
const quiet = (n: number) => candle(day4(n), 110_000, 111_000, 109_000, 110_000);

describe('the liquidity sweep, version 0', () => {
  it("arms on the day's first touch that closes back above the level, and enters on a close above the reference", () => {
    const events = run(enteringScenario());
    expect(kinds(events)).toEqual([['ARMED'], ['ENTER']]);
    const [armed, enter] = events as [Extract<SweepEvent, { kind: 'ARMED' }>, Extract<SweepEvent, { kind: 'ENTER' }>];
    expect(armed.time).toBe(day4(4));
    expect([armed.level, armed.sweepLow, armed.reference, armed.stopTrigger].map(String)).toEqual([
      '105000',
      '104000',
      '114000',
      '103999.9',
    ]);
    expect(enter.time).toBe(day4(5));
    expect([enter.confirmationClose, enter.stopTrigger, enter.plannedRisk].map(String)).toEqual([
      '114500',
      '103999.9',
      '10500.1',
    ]);
  });

  it('ends the day when its first touch closes at or below the level, even if a later candle reclaims it', () => {
    const broke = candle(day4(4), 112_000, 112_200, 104_000, 104_800);
    const reclaim = candle(day4(5), 104_800, 108_000, 103_000, 107_000);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), broke, reclaim]))).toEqual([['LEVEL_BROKE']]);
  });

  it("spends the day's touch when the account is in a trade", () => {
    const later = candle(day4(6), 110_000, 111_000, 103_500, 110_500);
    const events = run(
      [...zigzagDays('up'), ...beforeSweep(), sweepCandle(), quiet(5), later],
      VERSION_0,
      new Set([day4(4)]),
    );
    expect(kinds(events)).toEqual([['NOT_ARMED', 'NOT_FLAT']]);
  });

  it('will not arm without an up structure, and spends the touch anyway', () => {
    // Falling days break their own levels on days 2 and 3; only day 4 is under test here.
    const sweep = candle(day4(0), 189_000, 189_500, 186_000, 188_000);
    const again = candle(day4(1), 188_000, 188_500, 185_000, 188_200);
    const onDay4 = run([...zigzagDays('down'), sweep, again]).filter((e) => e.time >= DAY4);
    expect(kinds(onDay4)).toEqual([['NOT_ARMED', 'STRUCTURE_NOT_UP']]);
  });

  it('will not arm without a known swing high above the sweep close', () => {
    const above = candle(day4(4), 112_000, 115_000, 104_000, 114_500);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), above]))).toEqual([['NOT_ARMED', 'NO_REFERENCE']]);
  });

  it('never takes as its reference a swing that the sweep candle itself confirms', () => {
    // 00:30 is the highest candle so far, and the sweep at 01:00 is its second candle after: the
    // swing is confirmed only at the sweep's close.
    const early = [
      candle(day4(0), 111_000, 111_500, 110_500, 111_200),
      candle(day4(1), 111_200, 111_600, 111_000, 111_400),
      candle(day4(2), 111_400, 114_000, 111_200, 112_500),
      candle(day4(3), 112_500, 112_800, 111_500, 112_000),
    ];
    const sweep = candle(day4(4), 112_000, 112_200, 104_000, 113_000);
    expect(kinds(run([...zigzagDays('up'), ...early, sweep]))).toEqual([['NOT_ARMED', 'NO_REFERENCE']]);
  });

  it('discards the setup when the sweep low breaks, even on a candle that also confirms', () => {
    const both = candle(day4(5), 110_000, 115_000, 103_500, 114_500);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), both]))).toEqual([
      ['ARMED'],
      ['DISCARDED', 'SWEEP_LOW_BROKEN'],
    ]);
  });

  it('expires after eight closes without confirmation', () => {
    const waiting = [5, 6, 7, 8, 9, 10, 11, 12].map(quiet);
    const events = run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), ...waiting]);
    expect(kinds(events)).toEqual([['ARMED'], ['DISCARDED', 'EXPIRED']]);
    expect(events[1]!.time).toBe(day4(12));
  });

  it('still confirms on the eighth close', () => {
    const waiting = [5, 6, 7, 8, 9, 10, 11].map(quiet);
    const eighth = candle(day4(12), 110_000, 115_000, 109_000, 114_500);
    const events = run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), ...waiting, eighth]);
    expect(kinds(events)).toEqual([['ARMED'], ['ENTER']]);
  });

  it('skips an entry whose stop is under 0.6% away', () => {
    const descent = [
      candle(day4(0), 111_000, 111_100, 108_900, 109_000),
      candle(day4(1), 109_000, 109_100, 106_900, 107_000),
      candle(day4(2), 107_000, 107_100, 105_200, 105_300),
      candle(day4(3), 105_300, 105_350, 105_150, 105_250),
      candle(day4(4), 105_250, 105_320, 105_200, 105_280),
      candle(day4(5), 105_280, 105_400, 105_250, 105_300),
      candle(day4(6), 105_300, 105_350, 105_150, 105_250),
      candle(day4(7), 105_250, 105_300, 105_100, 105_200),
    ];
    const sweep = candle(day4(8), 105_200, 105_300, 104_990, 105_100);
    const confirm = candle(day4(9), 105_100, 105_500, 105_050, 105_450);
    expect(kinds(run([...zigzagDays('up'), ...descent, sweep, confirm]))).toEqual([
      ['ARMED'],
      ['DISCARDED', 'STOP_TOO_CLOSE'],
    ]);
  });

  it("keeps a waiting setup across midnight, and spends the new day's first touch without arming", () => {
    // Arm at 23:30 on day 4: the level is day 3's low. Day 5's level is day 4's low, the sweep's 104k.
    const lateDay4: Candle[] = [];
    for (let n = 0; n < 90; n++) {
      lateDay4.push(candle(day4(n), 111_000, 111_300, 110_700, 111_000));
    }
    lateDay4.push(candle(day4(90), 111_000, 114_000, 110_800, 113_000));
    lateDay4.push(candle(day4(91), 113_000, 113_200, 110_900, 111_200));
    lateDay4.push(candle(day4(92), 111_200, 111_400, 110_800, 111_000));
    lateDay4.push(candle(day4(93), 111_000, 111_300, 110_700, 111_000));
    lateDay4.push(candle(day4(94), 111_000, 111_100, 104_000, 110_000));
    lateDay4.push(candle(day4(95), 110_000, 111_000, 109_000, 110_500));
    const day5 = [
      candle(day4(96), 110_500, 111_000, 103_900, 110_000),
      candle(day4(97), 110_000, 114_600, 109_000, 114_500),
    ];
    const events = run([...zigzagDays('up'), ...lateDay4, ...day5]);
    expect(kinds(events)).toEqual([['ARMED'], ['DISCARDED', 'SWEEP_LOW_BROKEN'], ['NOT_ARMED', 'SETUP_WAITING']]);
  });

  it('starts again after a missing candle, so a day with a gap sets no level', () => {
    const days = zigzagDays('up');
    const gapped = days.filter((c) => c.time !== START + 2 * DAY_MS + 40 * QUARTER_HOUR_MS);
    expect(kinds(run([...gapped, ...beforeSweep(), sweepCandle(), confirmationCandle()]))).toEqual([['RESTARTED']]);
  });

  it('refuses candles out of order', () => {
    const strategy = createLiquiditySweep(VERSION_0);
    const [first, second] = zigzagDays('up');
    strategy.onCandle({ candle: second!, flatAtOpen: true });
    expect(() => strategy.onCandle({ candle: first!, flatAtOpen: true })).toThrow('out of order');
  });

  it('places the stop by ATR in the ATR neighbour', () => {
    const candles = enteringScenario();
    const events = run(candles, { ...VERSION_0, stopAtrMultiple: new Decimal('0.25') });
    const armed = events[0] as Extract<SweepEvent, { kind: 'ARMED' }>;
    // Wilder's 14-candle ATR over every candle before the sweep, computed independently here.
    const before = candles.filter((c) => c.time < day4(4));
    let atr = new Decimal(0);
    const ranges: Decimal[] = [];
    for (let i = 0; i < before.length; i++) {
      const c = before[i]!;
      const previous = before[i - 1];
      const range =
        previous === undefined
          ? c.high.minus(c.low)
          : Decimal.max(c.high.minus(c.low), c.high.minus(previous.close).abs(), c.low.minus(previous.close).abs());
      if (ranges.length < 14) {
        ranges.push(range);
        if (ranges.length === 14) {
          atr = ranges.reduce((total, r) => total.plus(r), new Decimal(0)).div(14);
        }
      } else {
        atr = atr.times(13).plus(range).div(14);
      }
    }
    expect(armed.stopTrigger.toString()).toBe(new Decimal(104_000).minus(new Decimal('0.25').times(atr)).toString());
  });

  it('reports its structure and level', () => {
    const strategy = createLiquiditySweep(VERSION_0);
    for (const c of zigzagDays('up')) {
      strategy.onCandle({ candle: c, flatAtOpen: true });
    }
    expect(strategy.status().structureUp).toBe(true);
    strategy.onCandle({ candle: beforeSweep()[0]!, flatAtOpen: true });
    expect(strategy.status().level?.toString()).toBe('105000');
  });
});
