import { parseArgs } from 'node:util';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { reason: { type: 'string' } } });
  const reason = values.reason?.trim() ?? '';
  if (reason === '') {
    console.error('Say what you checked, for the record: npm run unfreeze -- --reason "what you found"');
    return 1;
  }
  const engine = await openEngine();
  try {
    await engine.accounts.unfreeze(engine.config.userId, reason, new Date());
    console.log(`Unfroze "${engine.config.userId}". If today's run has not completed, the next tick runs it.`);
    return 0;
  } finally {
    await engine.close();
  }
});
