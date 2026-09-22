import { parseArgs } from 'node:util';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { reason: { type: 'string' } } });
  const engine = await openEngine();
  try {
    await engine.accounts.pause(engine.config.userId, values.reason?.trim() || null, new Date());
    console.log(`Paused "${engine.config.userId}". Nothing trades until you run npm run resume.`);
    return 0;
  } finally {
    await engine.close();
  }
});
