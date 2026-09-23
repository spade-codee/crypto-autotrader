import { describe, expect, it } from 'vitest';
import { accountState } from '../../src/db/schema.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { AccountStates } from '../../src/state/accountState.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

async function withAccount(): Promise<AccountStates> {
  await database().insert(accountState).values({ userId: 'founder', paused: false, frozen: false, updatedAt: AT });
  return new AccountStates(database());
}

const eventsOf = async (type: 'FROZEN' | 'UNFROZEN' | 'PAUSED' | 'RESUMED') =>
  new Ledger(database()).ofType(type, 'founder');

describe('AccountStates', () => {
  it('freezes an account and records why, under the day', async () => {
    const states = await withAccount();
    await states.freeze('founder', '2026-09-21', 'the spread was too wide', AT);
    expect(await states.get('founder')).toMatchObject({ status: 'frozen', reason: 'the spread was too wide' });
    const [frozen] = await eventsOf('FROZEN');
    expect(frozen).toMatchObject({ cycleDate: '2026-09-21', payload: { reason: 'the spread was too wide' } });
  });

  it('ignores a second freeze', async () => {
    const states = await withAccount();
    await states.freeze('founder', '2026-09-21', 'first', AT);
    await states.freeze('founder', '2026-09-21', 'second', AT);
    expect(await eventsOf('FROZEN')).toHaveLength(1);
    expect((await states.get('founder'))?.reason).toBe('first');
  });

  it('unfreezes only a frozen account, and only with a reason', async () => {
    const states = await withAccount();
    await expect(states.unfreeze('founder', 'checked', AT)).rejects.toThrow('not frozen');
    await states.freeze('founder', null, 'odd balances', AT);
    await expect(states.unfreeze('founder', '  ', AT)).rejects.toThrow('needs a reason');
    await states.unfreeze('founder', 'checked the account on Bybit', AT);
    expect((await states.get('founder'))?.status).toBe('active');
    expect(await eventsOf('UNFROZEN')).toHaveLength(1);
  });

  it('pauses an account that is not paused, and resumes only a paused one', async () => {
    const states = await withAccount();
    await expect(states.resume('founder', AT)).rejects.toThrow('not paused');
    await states.pause('founder', 'travelling', AT);
    expect((await states.get('founder'))?.status).toBe('paused');
    await expect(states.pause('founder', null, AT)).rejects.toThrow('already paused');
    await states.resume('founder', AT);
    expect((await states.get('founder'))?.status).toBe('active');
    expect(await eventsOf('PAUSED')).toHaveLength(1);
    expect(await eventsOf('RESUMED')).toHaveLength(1);
  });

  it('keeps a pause underneath a freeze, and gives it back when the freeze is lifted', async () => {
    const states = await withAccount();
    await states.pause('founder', 'travelling', AT);
    await states.freeze('founder', '2026-09-21', 'a partial fill', AT);
    expect(await states.get('founder')).toMatchObject({ status: 'frozen', reason: 'a partial fill', paused: true });

    await states.unfreeze('founder', 'checked the account on Bybit', AT);
    expect(await states.get('founder')).toMatchObject({ status: 'paused', reason: 'travelling', frozen: false });
    const [frozen] = await eventsOf('FROZEN');
    expect(frozen?.payload).toMatchObject({ reason: 'a partial fill', alsoPaused: true });
    const [unfrozen] = await eventsOf('UNFROZEN');
    expect(unfrozen?.payload).toMatchObject({ stillPaused: true });
  });

  it('can be paused while frozen, so lifting the freeze does not start trading', async () => {
    const states = await withAccount();
    await states.freeze('founder', null, 'a partial fill', AT);
    await states.pause('founder', 'I want to look first', AT);
    expect((await states.get('founder'))?.status).toBe('frozen');
    await states.unfreeze('founder', 'checked', AT);
    expect((await states.get('founder'))?.status).toBe('paused');
  });

  it('resuming a frozen account leaves it frozen', async () => {
    const states = await withAccount();
    await states.pause('founder', 'travelling', AT);
    await states.freeze('founder', null, 'a partial fill', AT);
    await states.resume('founder', AT);
    expect(await states.get('founder')).toMatchObject({ status: 'frozen', paused: false, frozen: true });
    const [resumed] = await eventsOf('RESUMED');
    expect(resumed?.payload).toMatchObject({ stillFrozen: true });
  });

  it('names the fix when an account does not exist', async () => {
    await expect(new AccountStates(database()).freeze('nobody', null, 'x', AT)).rejects.toThrow('paper:init');
  });

  it('lists every account', async () => {
    const states = await withAccount();
    expect((await states.all()).map((a) => a.userId)).toEqual(['founder']);
  });
});
