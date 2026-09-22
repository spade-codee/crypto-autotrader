import Decimal from 'decimal.js';
import { parseEnvironment, type Environment } from '../exchange/environment.js';
import { Secret } from '../secrets/secret.js';

export const ENV_FILE = '.env.local';

export type CliConfig = {
  environment: Environment;
  userId: string;
  dbDir: string;
  serverIps: string[];
};

/** Loads .env.local into process.env when it exists. */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function readConfig(env: Record<string, string | undefined> = process.env): CliConfig {
  return {
    environment: parseEnvironment(env.BYBIT_ENV),
    userId: env.USER_ID?.trim() || 'founder',
    dbDir: env.DB_DIR?.trim() || 'data/db',
    serverIps: (env.SERVER_IPS ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip !== ''),
  };
}

export type EngineConfig = {
  /** Only paper trading exists in Phase 2. Stated explicitly, so a mode is never implied. */
  tradingMode: 'paper';
  userId: string;
  dbDir: string;
  killSwitchFile: string;
  paperFeeRate: Decimal;
  maxOrderUsdt: Decimal | null;
  telegram: { token: Secret; chatId: string } | null;
  healthcheckUrl: Secret | null;
};

/** Where the kill-switch file lives. Read on its own, so the kill switch works when other settings are broken. */
export function killSwitchFileFrom(env: Record<string, string | undefined> = process.env): string {
  return env.KILL_SWITCH_FILE?.trim() || 'data/KILL_SWITCH';
}

function decimalSetting(
  name: string,
  value: string | undefined,
  fallback: string | null,
  valid: (d: Decimal) => boolean,
  rule: string,
): Decimal | null {
  const text = value?.trim() || fallback;
  if (text === null) {
    return null;
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(text);
  } catch {
    throw new Error(`${name} must be a number, not "${text}"`);
  }
  if (!parsed.isFinite() || !valid(parsed)) {
    throw new Error(`${name} must be ${rule}, not "${text}"`);
  }
  return parsed;
}

/** Reads the engine's settings. Secrets are wrapped at once and never echoed in errors. */
export function readEngineConfig(env: Record<string, string | undefined> = process.env): EngineConfig {
  const mode = env.TRADING_MODE?.trim();
  if (mode !== 'paper') {
    throw new Error(
      `TRADING_MODE must be "paper", the only mode in this phase${mode ? `, not "${mode}"` : ''}. Add TRADING_MODE=paper to .env.local.`,
    );
  }
  const { userId, dbDir } = readConfig(env);
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  if ((token === '') !== (chatId === '')) {
    throw new Error('Set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or neither.');
  }
  const healthcheck = env.HEALTHCHECK_URL?.trim() ?? '';
  if (healthcheck !== '' && !healthcheck.startsWith('https://')) {
    throw new Error('HEALTHCHECK_URL must start with https://');
  }
  return {
    tradingMode: 'paper',
    userId,
    dbDir,
    killSwitchFile: killSwitchFileFrom(env),
    paperFeeRate: decimalSetting('PAPER_FEE_RATE', env.PAPER_FEE_RATE, '0.001', (d) => d.gte(0) && d.lt('0.01'), 'at least 0 and below 0.01')!,
    maxOrderUsdt: decimalSetting('MAX_ORDER_USDT', env.MAX_ORDER_USDT, null, (d) => d.gt(0), 'above zero'),
    telegram: token === '' ? null : { token: new Secret(token), chatId },
    healthcheckUrl: healthcheck === '' ? null : new Secret(healthcheck),
  };
}
