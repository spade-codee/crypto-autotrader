import Decimal from 'decimal.js';

/** Arithmetic mean. Throws on an empty list — a NaN here would propagate silently. */
export function mean(values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error('mean requires at least one value');
  }
  const total = values.reduce((acc, v) => acc.plus(v), new Decimal(0));
  return total.div(values.length);
}
