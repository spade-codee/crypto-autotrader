import { parseArgs } from 'node:util';
import Decimal from 'decimal.js';
import { PaperAccount } from '../paper/paperAccount.js';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { usdt: { type: 'string', default: '1000' } } });
  const text = String(values.usdt);
  let usdt: Decimal;
  try {
    usdt = new Decimal(text);
  } catch {
    throw new Error(`--usdt must be a number, not "${text}"`);
  }
  if (!usdt.isFinite() || usdt.lte(0)) {
    throw new Error(`--usdt must be above zero, not "${text}"`);
  }
  const engine = await openEngine();
  try {
    await PaperAccount.open(engine.db, {
      userId: engine.config.userId,
      baseCoin: 'BTC',
      quoteCoin: 'USDT',
      startingQuote: usdt,
      at: new Date(),
    });
    console.log(`Opened a paper account for "${engine.config.userId}" with ${usdt.toFixed()} USDT.`);
    return 0;
  } finally {
    await engine.close();
  }
});
