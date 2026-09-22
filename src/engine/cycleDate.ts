export const DAY_MS = 86_400_000;

/** A run that completes more than this long after its candle closed is recorded as late. */
export const LATE_AFTER_MS = 30 * 60_000;

/** YYYY-MM-DD for an epoch-millisecond time, in UTC. */
export function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * The cycle date at `now`: the open date of the most recently closed daily
 * candle. Bybit's daily candles open and close at midnight UTC, so from the
 * instant a day ends until the next midnight, that day is the one to act on.
 */
export function cycleDate(now: number): string {
  return isoDate(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS);
}

/** Epoch milliseconds of a cycle date's midnight UTC. Rejects anything but a real YYYY-MM-DD date. */
export function cycleDateStart(date: string): number {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time) || isoDate(time) !== date) {
    throw new Error(`"${date}" is not a valid cycle date`);
  }
  return time;
}

/** When a cycle date's run is due: the moment its candle closes. */
export function dueAt(date: string): number {
  return cycleDateStart(date) + DAY_MS;
}

export function isLate(date: string, completedAt: number): boolean {
  return completedAt - dueAt(date) > LATE_AFTER_MS;
}
