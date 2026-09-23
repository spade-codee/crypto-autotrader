import type { OrderState, TradingAccount } from '../exchange/trading.js';
import type { Ledger, LedgerEvent } from '../ledger/ledger.js';

/** An order still pending this long after its intent freezes the account. */
export const PENDING_FREEZE_AFTER_MS = 60 * 60_000;

/**
 * An order the account still cannot see this long after its intent freezes the
 * account for a person to check. Time never proves absence, so the engine
 * waits rather than retries.
 */
export const NOT_VISIBLE_FREEZE_AFTER_MS = 60 * 60_000;

export type OrderVerdict =
  /** The account answered, and the one result is recorded. */
  | { kind: 'SETTLED'; id: string; intentDate: string; state: OrderState }
  /** The account proved the order absent, and NOT_PLACED is recorded. */
  | { kind: 'NOT_PLACED'; id: string; intentDate: string }
  /** In flight, or not visible yet: nothing is recorded, and the next tick asks again. */
  | { kind: 'WAIT'; id: string; intentDate: string; reason: string }
  /** Too long in that state: a person must look. Nothing is recorded. */
  | { kind: 'FREEZE'; id: string; intentDate: string; reason: string };

export type SettleDeps = { ledger: Ledger };

/**
 * Gives one outstanding intent its single recorded result, or says why it
 * cannot yet. Only the account's proof of absence records NOT_PLACED: elapsed
 * time and an empty lookup never do (Phase 2 spec section 4.2). A lookup that
 * throws is inconclusive — it records nothing, and the error reaches the caller,
 * which retries at the next tick. Every decision about what to do next — wait,
 * freeze, alert — belongs to the caller.
 */
export async function settleOneOrder(
  deps: SettleDeps,
  userId: string,
  account: TradingAccount,
  intent: LedgerEvent,
  at: Date,
  today: string,
): Promise<OrderVerdict> {
  const id = String(intent.payload.clientOrderId);
  const intentDate = intent.cycleDate ?? today;
  const age = at.getTime() - intent.occurredAt.getTime();
  const lookup = await account.getOrder(id);

  if (lookup.kind === 'ABSENT') {
    await deps.ledger.append({
      occurredAt: at,
      userId,
      cycleDate: intentDate,
      type: 'ORDER_RESULT',
      payload: { clientOrderId: id, status: 'NOT_PLACED' },
    });
    return { kind: 'NOT_PLACED', id, intentDate };
  }

  if (lookup.kind === 'NOT_VISIBLE') {
    return age >= NOT_VISIBLE_FREEZE_AFTER_MS
      ? {
          kind: 'FREEZE',
          id,
          intentDate,
          reason: `order ${id} from ${intentDate} has not been visible for over an hour, and the account cannot prove it was never placed; check the exchange by hand, then record what you found with npm run order:record`,
        }
      : {
          kind: 'WAIT',
          id,
          intentDate,
          reason: `order ${id} from ${intentDate} is not visible yet; no replacement is placed until the account can say what happened to it`,
        };
  }

  const { state } = lookup;
  if (state.status === 'PENDING') {
    return age >= PENDING_FREEZE_AFTER_MS
      ? { kind: 'FREEZE', id, intentDate, reason: `order ${id} from ${intentDate} has been pending for over an hour` }
      : { kind: 'WAIT', id, intentDate, reason: `order ${id} from ${intentDate} is still pending` };
  }

  await deps.ledger.append({
    occurredAt: at,
    userId,
    cycleDate: intentDate,
    type: 'ORDER_RESULT',
    payload: { ...state },
  });
  return { kind: 'SETTLED', id, intentDate, state };
}
