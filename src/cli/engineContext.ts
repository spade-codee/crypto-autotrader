import { HealthcheckHeartbeat, NoHeartbeat, type Heartbeat } from '../alerts/heartbeat.js';
import { LogAlerter, TelegramAlerter, type Alerter } from '../alerts/telegram.js';
import { openDatabase, type Database } from '../db/client.js';
import type { CycleDeps } from '../engine/cycle.js';
import { Ledger } from '../ledger/ledger.js';
import { BybitPublicMarket } from '../market/bybitPublic.js';
import { KillSwitch } from '../ops/killSwitch.js';
import { PaperAccount } from '../paper/paperAccount.js';
import { AccountStates } from '../state/accountState.js';
import { AlertLog } from '../state/alertLog.js';
import { CycleRuns } from '../state/cycleRuns.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../strategy/trendFilter.js';
import { loadLocalEnv, readEngineConfig, type EngineConfig } from './env.js';

/** BTC only: docs/decisions.md #21. */
export const SYMBOL = 'BTCUSDT';

/** Every alert says it comes from paper trading, so no one mistakes it for real money. */
const ALERT_PREFIX = '[paper] ';

export type Engine = {
  config: EngineConfig;
  db: Database;
  deps: CycleDeps;
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  market: BybitPublicMarket;
  alerter: Alerter;
  paperAccount: (userId: string) => PaperAccount;
  close: () => Promise<void>;
};

export type EngineOptions = {
  /** Settings to read instead of the environment and .env.local. For tests. */
  env?: Record<string, string | undefined>;
  /** How long to wait for another command to finish with the database. */
  lockWaitMs?: number;
};

/**
 * Loads the settings, opens the database, and wires the engine's real
 * dependencies. openDatabase holds the database lock until close(), the same
 * lock the key commands take, so no two commands ever have the database open.
 */
export async function openEngine(options: EngineOptions = {}): Promise<Engine> {
  if (options.env === undefined) {
    loadLocalEnv();
  }
  const config = readEngineConfig(options.env ?? process.env);
  const database = await openDatabase(config.dbDir, { lockWaitMs: options.lockWaitMs });
  try {
    const { db } = database;
    const ledger = new Ledger(db);
    const accounts = new AccountStates(db);
    const runs = new CycleRuns(db);
    const market = new BybitPublicMarket();
    const alerter: Alerter =
      config.telegram === null
        ? new LogAlerter(console.log, ALERT_PREFIX)
        : new TelegramAlerter({ token: config.telegram.token, chatId: config.telegram.chatId, prefix: ALERT_PREFIX });
    const heartbeat: Heartbeat =
      config.healthcheckUrl === null ? new NoHeartbeat() : new HealthcheckHeartbeat({ url: config.healthcheckUrl });
    const paperAccount = (userId: string) => new PaperAccount({ db, userId, market, feeRate: config.paperFeeRate });
    const deps: CycleDeps = {
      ledger,
      accounts,
      runs,
      alertLog: new AlertLog(db),
      market,
      accountFor: paperAccount,
      killSwitch: new KillSwitch(config.killSwitchFile),
      alerter,
      heartbeat,
      now: () => Date.now(),
      symbol: SYMBOL,
      strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      maPeriod: CHOSEN_MA_PERIOD,
      candleCount: 250,
      maxOrderUsdt: config.maxOrderUsdt,
      pollIntervalMs: 2_000,
      pollTimeoutMs: 60_000,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    return {
      config,
      db,
      deps,
      ledger,
      accounts,
      runs,
      market,
      alerter,
      paperAccount,
      close: database.close,
    };
  } catch (error) {
    await database.close();
    throw error;
  }
}
