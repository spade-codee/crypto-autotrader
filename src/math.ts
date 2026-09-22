import Decimal from 'decimal.js';

/** Arithmetic mean. Throws on an empty list — a NaN here would propagate silently. */
export function mean(values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error('mean requires at least one value');
  }
  const total = values.reduce((acc, v) => acc.plus(v), new Decimal(0));
  return total.div(values.length);
}

/**
 * Rounds `value` down to a whole number of `step`s — the only safe direction for
 * an order amount, which must never exceed what the account holds. Uses
 * Decimal#toNearest, which divides exactly rather than to 20 significant digits.
 */
export function roundDown(value: Decimal, step: Decimal): Decimal {
  if (step.lte(0)) {
    throw new Error('roundDown needs a positive step');
  }
  if (value.isNeg()) {
    throw new Error('roundDown is only defined for amounts of zero or more');
  }
  return value.toNearest(step, Decimal.ROUND_DOWN);
}
