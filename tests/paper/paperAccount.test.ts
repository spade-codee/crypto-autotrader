import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { MarketOrderRequest, OrderState } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { PaperAccount } from '../../src/paper/paperAccount.js';
import { AccountStates } from '../../src/state/accountState.js';
import { useTestDatabase } from '../helpers/database.js';
import { FakeMarket } from '../helpers/fakeMarket.js';
import { bookAround } from '../helpers/market.js';

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

  it('fills what the book can take and cancels the rest', async () => {
    const { account, market } = await open();
    market.book = bookAround('85000', '0.001');
    const state = await account.placeMarketOrder(buy('o1', '850'));
    expect(plain(state)).toMatchObject({ status: 'PARTIALLY_FILLED_CANCELLED', filledBaseQty: '0.001' });
    expect(await holding(account, 'BTC')).toBe('0.000999');
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
