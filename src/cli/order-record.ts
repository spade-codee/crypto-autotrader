import Decimal from 'decimal.js';
import { parseArgs } from 'node:util';
import { recordOrderOutcome, type Outcome } from '../app/recordOrderOutcome.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

const STATUSES = new Map<string, Outcome['status']>([
  ['not-placed', 'NOT_PLACED'],
  ['rejected', 'REJECTED'],
  ['filled', 'FILLED'],
  ['partly-filled', 'PARTIALLY_FILLED_CANCELLED'],
]);

const USAGE = `Record what you found for an order the exchange cannot show:
  npm run order:record -- --order <id> --status not-placed --reason "what you checked"
  npm run order:record -- --order <id> --status rejected --reason "..."
  npm run order:record -- --order <id> --status filled --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
  npm run order:record -- --order <id> --status partly-filled --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
npm run status lists the orders waiting for an answer.`;

function amount(value: string | undefined, flag: string): Decimal {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${flag} is needed for this status`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value.trim());
  } catch {
    throw new Error(`${flag} must be a number, not "${value}"`);
  }
  if (!parsed.isFinite()) {
    throw new Error(`${flag} must be a number, not "${value}"`);
  }
  return parsed;
}

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      order: { type: 'string' },
      status: { type: 'string' },
      reason: { type: 'string' },
      base: { type: 'string' },
      quote: { type: 'string' },
      fee: { type: 'string' },
      'fee-coin': { type: 'string' },
    },
  });
  const clientOrderId = values.order?.trim() ?? '';
  const status = STATUSES.get(values.status?.trim() ?? '');
  const evidence = values.reason?.trim() ?? '';
  if (clientOrderId === '' || status === undefined || evidence === '') {
    console.error(USAGE);
    return 1;
  }
  const outcome: Outcome =
    status === 'NOT_PLACED' || status === 'REJECTED'
      ? { status }
      : {
          status,
          base: amount(values.base, '--base'),
          quote: amount(values.quote, '--quote'),
          fee: amount(values.fee, '--fee'),
          feeCoin: values['fee-coin']?.trim().toUpperCase() ?? '',
        };

  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const result = await recordOrderOutcome(
      {
        ledger: engine.ledger,
        account: engine.deps.accountFor(userId),
        rules: await engine.market.getInstrumentRules(SYMBOL),
        now: () => new Date(),
      },
      { userId, clientOrderId, outcome, evidence },
    );
    if (result.status === 'refused') {
      console.error(`Nothing was recorded: ${result.reason}.`);
      return 1;
    }
    console.log(
      `Recorded ${values.status?.trim()} for order ${clientOrderId}${result.cycleDate === null ? '' : `, under ${result.cycleDate}`}.`,
    );
    const account = await engine.accounts.get(userId);
    console.log(
      account?.frozen === true
        ? 'The account is still frozen. When you have finished checking, run: npm run unfreeze -- --reason "what you found"'
        : 'The account is unchanged.',
    );
    return 0;
  } finally {
    await engine.close();
  }
});
