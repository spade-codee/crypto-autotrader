import { checkKey } from '../app/credentials.js';
import { openContext, printList, runCli } from './context.js';

await runCli(async () => {
  const { deps, owner, close } = await openContext();
  try {
    const result = await checkKey(deps, owner);
    if (result.status === 'no-key') {
      console.error(`No ${owner.environment} key is stored for "${owner.userId}". Run npm run key:add first.`);
      return 1;
    }
    if (result.status === 'invalid') {
      console.error(`The key ending ...${result.apiKeyHint} no longer passes validation:`);
      printList('-', result.problems, console.error);
      printList('!', result.warnings, console.error);
      return 1;
    }
    console.log(`The key ending ...${result.apiKeyHint} passes validation on ${owner.environment}.`);
    console.log(result.canTradeSpot ? 'It can place spot trades.' : 'It cannot place trades.');
    printList('!', result.warnings, console.log);
    return 0;
  } finally {
    await close();
  }
});
