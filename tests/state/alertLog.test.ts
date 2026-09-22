import { describe, expect, it } from 'vitest';
import { AlertLog } from '../../src/state/alertLog.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

describe('AlertLog', () => {
  it('lets each key be claimed once', async () => {
    const log = new AlertLog(database());
    expect(await log.has('2026-09-21:founder:failure')).toBe(false);
    expect(await log.claim('2026-09-21:founder:failure', AT)).toBe(true);
    expect(await log.claim('2026-09-21:founder:failure', AT)).toBe(false);
    expect(await log.has('2026-09-21:founder:failure')).toBe(true);
  });
});
