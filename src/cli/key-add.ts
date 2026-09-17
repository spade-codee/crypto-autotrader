import { connectKey } from '../app/credentials.js';
import { Secret } from '../secrets/secret.js';
import { openContext, printList, runCli } from './context.js';
import { ask, askHidden, requireInteractiveTerminal } from './prompt.js';

await runCli(async () => {
  // Before the vault or database is touched: secrets must never arrive through a pipe.
  requireInteractiveTerminal();
  const { deps, owner, close } = await openContext();
  try {
    console.log(`Connecting a Bybit ${owner.environment} API key for "${owner.userId}".`);
    const apiKey = await ask('API key: ');
    const apiSecret = await askHidden('API secret (typing is hidden): ');
    if (apiKey === '' || apiSecret === '') {
      console.error('Both the API key and the secret are required. Nothing was stored.');
      return 1;
    }

    const result = await connectKey(deps, owner, {
      apiKey: new Secret(apiKey),
      apiSecret: new Secret(apiSecret),
    });

    if (result.status === 'rejected') {
      console.error('This key was NOT stored. Fix these in Bybit, then run key:add again:');
      printList('-', result.problems, console.error);
      printList('!', result.warnings, console.error);
      return 1;
    }
    console.log(`Stored the key ending ...${result.apiKeyHint} for ${owner.environment}, encrypted.`);
    console.log(result.canTradeSpot ? 'It can place spot trades.' : 'It cannot place trades.');
    printList('!', result.warnings, console.log);
    return 0;
  } finally {
    await close();
  }
});
