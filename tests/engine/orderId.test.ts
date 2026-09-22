import { describe, expect, it } from 'vitest';
import { clientOrderId, intentFor } from '../../src/engine/orderId.js';

describe('clientOrderId', () => {
  it('is the same for the same user, day, intent, and attempt', () => {
    expect(clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1)).toBe(
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1),
    );
  });

  it('differs when any one of them differs', () => {
    const ids = new Set([
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1),
      clientOrderId('someone', '2026-09-21', 'ENTER_LONG', 1),
      clientOrderId('founder', '2026-09-22', 'ENTER_LONG', 1),
      clientOrderId('founder', '2026-09-21', 'EXIT_TO_FLAT', 1),
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 2),
    ]);
    expect(ids.size).toBe(5);
  });

  it("fits Bybit's orderLinkId rules", () => {
    const id = clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(id).toHaveLength(34);
  });

  it('cannot be confused by separators inside the inputs', () => {
    expect(clientOrderId('a|b', '2026-09-21', 'ENTER_LONG', 1)).not.toBe(
      clientOrderId('a', 'b|2026-09-21', 'ENTER_LONG', 1),
    );
  });

  it('rejects an attempt that is not a whole number from 1', () => {
    expect(() => clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 0)).toThrow('attempt');
    expect(() => clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1.5)).toThrow('attempt');
  });
});

describe('intentFor', () => {
  it('maps a buy to entering LONG and a sell to leaving for FLAT', () => {
    expect(intentFor('BUY')).toBe('ENTER_LONG');
    expect(intentFor('SELL')).toBe('EXIT_TO_FLAT');
  });
});
