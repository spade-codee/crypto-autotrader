import { describe, expect, it } from 'vitest';
import { killSwitchFileFrom, readEngineConfig } from '../../src/cli/env.js';

const BASE = { TRADING_MODE: 'paper' };

describe('readEngineConfig', () => {
  it('requires TRADING_MODE=paper, the only mode in this phase', () => {
    expect(() => readEngineConfig({})).toThrow('TRADING_MODE must be "paper"');
    expect(() => readEngineConfig({ TRADING_MODE: 'live' })).toThrow('not "live"');
  });

  it('has safe defaults', () => {
    const config = readEngineConfig(BASE);
    expect(config).toMatchObject({
      tradingMode: 'paper',
      userId: 'founder',
      dbDir: 'data/db',
      lockFile: 'data/db.lock',
      killSwitchFile: 'data/KILL_SWITCH',
      maxOrderUsdt: null,
      telegram: null,
      healthcheckUrl: null,
    });
    expect(config.paperFeeRate.toFixed()).toBe('0.001');
  });

  it('needs both Telegram settings or neither', () => {
    expect(() => readEngineConfig({ ...BASE, TELEGRAM_BOT_TOKEN: 'x' })).toThrow('both');
    expect(() => readEngineConfig({ ...BASE, TELEGRAM_CHAT_ID: '1' })).toThrow('both');
    expect(readEngineConfig({ ...BASE, TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: '1' }).telegram?.chatId).toBe('1');
  });

  it('keeps the bot token and the heartbeat URL secret', () => {
    const config = readEngineConfig({
      ...BASE,
      TELEGRAM_BOT_TOKEN: 'TOKEN-123',
      TELEGRAM_CHAT_ID: '1',
      HEALTHCHECK_URL: 'https://hc-ping.com/UUID-456',
    });
    expect(JSON.stringify(config)).not.toContain('TOKEN-123');
    expect(JSON.stringify(config)).not.toContain('UUID-456');
    expect(config.telegram?.token.reveal()).toBe('TOKEN-123');
  });

  it('refuses a heartbeat URL that is not https', () => {
    expect(() => readEngineConfig({ ...BASE, HEALTHCHECK_URL: 'http://example.test' })).toThrow('https://');
  });

  it('reads the fee rate and the optional order cap', () => {
    const config = readEngineConfig({ ...BASE, PAPER_FEE_RATE: '0.002', MAX_ORDER_USDT: '250' });
    expect(config.paperFeeRate.toFixed()).toBe('0.002');
    expect(config.maxOrderUsdt?.toFixed()).toBe('250');
  });

  it('rejects a fee rate or a cap that makes no sense', () => {
    expect(() => readEngineConfig({ ...BASE, PAPER_FEE_RATE: 'abc' })).toThrow('PAPER_FEE_RATE');
    expect(() => readEngineConfig({ ...BASE, PAPER_FEE_RATE: '0.5' })).toThrow('PAPER_FEE_RATE');
    expect(() => readEngineConfig({ ...BASE, MAX_ORDER_USDT: '-1' })).toThrow('MAX_ORDER_USDT');
  });

  it('puts the lock beside the database directory, never inside it', () => {
    expect(readEngineConfig({ ...BASE, DB_DIR: '/var/lib/autotrader/db/' }).lockFile).toBe('/var/lib/autotrader/db.lock');
  });
});

describe('killSwitchFileFrom', () => {
  it('defaults to data/KILL_SWITCH, and can be moved', () => {
    expect(killSwitchFileFrom({})).toBe('data/KILL_SWITCH');
    expect(killSwitchFileFrom({ KILL_SWITCH_FILE: '/run/autotrader/KILL' })).toBe('/run/autotrader/KILL');
  });
});
