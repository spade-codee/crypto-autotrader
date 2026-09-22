import Decimal from 'decimal.js';
import { buildPaperReport, formatPaperReport } from '../app/paperReport.js';
import { midPrice } from '../market/orderBook.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const balances = await engine.paperAccount(userId).getBalances();
    const coin = (name: string) => balances.find((b) => b.coin === name)?.walletBalance ?? new Decimal(0);
    const report = buildPaperReport({
      userId,
      events: await engine.ledger.forUser(userId),
      signals: await engine.ledger.ofType('SIGNAL', null),
      holdings: { base: coin('BTC'), quote: coin('USDT') },
      price: midPrice(await engine.market.getOrderBook(SYMBOL)),
      candles: await engine.market.getClosedDailyCandles(SYMBOL, 1000, Date.now()),
      strategy: engine.deps.strategy,
      costs: { feeRate: engine.config.paperFeeRate, slippageRate: new Decimal('0.0001') },
    });
    console.log(formatPaperReport(report));
    return report.tradesMatch && report.signalMismatches.length === 0 ? 0 : 1;
  } finally {
    await engine.close();
  }
});
