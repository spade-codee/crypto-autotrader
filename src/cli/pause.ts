import { parseArgs } from 'node:util';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { reason: { type: 'string' } } });
  const engine = await openEngine();
  try {
    await engine.accounts.pause(engine.config.userId, values.reason?.trim() || null, new Date());
    const account = await engine.accounts.get(engine.config.userId);
    console.log(`Paused "${engine.config.userId}". Nothing trades until you run npm run resume.`);
    if (account?.frozen === true) {
      console.log('It is also frozen for review, so lifting that freeze will not start trading while it is paused.');
    }
    return 0;
  } finally {
    await engine.close();
  }
});
