import { readBalances } from '../app/credentials.js';
import { openContext, printList, runCli } from './context.js';

await runCli(async () => {
  const { deps, owner, close } = await openContext();
  try {
    const result = await readBalances(deps, owner);
    if (result.status === 'no-key') {
      console.error(`No ${owner.environment} key is stored for "${owner.userId}". Run npm run key:add first.`);
      return 1;
    }
    if (result.status === 'key-rejected') {
      console.error('The stored key no longer passes validation, so it was not used:');
      printList('-', result.problems, console.error);
      return 1;
    }

    console.log(`Balances on ${owner.environment}:`);
    if (result.balances.length === 0) {
      console.log('  (none)');
    }
    for (const b of result.balances) {
      const locked = b.locked.isZero() ? '' : `  (locked ${b.locked.toFixed()})`;
      console.log(`  ${b.coin.padEnd(8)} ${b.walletBalance.toFixed()}${locked}`);
    }
    if (result.borrowedCoins.length > 0) {
      console.error(
        `Borrowed funds on ${result.borrowedCoins.join(', ')}. This product must never trade with borrowed funds: repay them and turn off spot margin in Bybit.`,
      );
      return 1;
    }
    return 0;
  } finally {
    await close();
  }
});
