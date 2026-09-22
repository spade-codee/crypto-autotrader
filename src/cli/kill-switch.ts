import { parseArgs } from 'node:util';
import { KillSwitch } from '../ops/killSwitch.js';
import { runCli } from './context.js';
import { killSwitchFileFrom, loadLocalEnv } from './env.js';

// Deliberately independent of the database and of every other setting, so the
// kill switch works even when the rest of the application does not.
await runCli(async () => {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { reason: { type: 'string' } } });
  loadLocalEnv();
  const killSwitch = new KillSwitch(killSwitchFileFrom(process.env));
  const [command] = positionals;
  if (command === 'on') {
    killSwitch.turnOn(values.reason?.trim() || 'no reason given', new Date());
    console.log(`Kill switch ON (${killSwitch.file}). Nothing trades until you run: npm run kill-switch -- off`);
    return 0;
  }
  if (command === 'off') {
    killSwitch.turnOff();
    console.log('Kill switch off. Trading resumes at the next tick.');
    return 0;
  }
  console.log(
    `The kill switch is ${killSwitch.isOn() ? 'ON' : 'off'}. Use: npm run kill-switch -- on --reason "why", or: npm run kill-switch -- off`,
  );
  return command === undefined ? 0 : 1;
});
