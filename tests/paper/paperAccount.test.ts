import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { MarketOrderRequest, OrderState } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { PaperAccount } from '../../src/paper/paperAccount.js';
import { AccountStates } from '../../src/state/accountState.js';
import { useTestDatabase } from '../helpers/database.js';
import { FakeMarket } from '../helpers/fakeMarket.js';
import { bookAround, RULES } from '../helpers/market.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');
const FEE = new Decimal('0.001');

async function open(userId = 'founder', usdt = '1000') {
  // bookAround('85000'): asks at 85,008.5 and bids at 84,991.5, five BTC deep.
  const market = new FakeMarket('85000');
  await PaperAccount.open(database(), {
    userId,
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    startingQuote: new Decimal(usdt),
    at: AT,
  });
  return { account: new PaperAccount({ db: database(), userId, market, feeRate: FEE }), market };
}

const buy = (id: string, usdt: string): MarketOrderRequest => ({
  clientOrderId: id,
  symbol: 'BTCUSDT',
  side: 'BUY',
  quoteAmount: new Decimal(usdt),
});
const sell = (id: string, btc: string): MarketOrderRequest => ({
  clientOrderId: id,
  symbol: 'BTCUSDT',
  side: 'SELL',
  baseQty: new Decimal(btc),
});

async function holding(account: PaperAccount, coin: string): Promise<string> {
  return (await account.getBalances()).find((b) => b.coin === coin)!.walletBalance.toFixed();
}

/** An order state as plain text, so comparisons never depend on Decimal internals. */
const plain = (state: OrderState) => ({
  ...state,
  filledBaseQty: state.filledBaseQty.toFixed(),
  filledQuoteAmount: state.filledQuoteAmount.toFixed(),
  avgPrice: state.avgPrice?.toFixed() ?? null,
  fee: state.fee.toFixed(),
});

describe('PaperAccount.open', () => {
  it('creates the balances, an active account, and an ACCOUNT_OPENED event', async () => {
    const { account } = await open();
    expect(await holding(account, 'USDT')).toBe('1000');
    expect(await holding(account, 'BTC')).toBe('0');
    expect((await new AccountStates(database()).get('founder'))?.status).toBe('active');
    const [opened] = await new Ledger(database()).ofType('ACCOUNT_OPENED', 'founder');
    expect(opened?.payload).toEqual({ mode: 'paper', balances: { USDT: '1000', BTC: '0' } });
  });

  it('refuses to open a second account for the same user', async () => {
    await open();
    await expect(open()).rejects.toThrow('already has an account');
  });
});

describe('placing orders', () => {
  it('fills a buy at the ask and charges the fee in BTC', async () => {
    const { account } = await open();
    // 850.085 / 85,008.5 is exactly 0.01 BTC.
    const state = await account.placeMarketOrder(buy('o1', '850.085'));
    expect(plain(state)).toMatchObject({
      status: 'FILLED',
      filledBaseQty: '0.01',
      filledQuoteAmount: '850.085',
      avgPrice: '85008.5',
      fee: '0.00001',
      feeCoin: 'BTC',
    });
    expect(await holding(account, 'BTC')).toBe('0.00999');
    expect(await holding(account, 'USDT')).toBe('149.915');
  });

  it('fills a sell at the bid and charges the fee in USDT', async () => {
    const { account } = await open();
    await account.placeMarketOrder(buy('o1', '850.085'));
    const state = await account.placeMarketOrder(sell('o2', '0.009'));
    // 0.009 × 84,991.5 = 764.9235, less a 0.1% fee of 0.7649235.
    expect(plain(state)).toMatchObject({ status: 'FILLED', filledQuoteAmount: '764.9235', fee: '0.7649235', feeCoin: 'USDT' });
    expect(await holding(account, 'BTC')).toBe('0.00099');
    expect(await holding(account, 'USDT')).toBe('914.0735765');
  });

  it('refuses a repeated client order ID and leaves the original untouched', async () => {
    const { account } = await open();
    const first = await account.placeMarketOrder(buy('o1', '100'));
    const usdtAfterFirst = await holding(account, 'USDT');
    const repeat = await account.placeMarketOrder(buy('o1', '100'));
    expect(repeat).toMatchObject({ status: 'REJECTED', rejectReason: 'duplicate client order ID' });
    const lookup = await account.getOrder('o1');
    expect(lookup.kind === 'FOUND' && plain(lookup.state)).toEqual(plain(first));
    expect(await holding(account, 'USDT')).toBe(usdtAfterFirst);
  });

  it('rejects, and records, an order below the minimum', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '4'))).rejectReason).toContain('minimum');
    const lookup = await account.getOrder('o1');
    expect(lookup.kind === 'FOUND' && lookup.state.status).toBe('REJECTED');
    expect(await holding(account, 'USDT')).toBe('1000');
  });

  it('rejects an order larger than the balance', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '2000'))).rejectReason).toBe('insufficient USDT');
  });

  it('rejects an amount with more decimal places than the exchange allows', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '10.00000001'))).rejectReason).toContain('decimal places');
  });

  it('rejects a buy whose fill would exceed the maximum market order, changing nothing', async () => {
    const { account, market } = await open();
    market.rules = { ...RULES, maxMarketOrderQty: new Decimal('0.001') };
    // 850.085 USDT at 85,008.5 would buy 0.01 BTC, ten times the maximum.
    const state = await account.placeMarketOrder(buy('o1', '850.085'));
    expect(state).toMatchObject({ status: 'REJECTED', rejectReason: 'above the maximum market order of 0.001 BTC' });
    expect(await holding(account, 'USDT')).toBe('1000');
    expect(await holding(account, 'BTC')).toBe('0');
    const lookup = await account.getOrder('o1');
    expect(lookup.kind === 'FOUND' && lookup.state.status).toBe('REJECTED');
  });

  it('rejects a sell worth less than the minimum order value, changing nothing', async () => {
    const { account } = await open();
    await account.placeMarketOrder(buy('o1', '850.085'));
    // 0.000001 BTC at a bid of 84,991.5 is worth 0.0849915 USDT; the minimum is 5.
    const state = await account.placeMarketOrder(sell('o2', '0.000001'));
    expect(state).toMatchObject({ status: 'REJECTED', rejectReason: 'below the minimum order value of 5 USDT' });
    expect(await holding(account, 'BTC')).toBe('0.00999');
    expect(await holding(account, 'USDT')).toBe('149.915');
  });

  it('rejects a buy one step over the maximum market order, and fills one of exactly the maximum', async () => {
    const { account, market } = await open();
    market.rules = { ...RULES, maxMarketOrderQty: new Decimal('0.01') };
    // At an ask of 85,008.5, 850.1700085 USDT would buy 0.010001 BTC: one step over.
    expect((await account.placeMarketOrder(buy('o1', '850.1700085'))).rejectReason).toBe(
      'above the maximum market order of 0.01 BTC',
    );
    expect(await holding(account, 'USDT')).toBe('1000');
    // 850.085 USDT buys exactly 0.01 BTC: the maximum itself is allowed.
    expect((await account.placeMarketOrder(buy('o2', '850.085'))).status).toBe('FILLED');
  });

  it('fills a sell worth exactly the minimum order value, and rejects one worth less', async () => {
    const { account, market } = await open();
    market.book = {
      symbol: 'BTCUSDT',
      time: 0,
      asks: [{ price: new Decimal('50010'), qty: new Decimal('5') }],
      bids: [{ price: new Decimal('50000'), qty: new Decimal('5') }],
    };
    await account.placeMarketOrder(buy('o1', '100'));
    const btcBefore = await holding(account, 'BTC');
    // 0.0001 BTC at 50,000 is worth exactly 5 USDT; 0.000099 BTC is worth 4.95.
    expect((await account.placeMarketOrder(sell('o2', '0.0001'))).status).toBe('FILLED');
    const under = await account.placeMarketOrder(sell('o3', '0.000099'));
    expect(under.rejectReason).toBe('below the minimum order value of 5 USDT');
    expect(await holding(account, 'BTC')).toBe(new Decimal(btcBefore).minus('0.0001').toFixed());
  });

  it('fills a buy of exactly the minimum quantity, and rejects one that buys less', async () => {
    const { account, market } = await open();
    market.rules = { ...RULES, minOrderQty: new Decimal('0.001') };
    // At 85,008.5: 85.0085 USDT buys exactly 0.001 BTC; 84.9 USDT buys 0.000998.
    expect((await account.placeMarketOrder(buy('o1', '85.0085'))).status).toBe('FILLED');
    const under = await account.placeMarketOrder(buy('o2', '84.9'));
    expect(under.rejectReason).toBe('below the minimum quantity of 0.001 BTC');
  });

  it('fills what the book can take and cancels the rest', async () => {
    const { account, market } = await open();
    market.book = bookAround('85000', '0.001');
    const state = await account.placeMarketOrder(buy('o1', '850'));
    expect(plain(state)).toMatchObject({ status: 'PARTIALLY_FILLED_CANCELLED', filledBaseQty: '0.001' });
    expect(await holding(account, 'BTC')).toBe('0.000999');
  });

  it('refuses to fill against a stale book, and writes nothing', async () => {
    const { account, market } = await open();
    market.bookAgeMs = 60_000;
    await expect(account.placeMarketOrder(buy('o1', '100'))).rejects.toThrow('60.0 s old');
    expect(await account.getOrder('o1')).toEqual({ kind: 'ABSENT' });
    expect(await holding(account, 'USDT')).toBe('1000');
  });

  it('refuses to fill against a book for another market, and writes nothing', async () => {
    const { account, market } = await open();
    market.book = { ...market.book, symbol: 'ETHUSDT' };
    await expect(account.placeMarketOrder(buy('o1', '100'))).rejects.toThrow('ETHUSDT, not BTCUSDT');
    expect(await account.getOrder('o1')).toEqual({ kind: 'ABSENT' });
    expect(await holding(account, 'USDT')).toBe('1000');
  });

  it('writes nothing when the market cannot be reached', async () => {
    const { account, market } = await open();
    market.fail.book = new Error('the request timed out');
    await expect(account.placeMarketOrder(buy('o1', '100'))).rejects.toThrow('timed out');
    expect(await account.getOrder('o1')).toEqual({ kind: 'ABSENT' });
    expect(await holding(account, 'USDT')).toBe('1000');
  });
});

describe('looking up orders', () => {
  it('is certain an unknown ID was never placed', async () => {
    const { account } = await open();
    expect(await account.getOrder('never-sent')).toEqual({ kind: 'ABSENT' });
  });

  it("does not show another account's orders", async () => {
    const { account: founder } = await open('founder');
    const { account: other } = await open('other');
    await other.placeMarketOrder(buy('theirs', '100'));
    expect(await founder.getOrder('theirs')).toEqual({ kind: 'ABSENT' });
  });

  it('reports no locks and no borrowing', async () => {
    const { account } = await open();
    for (const balance of await account.getBalances()) {
      expect(balance.locked.isZero() && balance.borrowAmount.isZero()).toBe(true);
    }
  });

  it('names the fix when the account does not exist', async () => {
    const market = new FakeMarket();
    const account = new PaperAccount({ db: database(), userId: 'nobody', market, feeRate: FEE });
    await expect(account.getBalances()).rejects.toThrow('paper:init');
  });
});
