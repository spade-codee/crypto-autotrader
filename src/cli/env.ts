import { parseEnvironment, type Environment } from '../exchange/environment.js';

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
