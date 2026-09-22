import { describeOutcome, runTick } from '../engine/cycle.js';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

/**
 * The process's own deadline. A tick normally takes seconds; one still running
 * after five minutes is stopped, so it cannot hold the database lock all day.
 * Its intents stay outstanding and its lock is detected as stale, so the next
 * tick recovers. systemd's TimeoutStartSec=10min is the outer bound.
 */
const TICK_DEADLINE_MS = 5 * 60_000;
setTimeout(() => {
  console.error('The tick ran for more than 5 minutes and was stopped.');
  process.exit(1);
}, TICK_DEADLINE_MS).unref();

await runCli(async () => {
  const engine = await openEngine();
  try {
    if (engine.config.telegram === null) {
      console.warn('Telegram is not configured, so alerts only go to this log.');
    }
    console.log(describeOutcome(await runTick(engine.deps)));
    return 0;
  } finally {
    await engine.close();
  }
});
