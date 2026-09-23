import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    await engine.accounts.resume(engine.config.userId, new Date());
    const account = await engine.accounts.get(engine.config.userId);
    console.log(
      account?.frozen === true
        ? `Resumed "${engine.config.userId}", but it stays frozen for review. Run npm run unfreeze -- --reason "what you found" when you have checked it.`
        : `Resumed "${engine.config.userId}". It trades again from the next tick.`,
    );
    return 0;
  } finally {
    await engine.close();
  }
});
