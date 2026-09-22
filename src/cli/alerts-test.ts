import { TelegramAlerter } from '../alerts/telegram.js';
import { runCli } from './context.js';
import { loadLocalEnv, readEngineConfig } from './env.js';

await runCli(async () => {
  loadLocalEnv();
  const config = readEngineConfig(process.env);
  if (config.telegram === null) {
    console.error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.');
    return 1;
  }
  const problems: string[] = [];
  await new TelegramAlerter({ ...config.telegram, prefix: '[paper] ', log: (line) => problems.push(line) }).send(
    'Test alert from crypto-autotrader. If you can read this, alerts work.',
  );
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    return 1;
  }
  console.log('Test alert sent. Check Telegram.');
  return 0;
});
