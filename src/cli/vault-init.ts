import { existsSync, writeFileSync } from 'node:fs';
import { generateMasterKey } from '../vault/keyring.js';
import { ENV_FILE } from './env.js';

if (existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} already exists, so nothing was changed.`);
  console.error('Replacing its master key would make every credential stored with it unreadable.');
  process.exit(1);
}

writeFileSync(
  ENV_FILE,
  [
    '# Secrets for this machine only. Never commit this file.',
    '# Losing VAULT_MASTER_KEY_V1 makes every credential stored with it unreadable.',
    'BYBIT_ENV=testnet',
    'VAULT_ACTIVE_KEY_VERSION=1',
    `VAULT_MASTER_KEY_V1=${generateMasterKey()}`,
    '',
  ].join('\n'),
  // 'wx' refuses to overwrite even if the file appeared since the check above.
  { encoding: 'utf8', flag: 'wx', mode: 0o600 },
);

console.log(`Created ${ENV_FILE} with a new vault master key for this machine.`);
console.log('Back it up somewhere safe: without it, credentials stored here cannot be read.');
