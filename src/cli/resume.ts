import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    await engine.accounts.resume(engine.config.userId, new Date());
    console.log(`Resumed "${engine.config.userId}". It trades again from the next tick.`);
    return 0;
  } finally {
    await engine.close();
  }
});
