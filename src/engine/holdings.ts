import Decimal from 'decimal.js';
import type { CoinBalance } from '../exchange/account.js';
import type { InstrumentRules } from '../market/types.js';

/** One coin seen two ways: what can be traded, and what the account is exposed to. */
export type CoinHolding = { available: Decimal; total: Decimal; locked: Decimal };
export type Holdings = { base: CoinHolding; quote: CoinHolding };

const ZERO = new Decimal(0);

function holdingOf(balances: CoinBalance[], coin: string): CoinHolding {
  const balance = balances.find((b) => b.coin === coin);
  if (balance === undefined) {
    return { available: ZERO, total: ZERO, locked: ZERO };
  }
  return {
    available: Decimal.max(ZERO, balance.walletBalance.minus(balance.locked)),
    total: balance.walletBalance,
    locked: balance.locked,
  };
}

/** The pair's two coins. Every other coin is ignored: the strategy neither trades nor values it. */
export function holdingsFor(balances: CoinBalance[], rules: InstrumentRules): Holdings {
  return { base: holdingOf(balances, rules.baseCoin), quote: holdingOf(balances, rules.quoteCoin) };
}

/** Coins with borrowed funds. The engine never trades while anything is borrowed. */
export function borrowedCoins(balances: CoinBalance[]): string[] {
  return balances.filter((b) => b.borrowAmount.gt(0)).map((b) => b.coin);
}

/** The pair's coins with funds locked — in a dedicated account, by an order the engine did not place. */
export function lockedCoins(holdings: Holdings, rules: InstrumentRules): string[] {
  const coins: string[] = [];
  if (holdings.base.locked.gt(0)) {
    coins.push(rules.baseCoin);
  }
  if (holdings.quote.locked.gt(0)) {
    coins.push(rules.quoteCoin);
  }
  return coins;
}

/** Account value in the quote coin, from totals. */
export function accountValue(holdings: Holdings, price: Decimal): Decimal {
  return holdings.quote.total.plus(holdings.base.total.times(price));
}
