import { mkdirSync } from 'node:fs';
import { HealthcheckHeartbeat, NoHeartbeat, type Heartbeat } from '../alerts/heartbeat.js';
import { LogAlerter, TelegramAlerter, type Alerter } from '../alerts/telegram.js';
import { openDatabase, type Database } from '../db/client.js';
import type { CycleDeps } from '../engine/cycle.js';
import { Ledger } from '../ledger/ledger.js';
import { BybitPublicMarket } from '../market/bybitPublic.js';
import { KillSwitch } from '../ops/killSwitch.js';
import { acquireLock } from '../ops/lock.js';
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

/**
 * Loads the settings, takes the database lock, and wires the engine's real
 * dependencies. PGlite must never be opened by two processes at once, so every
 * command that touches the database goes through here.
 */
export async function openEngine(): Promise<Engine> {
  loadLocalEnv();
  const config = readEngineConfig(process.env);
  const release = await acquireLock(config.lockFile);
  try {
    mkdirSync(config.dbDir, { recursive: true });
    const database = await openDatabase(config.dbDir);
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
      close: async () => {
        try {
          await database.close();
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
