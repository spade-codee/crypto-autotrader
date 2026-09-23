import Decimal from 'decimal.js';
import { formatDuration } from '../engine/cycle.js';
import { cycleDate } from '../engine/cycleDate.js';
import { midPrice } from '../market/orderBook.js';
import type { InstrumentRules } from '../market/types.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const account = await engine.accounts.get(userId);
    if (account === null) {
      console.error(`There is no account for "${userId}". Run npm run paper:init first.`);
      return 1;
    }
    const today = cycleDate(Date.now());
    console.log(`Account "${userId}": ${account.status}${account.reason === null ? '' : ` (${account.reason})`}`);
    console.log(`Kill switch: ${engine.deps.killSwitch.isOn() ? 'ON, so nothing trades' : 'off'}`);

    let price: Decimal | null = null;
    try {
      price = midPrice(await engine.market.getOrderBook(SYMBOL));
    } catch {
      // Shown as unavailable below; status must still work when Bybit does not.
    }
    let value = new Decimal(0);
    for (const balance of await engine.paperAccount(userId).getBalances()) {
      console.log(`  ${balance.coin.padEnd(6)} ${balance.walletBalance.toFixed()}`);
      if (balance.coin === 'USDT') {
        value = value.plus(balance.walletBalance);
      } else if (balance.coin === 'BTC' && price !== null) {
        value = value.plus(balance.walletBalance.times(price));
      }
    }
    console.log(price === null ? 'Value: unavailable, because the price could not be read' : `Value: ${value.toFixed(2)} USDT, with BTC at ${price.toFixed(2)}`);

    const signal = await engine.ledger.signalFor(today);
    console.log(signal === null ? `No signal recorded for ${today} yet.` : `Signal for ${today}: ${String(signal.payload.target)}`);
    const run = await engine.runs.get(today, userId);
    console.log(
      run === null
        ? `No run for ${today} yet.`
        : `Run for ${today}: ${run.status}${run.late ? ', late' : ''}, ${run.attempts} attempt(s)${run.lastError === null ? '' : `. Last error: ${run.lastError}`}`,
    );

    const outstanding = await engine.ledger.outstandingIntents(userId);
    if (outstanding.length === 0) {
      console.log('No order is waiting for an answer.');
    } else {
      let rules: InstrumentRules | null = null;
      try {
        rules = await engine.market.getInstrumentRules(SYMBOL);
      } catch {
        // The coins go unnamed below; the orders are still listed.
      }
      const coin = (name: string | undefined) => (name === undefined ? '' : ` ${name}`);
      console.log('Orders waiting for an answer:');
      for (const intent of outstanding) {
        const what =
          intent.payload.side === 'BUY'
            ? `buy with up to ${String(intent.payload.quoteAmount)}${coin(rules?.quoteCoin)}`
            : `sell ${String(intent.payload.baseQty)}${coin(rules?.baseCoin)}`;
        const age = formatDuration(Date.now() - intent.occurredAt.getTime());
        console.log(`  ${String(intent.payload.clientOrderId)}  ${what}, for ${intent.cycleDate ?? 'no day'}, sent ${age} ago`);
      }
      console.log('Check them on the exchange, then record what you find with npm run order:record.');
    }
    return 0;
  } finally {
    await engine.close();
  }
});
