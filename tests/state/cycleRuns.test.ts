import { describe, expect, it } from 'vitest';
import { CycleRuns } from '../../src/state/cycleRuns.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const runs = () => new CycleRuns(database());
const AT = new Date('2026-09-22T00:02:00Z');
const LATER = new Date('2026-09-22T02:02:00Z');

describe('CycleRuns', () => {
  it('creates a pending run on the first attempt and counts the later ones', async () => {
    expect(await runs().startAttempt('2026-09-21', 'founder', AT)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await runs().startAttempt('2026-09-21', 'founder', LATER)).toMatchObject({ status: 'pending', attempts: 2 });
    expect((await runs().get('2026-09-21', 'founder'))?.firstAttemptAt).toEqual(AT);
  });

  it('puts a frozen run back to pending on the next attempt', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().markFrozen('2026-09-21', 'founder', 'veto');
    expect(await runs().startAttempt('2026-09-21', 'founder', LATER)).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it('refuses to restart a completed run', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().complete('2026-09-21', 'founder', AT, false);
    await expect(runs().startAttempt('2026-09-21', 'founder', LATER)).rejects.toThrow('completed');
  });

  it('completes a run, recording whether it was late', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().recordError('2026-09-21', 'founder', 'Bybit was down');
    await runs().complete('2026-09-21', 'founder', LATER, true);
    expect(await runs().get('2026-09-21', 'founder')).toMatchObject({
      status: 'completed',
      late: true,
      completedAt: LATER,
      lastError: null,
    });
  });

  it('abandons only pending runs from earlier days', async () => {
    await runs().startAttempt('2026-09-20', 'founder', AT);
    await runs().startAttempt('2026-09-20', 'other', AT);
    await runs().complete('2026-09-20', 'other', AT, false);
    await runs().startAttempt('2026-09-21', 'founder', AT);
    const abandoned = await runs().abandonBefore('2026-09-21');
    expect(abandoned.map((r) => [r.cycleDate, r.userId, r.status])).toEqual([['2026-09-20', 'founder', 'abandoned']]);
    expect((await runs().get('2026-09-20', 'other'))?.status).toBe('completed');
    expect((await runs().get('2026-09-21', 'founder'))?.status).toBe('pending');
  });

  it("lists the day's pending runs", async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().startAttempt('2026-09-21', 'other', AT);
    await runs().complete('2026-09-21', 'other', AT, false);
    expect((await runs().pendingFor('2026-09-21')).map((r) => r.userId)).toEqual(['founder']);
  });
});
