# Phase 2a — Order settlement while an account is not trading: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An order that has been sent always ends with one recorded answer, whatever state its
account is in, and a person can record what they found when the exchange cannot show an order.

**Architecture:** Settling one outstanding order becomes its own module,
`src/engine/settleOrders.ts`, which records facts and returns a verdict. `src/engine/cycle.ts`
keeps every policy decision — freeze, alert, run bookkeeping — and calls that module from two
places: the trading run, as today, and a new pass over accounts that are not trading. A pause and
a freeze become two independent facts on `account_state`, so lifting one never lifts the other.
A new command, `npm run order:record`, appends the one result for an order the exchange still
cannot show.

**Tech stack:** TypeScript (ESM, `.js` imports), Vitest, Drizzle ORM on PGlite, decimal.js. No
new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-phase-2a-order-settlement-design.md`.
**Branch:** `phase-2a-order-settlement`, already created from `phase-2-paper-engine`.

**Rules that apply to every task:**

- Money and quantities are `Decimal`, never floats. Never `parseFloat` an exchange response.
- The ledger is append-only. Each client order ID keeps exactly one `ORDER_INTENT` and one
  `ORDER_RESULT`; the database enforces it.
- `ABSENT` means the adapter proved the order does not exist. `NOT_VISIBLE` means it cannot tell.
  Elapsed time and an empty lookup never prove non-submission.
- Nothing in this plan places, sizes, or cancels an order.
- Commit after every task, and push: `git push`. Never force-push.
- Run the whole suite with `npm test` before every commit. `npm run typecheck` must pass.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/db/schema.ts` | Modify | `account_state` gains `paused`, `paused_reason`, `frozen`, `frozen_reason`; loses `status`, `reason` |
| `drizzle/0003_pause_and_freeze.sql` | Create | Adds the columns and copies the old state into them |
| `drizzle/0004_drop_account_status.sql` | Create | Drops `status` and `reason` |
| `src/state/accountState.ts` | Modify | Pause and freeze as independent facts; `status` derived for every reader |
| `src/paper/paperAccount.ts` | Modify | `open` inserts the new columns |
| `src/ledger/orderEvents.ts` | Create | Reads a recorded `ORDER_RESULT` payload back as an `OrderState` |
| `src/engine/settleOrders.ts` | Create | Settles one outstanding intent: records the result, or says why it cannot yet |
| `src/engine/cycle.ts` | Modify | Uses `settleOrders`; new pass for accounts that are not trading; the day's fill read from the ledger; reminder text |
| `src/app/recordOrderOutcome.ts` | Create | The rules for recording what a person found |
| `src/cli/order-record.ts` | Create | The `order:record` command |
| `src/cli/status.ts` | Modify | Lists orders still waiting for an answer |
| `src/cli/pause.ts`, `resume.ts`, `unfreeze.ts` | Modify | Say what the other fact leaves in place |
| `package.json` | Modify | The `order:record` script |
| `tests/db/migrations.test.ts` | Create | The migration keeps an existing account's state |
| `tests/state/accountState.test.ts` | Modify | Independent pause and freeze |
| `tests/ledger/orderEvents.test.ts` | Create | Payload round-trip |
| `tests/engine/settleWhileStopped.test.ts` | Create | Settling while paused, frozen, and under the kill switch; the dead end |
| `tests/app/recordOrderOutcome.test.ts` | Create | Recording and every refusal |
| `docs/*` | Modify | Task 11 |

---

## Task 1: `account_state` records a pause and a freeze separately

**Files:**
- Modify: `src/db/schema.ts:78-83`
- Create: `drizzle/0003_pause_and_freeze.sql`, `drizzle/0004_drop_account_status.sql`
- Create: `tests/db/migrations.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/db/migrations.test.ts`. It runs the migrations by hand on a bare PGlite, so it can
insert a row in the old shape and check the new columns afterwards.

```ts
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Runs one migration file, statement by statement, as drizzle's migrator does. */
async function apply(client: PGlite, tag: string): Promise<void> {
  const sql = readFileSync(`drizzle/${tag}.sql`, 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') {
      await client.exec(statement);
    }
  }
}

describe('the account_state migration', () => {
  it('keeps the state and the reason every existing account had', async () => {
    const client = new PGlite();
    for (const tag of ['0000_exchange_credentials', '0001_paper_engine', '0002_ledger_append_only']) {
      await apply(client, tag);
    }
    await client.exec(`
      INSERT INTO account_state (user_id, status, reason, updated_at) VALUES
        ('active-one', 'active', NULL, now()),
        ('paused-one', 'paused', 'travelling', now()),
        ('frozen-one', 'frozen', 'a partial fill', now());
    `);

    await apply(client, '0003_pause_and_freeze');
    await apply(client, '0004_drop_account_status');

    const rows = await client.query<{
      user_id: string;
      paused: boolean;
      paused_reason: string | null;
      frozen: boolean;
      frozen_reason: string | null;
    }>('SELECT user_id, paused, paused_reason, frozen, frozen_reason FROM account_state ORDER BY user_id');
    expect(rows.rows).toEqual([
      { user_id: 'active-one', paused: false, paused_reason: null, frozen: false, frozen_reason: null },
      { user_id: 'frozen-one', paused: false, paused_reason: null, frozen: true, frozen_reason: 'a partial fill' },
      { user_id: 'paused-one', paused: true, paused_reason: 'travelling', frozen: false, frozen_reason: null },
    ]);
    await client.close();
  });
});
```

- [x] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: FAIL — `ENOENT` on `drizzle/0003_pause_and_freeze.sql`.

- [x] **Step 3: Change the schema to add the new columns**

In `src/db/schema.ts`, replace the `accountState` table and its comment with this. Keep
`status` and `reason` for now: this generate must add columns only, or drizzle-kit asks whether
a column was renamed.

```ts
/**
 * Whether each account may trade. A pause and a freeze are independent facts:
 * the user owns the pause, the engine owns the freeze, and lifting one never
 * lifts the other. Every change is also written to the ledger.
 */
export const accountState = pgTable('account_state', {
  userId: text('user_id').primaryKey(),
  status: text('status').notNull(),
  reason: text('reason'),
  paused: boolean('paused').notNull().default(false),
  pausedReason: text('paused_reason'),
  frozen: boolean('frozen').notNull().default(false),
  frozenReason: text('frozen_reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});
```

- [x] **Step 4: Generate the first migration**

Run: `npm run db:generate -- --name pause_and_freeze`
Expected: `drizzle/0003_pause_and_freeze.sql` with four `ADD COLUMN` statements, plus
`drizzle/meta/0003_snapshot.json` and a new journal entry. No prompt appears, because the diff
only adds columns. If your drizzle-kit ignores `--name` and invents one, rename the `.sql` file
and its `tag` in `drizzle/meta/_journal.json` to `0003_pause_and_freeze`, so the migration test
finds it.

- [x] **Step 5: Add the backfill to that migration by hand**

Append to `drizzle/0003_pause_and_freeze.sql` (after the last `ADD COLUMN`, with a breakpoint
before it):

```sql
--> statement-breakpoint
-- Every account keeps the state it already had.
UPDATE "account_state" SET
  "paused" = ("status" = 'paused'),
  "frozen" = ("status" = 'frozen'),
  "paused_reason" = CASE WHEN "status" = 'paused' THEN "reason" END,
  "frozen_reason" = CASE WHEN "status" = 'frozen' THEN "reason" END;
```

- [x] **Step 6: Drop the old columns from the schema and generate the second migration**

Remove these two lines from `accountState` in `src/db/schema.ts`:

```ts
  status: text('status').notNull(),
  reason: text('reason'),
```

Run: `npm run db:generate -- --name drop_account_status`
Expected: `drizzle/0004_drop_account_status.sql` with two `DROP COLUMN` statements. The diff only
drops columns, so again there is no prompt.

- [x] **Step 7: Run the migration test**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: PASS.

- [x] **Step 8: Make the rest of the code compile**

`src/paper/paperAccount.ts:145` inserts the old columns. Replace that line with:

```ts
      await tx.insert(accountState).values({ userId: options.userId, paused: false, frozen: false, updatedAt: options.at });
```

In `tests/state/accountState.test.ts`, replace the insert in `withAccount`:

```ts
  await database().insert(accountState).values({ userId: 'founder', paused: false, frozen: false, updatedAt: AT });
```

`src/state/accountState.ts` still reads `row.status`; Task 2 rewrites it. To keep this task
compiling, change `toRecord` to derive the status:

```ts
function toRecord(row: typeof accountState.$inferSelect): AccountRecord {
  const status: AccountStatus = row.frozen ? 'frozen' : row.paused ? 'paused' : 'active';
  return { userId: row.userId, status, reason: row.frozen ? row.frozenReason : row.pausedReason, updatedAt: row.updatedAt };
}
```

and change the four writers to set the new columns, leaving their rules alone for now:

```ts
  async freeze(userId: string, cycleDate: string | null, reason: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status === 'frozen') {
      return;
    }
    await this.#change(userId, { frozen: true, frozenReason: reason }, 'FROZEN', cycleDate, at, { reason });
  }

  async unfreeze(userId: string, reason: string, at: Date): Promise<void> {
    if (reason.trim() === '') {
      throw new Error('unfreezing needs a reason');
    }
    const current = await this.#require(userId);
    if (current.status !== 'frozen') {
      throw new Error(`"${userId}" is ${current.status}, not frozen`);
    }
    await this.#change(userId, { frozen: false, frozenReason: null }, 'UNFROZEN', null, at, { reason: reason.trim() });
  }

  async pause(userId: string, reason: string | null, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'active') {
      throw new Error(`"${userId}" is ${current.status}; only an active account can be paused`);
    }
    await this.#change(userId, { paused: true, pausedReason: reason }, 'PAUSED', null, at, { reason });
  }

  async resume(userId: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'paused') {
      throw new Error(`"${userId}" is ${current.status}, not paused`);
    }
    await this.#change(userId, { paused: false, pausedReason: null }, 'RESUMED', null, at, { reason: null });
  }

  async #change(
    userId: string,
    fields: Partial<typeof accountState.$inferInsert>,
    type: 'FROZEN' | 'UNFROZEN' | 'PAUSED' | 'RESUMED',
    cycleDate: string | null,
    at: Date,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(accountState).set({ ...fields, updatedAt: at }).where(eq(accountState.userId, userId));
      await tx.insert(ledgerEvents).values({ occurredAt: at, userId, cycleDate, type, payload });
    });
  }
```

Delete the now-unused `STATUSES` constant at the top of the file.

- [x] **Step 9: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS, with the same number of tests as before plus the new one.

- [x] **Step 10: Commit**

```bash
git add src/db/schema.ts src/state/accountState.ts src/paper/paperAccount.ts drizzle tests/db/migrations.test.ts tests/state/accountState.test.ts
git commit -m "feat: record a pause and a freeze as separate facts on an account"
git push
```

---

## Task 2: A freeze never lifts a pause

**Files:**
- Modify: `src/state/accountState.ts`
- Modify: `tests/state/accountState.test.ts`

- [x] **Step 1: Write the failing tests**

Replace the test `pauses only an active account and resumes only a paused one` in
`tests/state/accountState.test.ts` with these four, and keep every other test as it is:

```ts
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
```

- [x] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/state/accountState.test.ts`
Expected: FAIL — `already paused` is not thrown, `paused` is not a property of the record, and
pausing a frozen account throws `only an active account`.

- [x] **Step 3: Make pause and freeze independent**

In `src/state/accountState.ts`, widen the record and change the four rules:

```ts
export type AccountRecord = {
  userId: string;
  /** Derived: frozen first, then paused, then active. */
  status: AccountStatus;
  /** Why it is in that status, when a reason was given. */
  reason: string | null;
  /** The user's own stop. */
  paused: boolean;
  pausedReason: string | null;
  /** The engine's stop, which only a person lifts. */
  frozen: boolean;
  frozenReason: string | null;
  updatedAt: Date;
};

function toRecord(row: typeof accountState.$inferSelect): AccountRecord {
  const status: AccountStatus = row.frozen ? 'frozen' : row.paused ? 'paused' : 'active';
  return {
    userId: row.userId,
    status,
    reason: row.frozen ? row.frozenReason : row.pausedReason,
    paused: row.paused,
    pausedReason: row.pausedReason,
    frozen: row.frozen,
    frozenReason: row.frozenReason,
    updatedAt: row.updatedAt,
  };
}
```

Then the rules. Only the guards and the payloads change:

```ts
  /** Stops an account trading after something the engine did not understand. Already frozen: no change. */
  async freeze(userId: string, cycleDate: string | null, reason: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.frozen) {
      return;
    }
    await this.#change(userId, { frozen: true, frozenReason: reason }, 'FROZEN', cycleDate, at, {
      reason,
      alsoPaused: current.paused,
    });
  }

  /** Lifting a freeze needs a person, and a reason that goes on the record. A pause underneath it stays. */
  async unfreeze(userId: string, reason: string, at: Date): Promise<void> {
    if (reason.trim() === '') {
      throw new Error('unfreezing needs a reason');
    }
    const current = await this.#require(userId);
    if (!current.frozen) {
      throw new Error(`"${userId}" is ${current.status}, not frozen`);
    }
    await this.#change(userId, { frozen: false, frozenReason: null }, 'UNFROZEN', null, at, {
      reason: reason.trim(),
      stillPaused: current.paused,
    });
  }

  /**
   * The user's own stop. It can be set while the account is frozen, so that
   * lifting the freeze does not let the next tick trade.
   */
  async pause(userId: string, reason: string | null, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.paused) {
      throw new Error(`"${userId}" is already paused`);
    }
    await this.#change(userId, { paused: true, pausedReason: reason }, 'PAUSED', null, at, {
      reason,
      alsoFrozen: current.frozen,
    });
  }

  /** Lifts the user's own stop. A freeze underneath it stays. */
  async resume(userId: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (!current.paused) {
      throw new Error(`"${userId}" is ${current.status}, not paused`);
    }
    await this.#change(userId, { paused: false, pausedReason: null }, 'RESUMED', null, at, {
      stillFrozen: current.frozen,
    });
  }
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/state/accountState.test.ts`
Expected: PASS.

- [x] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/state/accountState.ts tests/state/accountState.test.ts
git commit -m "feat: keep a user's pause when a freeze is lifted"
git push
```

---

## Task 3: The commands and the reminder say what is left in place

**Files:**
- Modify: `src/cli/pause.ts`, `src/cli/resume.ts`, `src/cli/unfreeze.ts`
- Modify: `src/engine/cycle.ts` — the `reminder` function near the end of the file
- Modify: `tests/engine/cycleFailures.test.ts`

- [x] **Step 1: Write the failing test**

Add this to `tests/engine/cycleFailures.test.ts`, inside
`describe('frozen, paused, and stopped accounts', ...)`:

```ts
  it('names both stops in the daily reminder when an account is paused and frozen', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    await h.accounts.freeze('founder', DAY_ONE, 'a partial fill', new Date(h.clock.now));
    await runTick(h.deps);
    const [reminder] = h.alerts.messages.filter((m) => m.startsWith('Reminder:'));
    expect(reminder).toContain('frozen: a partial fill');
    expect(reminder).toContain('paused: travelling');
    expect(reminder).toContain('npm run unfreeze');
    expect(reminder).toContain('npm run resume');
  });
```

- [x] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/engine/cycleFailures.test.ts -t "names both stops"`
Expected: FAIL — the reminder names only the frozen state.

- [x] **Step 3: Rewrite the reminder**

In `src/engine/cycle.ts`, replace `reminder`:

```ts
function reminder(account: AccountRecord): string {
  const say = (state: string, why: string | null) => (why === null ? state : `${state}: ${why.replace(/\.\s*$/, '')}`);
  const stops: string[] = [];
  if (account.frozen) {
    stops.push(say('frozen', account.frozenReason));
  }
  if (account.paused) {
    stops.push(say('paused', account.pausedReason));
  }
  const unfreeze = 'npm run unfreeze -- --reason "what you found"';
  const how =
    account.frozen && account.paused ? `${unfreeze} and then npm run resume` : account.frozen ? unfreeze : 'npm run resume';
  return `Reminder: ${account.userId} is ${stops.join(', and ')}. Nothing trades on it until you run ${how}.`;
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/engine/cycleFailures.test.ts`
Expected: PASS, including the existing reminder tests, which check the prefixes
`Reminder: founder is frozen` and `Reminder: founder is paused`.

- [x] **Step 5: Say what stays in place, in each command**

`src/cli/pause.ts` — replace the body inside the `try`:

```ts
    await engine.accounts.pause(engine.config.userId, values.reason?.trim() || null, new Date());
    const account = await engine.accounts.get(engine.config.userId);
    console.log(`Paused "${engine.config.userId}". Nothing trades until you run npm run resume.`);
    if (account?.frozen === true) {
      console.log('It is also frozen for review, so lifting that freeze will not start trading while it is paused.');
    }
    return 0;
```

`src/cli/resume.ts`:

```ts
    await engine.accounts.resume(engine.config.userId, new Date());
    const account = await engine.accounts.get(engine.config.userId);
    console.log(
      account?.frozen === true
        ? `Resumed "${engine.config.userId}", but it stays frozen for review. Run npm run unfreeze -- --reason "what you found" when you have checked it.`
        : `Resumed "${engine.config.userId}". It trades again from the next tick.`,
    );
    return 0;
```

`src/cli/unfreeze.ts`:

```ts
    await engine.accounts.unfreeze(engine.config.userId, reason, new Date());
    const account = await engine.accounts.get(engine.config.userId);
    console.log(
      account?.paused === true
        ? `Unfroze "${engine.config.userId}". It stays paused, as its user left it; run npm run resume to trade again.`
        : `Unfroze "${engine.config.userId}". If today's run has not completed, the next tick runs it.`,
    );
    return 0;
```

- [x] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/cli/pause.ts src/cli/resume.ts src/cli/unfreeze.ts src/engine/cycle.ts tests/engine/cycleFailures.test.ts
git commit -m "feat: say which stop is left in place after a pause, resume or unfreeze"
git push
```

---

## Task 4: A recorded result can be read back as an order state

**Files:**
- Create: `src/ledger/orderEvents.ts`
- Create: `tests/ledger/orderEvents.test.ts`

- [x] **Step 1: Write the failing test**

Create `tests/ledger/orderEvents.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { orderStateFrom } from '../../src/ledger/orderEvents.js';
import type { OrderState } from '../../src/exchange/trading.js';

const FILLED: OrderState = {
  clientOrderId: 'ca0123456789',
  side: 'BUY',
  status: 'FILLED',
  filledBaseQty: new Decimal('0.01174'),
  filledQuoteAmount: new Decimal('998.92'),
  avgPrice: new Decimal('85087.73'),
  fee: new Decimal('0.00001174'),
  feeCoin: 'BTC',
  rejectReason: null,
};

/** What the ledger stores: Decimal#toJSON writes strings, and JSON round-trips. */
const stored = (state: OrderState) => JSON.parse(JSON.stringify({ ...state })) as Record<string, unknown>;

describe('orderStateFrom', () => {
  it('reads a filled order back exactly, with decimals intact', () => {
    const state = orderStateFrom(stored(FILLED));
    expect(state).toEqual(FILLED);
    expect(state.filledBaseQty.equals(FILLED.filledBaseQty)).toBe(true);
  });

  it('reads a rejected order, with its reason and no price', () => {
    const rejected: OrderState = {
      ...FILLED,
      status: 'REJECTED',
      filledBaseQty: new Decimal(0),
      filledQuoteAmount: new Decimal(0),
      avgPrice: null,
      fee: new Decimal(0),
      rejectReason: 'minimum order amount',
    };
    expect(orderStateFrom(stored(rejected))).toEqual(rejected);
  });

  it('refuses a payload that is not a settled order', () => {
    expect(() => orderStateFrom({ clientOrderId: 'ca1', status: 'NOT_PLACED' })).toThrow('NOT_PLACED');
  });
});
```

- [x] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/ledger/orderEvents.test.ts`
Expected: FAIL — cannot find `src/ledger/orderEvents.ts`.

- [x] **Step 3: Write the module**

Create `src/ledger/orderEvents.ts`:

```ts
import Decimal from 'decimal.js';
import type { OrderSide, OrderState, OrderStatus } from '../exchange/trading.js';

const STATUSES: readonly string[] = ['FILLED', 'PARTIALLY_FILLED_CANCELLED', 'REJECTED', 'PENDING'];
const SIDES: readonly string[] = ['BUY', 'SELL'];

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`the order result has no ${field}`);
  }
  return value;
}

function decimal(value: unknown, field: string): Decimal {
  const amount = new Decimal(text(value, field));
  if (!amount.isFinite()) {
    throw new Error(`the order result's ${field} is not a number`);
  }
  return amount;
}

/**
 * A recorded ORDER_RESULT payload, read back as the order state it describes.
 * Decimals are stored as strings by Decimal#toJSON, so they come back exact.
 * A NOT_PLACED result is not an order state: nothing was ever placed.
 */
export function orderStateFrom(payload: Record<string, unknown>): OrderState {
  const status = text(payload.status, 'status');
  if (!STATUSES.includes(status)) {
    throw new Error(`"${status}" is not an order state that can be read back`);
  }
  const side = text(payload.side, 'side');
  if (!SIDES.includes(side)) {
    throw new Error(`"${side}" is not an order side`);
  }
  const avgPrice = payload.avgPrice;
  const rejectReason = payload.rejectReason;
  return {
    clientOrderId: text(payload.clientOrderId, 'client order ID'),
    side: side as OrderSide,
    status: status as OrderStatus,
    filledBaseQty: decimal(payload.filledBaseQty, 'filled quantity'),
    filledQuoteAmount: decimal(payload.filledQuoteAmount, 'filled amount'),
    avgPrice: avgPrice === null || avgPrice === undefined ? null : decimal(avgPrice, 'average price'),
    fee: decimal(payload.fee, 'fee'),
    feeCoin: text(payload.feeCoin, 'fee coin'),
    rejectReason: rejectReason === null || rejectReason === undefined ? null : String(rejectReason),
  };
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/ledger/orderEvents.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/ledger/orderEvents.ts tests/ledger/orderEvents.test.ts
git commit -m "feat: read a recorded order result back as an order state"
git push
```

---

## Task 5: A run reports a fill that was recorded earlier

Today a run knows about its own fill only if this tick settled it. Once an order can settle while
an account is paused, the run that follows must still report it.

**Files:**
- Modify: `src/engine/cycle.ts`
- Modify: `tests/engine/cycleFailures.test.ts`

- [x] **Step 1: Write the failing test**

Add to `tests/engine/cycleFailures.test.ts`, in `describe('orders whose outcome is uncertain', ...)`:

```ts
  it('reports the day’s fill in the summary when an earlier tick recorded it', async () => {
    const h = await setup();
    // The order fills and its result is recorded, and then reconciliation cannot
    // read the balances, so the run finishes at a later tick than the fill.
    let reads = 0;
    h.wrap = (account) =>
      withBalances(account, async () => {
        reads += 1;
        if (reads === 2) {
          throw new Error('bybit is unreachable');
        }
        return account.getBalances();
      });
    const [interrupted] = ran(await runTick(h.deps));
    expect(interrupted!.result).toBe('RETRY_LATER');
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['FILLED']);

    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(h.alerts.messages.at(-1)).toContain('Bought');
  });
```

- [x] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/engine/cycleFailures.test.ts -t "reports the day"`
Expected: FAIL — the last alert says `no change`. The fill was recorded by the first tick, but the
second tick asks `settleOutstanding` for it, and that only reports a fill it settled itself.

- [x] **Step 3: Read the day's fill from the ledger**

In `src/engine/cycle.ts`, import the reader:

```ts
import { orderStateFrom } from '../ledger/orderEvents.js';
```

Change the settlement type and drop `todaysFill` from it:

```ts
type Settlement = { kind: 'CLEAR' } | Stop;
```

In `settleOutstanding`, delete the `let todaysFill` line, the `if (intentDate === date)` block,
and return `{ kind: 'CLEAR' }` at the end.

In `runUser`, replace `let filled = settled.todaysFill;` with:

```ts
    let filled = await filledToday(deps, userId, date);
```

Add this function next to `settleOutstanding`:

```ts
/**
 * The day's own order, if it has already filled — from the ledger, so a fill
 * settled by an earlier tick, or while the account was paused, is still the
 * fill this run reports.
 */
async function filledToday(deps: CycleDeps, userId: string, date: string): Promise<OrderState | null> {
  for (const order of await deps.ledger.ordersOn(userId, date)) {
    if (order.result !== null && order.result.payload.status === 'FILLED') {
      return orderStateFrom(order.result.payload);
    }
  }
  return null;
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/engine/cycleFailures.test.ts && npx vitest run tests/engine/cycle.test.ts`
Expected: PASS.

- [x] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/engine/cycle.ts tests/engine/cycleFailures.test.ts
git commit -m "feat: report the day's fill from the ledger, however it was settled"
git push
```

---

## Task 6: Settling one order becomes its own module

A refactor with no change in behaviour: every existing test must pass untouched.

**Files:**
- Create: `src/engine/settleOrders.ts`
- Modify: `src/engine/cycle.ts`

- [x] **Step 1: Write the module**

Create `src/engine/settleOrders.ts`:

```ts
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
 * which retries at the next tick.
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
```

- [x] **Step 2: Use it from the run**

In `src/engine/cycle.ts`: delete the two `*_FREEZE_AFTER_MS` constants and their comments, and
import them, with the settler, from the new module:

```ts
import { settleOneOrder } from './settleOrders.js';
```

Replace the whole body of `settleOutstanding` with:

```ts
async function settleOutstanding(run: Run, account: TradingAccount): Promise<Settlement> {
  const { deps, userId, date, at } = run;
  for (const intent of await deps.ledger.outstandingIntents(userId)) {
    const verdict = await settleOneOrder(deps, userId, account, intent, at, date);
    if (verdict.kind === 'WAIT') {
      return waiting(run, verdict.reason);
    }
    if (verdict.kind === 'FREEZE') {
      return { kind: 'STOPPED', outcome: await freeze(run, verdict.reason) };
    }
    if (verdict.kind === 'SETTLED' && verdict.state.status !== 'FILLED') {
      return { kind: 'STOPPED', outcome: await freeze(run, unfilledReason(verdict.state)) };
    }
  }
  return { kind: 'CLEAR' };
}
```

Delete `recordResult`, which nothing calls now. Keep its doc comment's meaning in
`settleOrders.ts`. `placeOrder` still records its own result; leave that call as it is — it
writes `payload: { ...state }` directly.

- [x] **Step 3: Run everything, with nothing else changed**

Run: `npm run typecheck && npm test`
Expected: PASS, with exactly the same tests as before this task. If a test fails, the refactor
changed behaviour — fix the refactor, not the test.

- [x] **Step 4: Commit**

```bash
git add src/engine/settleOrders.ts src/engine/cycle.ts
git commit -m "refactor: settle one order in its own module, with a verdict for its caller"
git push
```

---

## Task 7: Orders settle while an account is paused or frozen

**Files:**
- Modify: `src/engine/cycle.ts`
- Create: `tests/engine/settleWhileStopped.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/engine/settleWhileStopped.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  failsAfterPlacing,
  harness,
  hidesOrders,
  openFounder,
  ran,
  setMarket,
  SlowAccount,
  tickTimeAfter,
  type Harness,
} from '../helpers/engine.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DAY_ONE = lastDay(UP);
const MINUTE = 60_000;

async function setup(): Promise<Harness> {
  const h = harness(database());
  setMarket(h, UP);
  h.clock.now = tickTimeAfter(DAY_ONE);
  await openFounder(database());
  return h;
}

/** Places the day's order, leaves it unsettled, then stops the account. */
async function orderInFlight(h: Harness, stop: (at: Date) => Promise<void>): Promise<void> {
  h.wrap = failsAfterPlacing;
  ran(await runTick(h.deps));
  expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  h.wrap = (account) => account;
  await stop(new Date(h.clock.now));
}

const results = async (h: Harness) => (await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status);

describe('an order already sent, on an account that is not trading', () => {
  it('settles while the account is paused, records it, and places nothing', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    h.clock.now += 15 * MINUTE;

    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
    expect(h.alerts.messages.some((m) => m.includes('paused') && m.includes('has now settled'))).toBe(true);
  });

  it('settles while the account is frozen, and leaves the freeze and its reason alone', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.freeze('founder', DAY_ONE, 'a partial fill', at));
    h.clock.now += 15 * MINUTE;

    await runTick(h.deps);
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', reason: 'a partial fill' });
  });

  it('freezes a paused account whose order comes back unfilled, and keeps the pause', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    // The account reports the order as only partly filled.
    h.wrap = (account) => ({
      getBalances: () => account.getBalances(),
      placeMarketOrder: (order) => account.placeMarketOrder(order),
      getOrder: async (id) => {
        const lookup = await account.getOrder(id);
        return lookup.kind === 'FOUND'
          ? { kind: 'FOUND', state: { ...lookup.state, status: 'PARTIALLY_FILLED_CANCELLED' } }
          : lookup;
      },
    });
    h.clock.now += 15 * MINUTE;

    await runTick(h.deps);
    expect(await results(h)).toEqual(['PARTIALLY_FILLED_CANCELLED']);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', paused: true });
    await h.accounts.unfreeze('founder', 'checked on Bybit', new Date(h.clock.now));
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
  });

  it('freezes a paused account whose order stays invisible for an hour', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));

    h.clock.now += 61 * MINUTE;
    await runTick(h.deps);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', paused: true });
    expect(await results(h)).toEqual([]);
  });

  it('waits, recording nothing, while a paused account’s order is still pending', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    ran(await runTick(h.deps));
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));

    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(await results(h)).toEqual([]);
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
  });

  it('costs no exchange call when a stopped account has nothing outstanding', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    const before = h.market.calls.rules;

    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.market.calls.rules).toBe(before);
  });

  it('completes the day when the account is resumed after its fill was recorded', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);

    await h.accounts.resume('founder', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.at(-1)).toContain('Bought');
  });
});
```

Two details about this file:

- `FakeMarket` already counts every call in `market.calls`, so the sixth test needs no helper
  change.
- The third test replaces one method of the account, so annotate its return type, or TypeScript
  widens `kind` to `string`:

```ts
import type { OrderLookup } from '../../src/exchange/trading.js';
```

```ts
      getOrder: async (id): Promise<OrderLookup> => {
```

- [x] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/settleWhileStopped.test.ts`
Expected: FAIL — no result is recorded for any stopped account.

- [x] **Step 3: Settle for accounts that are not trading**

In `src/engine/cycle.ts`, add these three functions after `settleOutstanding`:

```ts
/**
 * Settles orders already sent for accounts that are not trading: paused,
 * frozen, or — while the kill switch is on — every account. It records what the
 * account says and alerts, and it never sizes, places, or reconciles anything
 * (Phase 2a spec, section 4). The instrument's rules are read only when there is
 * something to settle, so a tick with nothing outstanding costs no request.
 */
async function settleWhileStopped(deps: CycleDeps, accounts: AccountRecord[], date: string, at: Date): Promise<void> {
  const waiting: { account: AccountRecord; intents: LedgerEvent[] }[] = [];
  for (const account of accounts) {
    const intents = await deps.ledger.outstandingIntents(account.userId);
    if (intents.length > 0) {
      waiting.push({ account, intents });
    }
  }
  if (waiting.length === 0) {
    return;
  }
  const rules = await deps.market.getInstrumentRules(deps.symbol);
  for (const { account, intents } of waiting) {
    const userId = account.userId;
    for (const intent of intents) {
      const verdict = await settleOneOrder(deps, userId, deps.accountFor(userId), intent, at, date);
      if (verdict.kind === 'WAIT') {
        break;
      }
      if (verdict.kind === 'NOT_PLACED') {
        await deps.alerter.send(
          `${stopped(account)}; order ${verdict.id} from ${verdict.intentDate} was never placed, and is recorded as such. Nothing was sent in its place.`,
        );
        continue;
      }
      if (verdict.kind === 'SETTLED' && verdict.state.status === 'FILLED') {
        await deps.alerter.send(
          `${stopped(account)}; order ${verdict.id} from ${verdict.intentDate} has now settled: ${describeFill(verdict.state, rules)}. Nothing was traded in its place.`,
        );
        continue;
      }
      const reason = verdict.kind === 'FREEZE' ? verdict.reason : unfilledReason(verdict.state);
      if (account.frozen) {
        await deps.alerter.send(`${stopped(account)}; ${reason}. The account stays frozen.`);
      } else {
        await freeze({ deps, userId, date, at }, reason);
      }
      break;
    }
  }
}

/** Settling must never fail a tick: the next one tries again. */
async function settleWhileStoppedSafely(
  deps: CycleDeps,
  accounts: AccountRecord[],
  date: string,
  at: Date,
): Promise<void> {
  try {
    await settleWhileStopped(deps, accounts, date, at);
  } catch (error) {
    const reason = describeError(error);
    if (await deps.alertLog.claim(`${date}:system:settlement`, at)) {
      await deps.alerter.send(`Orders already sent could not be settled: ${reason}. The next tick tries again.`);
    }
  }
}

function stopped(account: AccountRecord): string {
  if (account.frozen) {
    return `${account.userId} is frozen`;
  }
  return account.paused ? `${account.userId} is paused` : `${account.userId} is stopped by the kill switch`;
}
```

Add the import of the ledger event type at the top:

```ts
import type { Ledger, LedgerEvent } from '../ledger/ledger.js';
```

(The file already imports `Ledger`; extend that line rather than adding a second import.)

Add `describeFill`, and use it in `summary` so both say the same thing:

```ts
/** "bought 0.011740 BTC for 998.92 USDT at 85087.73" */
function describeFill(state: OrderState, rules: InstrumentRules): string {
  const verb = state.side === 'BUY' ? 'bought' : 'sold';
  const price = state.avgPrice === null ? 'an unknown price' : state.avgPrice.toFixed(2);
  return `${verb} ${state.filledBaseQty.toFixed()} ${rules.baseCoin} for ${state.filledQuoteAmount.toFixed(2)} ${rules.quoteCoin} at ${price}`;
}
```

In `summary`, replace the last three lines with:

```ts
  const fill = describeFill(filled, rules);
  return `${run.date}: ${target}. ${fill[0]!.toUpperCase()}${fill.slice(1)}. ${now}${lateText}`;
```

Then call the new pass in `runTick`, right after the reminder loop and before `needing` is built:

```ts
  await settleWhileStoppedSafely(
    deps,
    accounts.filter((account) => account.status !== 'active'),
    date,
    at,
  );
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/engine/settleWhileStopped.test.ts`
Expected: PASS.

- [x] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/engine/cycle.ts tests/engine/settleWhileStopped.test.ts
git commit -m "feat: settle orders already sent for accounts that are not trading"
git push
```

---

## Task 8: The kill switch stops new orders, not settlement

**Files:**
- Modify: `src/engine/cycle.ts`
- Modify: `tests/engine/settleWhileStopped.test.ts`

- [x] **Step 1: Write the failing test**

Add to `tests/engine/settleWhileStopped.test.ts`:

```ts
describe('the kill switch', () => {
  it('settles orders already sent, while placing nothing and reporting itself', async () => {
    const h = await setup();
    await orderInFlight(h, async () => {
      h.kill.on = true;
    });
    h.clock.now += 15 * MINUTE;

    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(await h.ledger.ofType('KILL_SWITCH_SKIP', null)).toHaveLength(1);
    expect(h.alerts.messages.filter((m) => m.startsWith('The kill switch is on'))).toHaveLength(1);
    expect(h.alerts.messages.some((m) => m.includes('stopped by the kill switch'))).toBe(true);
  });

  it('freezes an account whose order has been invisible for an hour, even while it is on', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.kill.on = true;

    h.clock.now += 61 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect((await h.accounts.get('founder'))?.status).toBe('frozen');
  });
});
```

- [x] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/settleWhileStopped.test.ts -t "kill switch"`
Expected: FAIL — nothing is recorded, because the tick returns before reading any account.

- [x] **Step 3: Settle inside the kill-switch branch**

In `runTick`, replace the kill-switch block with:

```ts
  if (deps.killSwitch.isOn()) {
    if (await deps.alertLog.claim(`${date}:system:kill-switch`, at)) {
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'KILL_SWITCH_SKIP', payload: {} });
      await deps.alerter.send(`The kill switch is on, so nothing trades for ${date}.`);
    }
    // Nothing new is sent, but an order already on its way still gets its one
    // recorded answer: an operator stop is when the record matters most.
    await settleWhileStoppedSafely(deps, await deps.accounts.all(), date, at);
    return { kind: 'KILL_SWITCH' };
  }
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/engine/settleWhileStopped.test.ts`
Expected: PASS, including the existing kill-switch tests in `tests/engine/cycleFailures.test.ts`.

- [x] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/engine/cycle.ts tests/engine/settleWhileStopped.test.ts
git commit -m "feat: keep settling orders already sent while the kill switch is on"
git push
```

---

## Task 9: Recording what a person found

**Files:**
- Create: `src/app/recordOrderOutcome.ts`
- Create: `tests/app/recordOrderOutcome.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/app/recordOrderOutcome.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { recordOrderOutcome, type RecordDeps } from '../../src/app/recordOrderOutcome.js';
import type { OrderLookup, TradingAccount } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { useTestDatabase } from '../helpers/database.js';
import { RULES } from '../helpers/market.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T02:00:00Z');
const ID = 'ca0123456789';

const account = (answer: OrderLookup | (() => never)): TradingAccount => ({
  getBalances: async () => [],
  placeMarketOrder: async () => {
    throw new Error('the command never places an order');
  },
  getOrder: async () => (typeof answer === 'function' ? answer() : answer),
});

async function deps(answer: OrderLookup | (() => never) = { kind: 'NOT_VISIBLE' }): Promise<RecordDeps> {
  const ledger = new Ledger(database());
  await ledger.append({
    occurredAt: new Date('2026-09-22T00:02:00Z'),
    userId: 'founder',
    cycleDate: '2026-09-21',
    type: 'ORDER_INTENT',
    payload: { clientOrderId: ID, intent: 'ENTER_LONG', attempt: 1, side: 'BUY', quoteAmount: '999' },
  });
  return { ledger, account: account(answer), rules: RULES, now: () => AT };
}

const request = {
  userId: 'founder',
  clientOrderId: ID,
  evidence: 'Bybit order history for 21 Sep shows no such order',
};

describe('recordOrderOutcome', () => {
  it('records that an invisible order was never placed, under the intent’s own day', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result).toMatchObject({ status: 'recorded', cycleDate: '2026-09-21' });
    const [recorded] = await d.ledger.ofType('ORDER_RESULT', 'founder');
    expect(recorded).toMatchObject({
      cycleDate: '2026-09-21',
      payload: { clientOrderId: ID, status: 'NOT_PLACED', source: 'operator', evidence: request.evidence },
    });
  });

  it('records a fill with its amounts and a price worked out from them', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, {
      ...request,
      outcome: {
        status: 'FILLED',
        base: new Decimal('0.01174'),
        quote: new Decimal('998.92'),
        fee: new Decimal('0.00001174'),
        feeCoin: 'BTC',
      },
    });
    expect(result.status).toBe('recorded');
    const [recorded] = await d.ledger.ofType('ORDER_RESULT', 'founder');
    expect(recorded?.payload).toMatchObject({
      status: 'FILLED',
      side: 'BUY',
      filledBaseQty: '0.01174',
      filledQuoteAmount: '998.92',
      source: 'operator',
    });
    expect(new Decimal(String(recorded?.payload.avgPrice)).toFixed(2)).toBe('85087.73');
  });

  it('refuses when the exchange can see the order', async () => {
    const d = await deps({
      kind: 'FOUND',
      state: {
        clientOrderId: ID,
        side: 'BUY',
        status: 'FILLED',
        filledBaseQty: new Decimal('0.01'),
        filledQuoteAmount: new Decimal('850'),
        avgPrice: new Decimal('85000'),
        fee: new Decimal(0),
        feeCoin: 'BTC',
        rejectReason: null,
      },
    });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result).toMatchObject({ status: 'refused' });
    expect(result.status === 'refused' && result.reason).toContain('can see');
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses when the account proves the order absent', async () => {
    const d = await deps({ kind: 'ABSENT' });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('proves');
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses when the exchange cannot be asked', async () => {
    const d = await deps(() => {
      throw new Error('the lookup timed out');
    });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('the lookup timed out');
  });

  it('refuses an order that is not waiting for an answer', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, clientOrderId: 'ca-nothing', outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('npm run status');
  });

  it('refuses amounts that cannot be right', async () => {
    const d = await deps();
    const filled = { status: 'FILLED' as const, base: new Decimal('0.01'), quote: new Decimal('850'), fee: new Decimal(0), feeCoin: 'BTC' };
    const cases = [
      { ...filled, base: new Decimal(0) },
      { ...filled, quote: new Decimal(-1) },
      { ...filled, fee: new Decimal(-1) },
      { ...filled, feeCoin: 'ETH' },
    ];
    for (const outcome of cases) {
      expect(await recordOrderOutcome(d, { ...request, outcome })).toMatchObject({ status: 'refused' });
    }
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses without evidence', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, evidence: '   ', outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('what you checked');
  });
});
```

- [x] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/app/recordOrderOutcome.test.ts`
Expected: FAIL — cannot find `src/app/recordOrderOutcome.ts`.

- [x] **Step 3: Write the module**

Create `src/app/recordOrderOutcome.ts`:

```ts
import type Decimal from 'decimal.js';
import type { OrderSide, OrderState, TradingAccount } from '../exchange/trading.js';
import type { Ledger } from '../ledger/ledger.js';
import type { InstrumentRules } from '../market/types.js';

/** What a person found on the exchange. Only a settled outcome can be recorded. */
export type Outcome =
  | { status: 'NOT_PLACED' }
  | { status: 'REJECTED' }
  | { status: 'FILLED' | 'PARTIALLY_FILLED_CANCELLED'; base: Decimal; quote: Decimal; fee: Decimal; feeCoin: string };

export type RecordDeps = {
  ledger: Ledger;
  /** The account the order was sent to, asked once more before anything is recorded. */
  account: TradingAccount;
  rules: InstrumentRules;
  now: () => Date;
};

export type RecordRequest = {
  userId: string;
  clientOrderId: string;
  outcome: Outcome;
  /** What the person checked, and what it showed. Kept on the record. */
  evidence: string;
};

export type RecordResult =
  | { status: 'recorded'; clientOrderId: string; cycleDate: string | null; outcome: Outcome }
  | { status: 'refused'; reason: string };

function amountProblem(outcome: Outcome, rules: InstrumentRules): string | null {
  if (outcome.status === 'NOT_PLACED' || outcome.status === 'REJECTED') {
    return null;
  }
  if (!outcome.base.isFinite() || outcome.base.lte(0)) {
    return 'the quantity that filled must be above zero';
  }
  if (!outcome.quote.isFinite() || outcome.quote.lte(0)) {
    return 'the amount that filled must be above zero';
  }
  if (!outcome.fee.isFinite() || outcome.fee.isNegative()) {
    return 'the fee cannot be negative';
  }
  if (outcome.feeCoin !== rules.baseCoin && outcome.feeCoin !== rules.quoteCoin) {
    return `the fee coin must be ${rules.baseCoin} or ${rules.quoteCoin}`;
  }
  return null;
}

function stateFrom(outcome: Outcome, clientOrderId: string, side: OrderSide, rules: InstrumentRules, evidence: string): OrderState {
  const feeCoin = side === 'BUY' ? rules.baseCoin : rules.quoteCoin;
  if (outcome.status === 'REJECTED') {
    return {
      clientOrderId,
      side,
      status: 'REJECTED',
      filledBaseQty: ZERO,
      filledQuoteAmount: ZERO,
      avgPrice: null,
      fee: ZERO,
      feeCoin,
      rejectReason: evidence,
    };
  }
  if (outcome.status === 'NOT_PLACED') {
    throw new Error('a non-placement has no order state');
  }
  return {
    clientOrderId,
    side,
    status: outcome.status,
    filledBaseQty: outcome.base,
    filledQuoteAmount: outcome.quote,
    avgPrice: outcome.quote.div(outcome.base),
    fee: outcome.fee,
    feeCoin: outcome.feeCoin,
    rejectReason: null,
  };
}

/**
 * Records the one result for an order the exchange cannot show, on a person's
 * evidence. The exchange's own answer always wins: if it can see the order, or
 * prove it was never placed, this refuses and the engine records that itself at
 * the next tick. It changes no account status: unfreezing stays a separate,
 * deliberate step.
 */
export async function recordOrderOutcome(deps: RecordDeps, request: RecordRequest): Promise<RecordResult> {
  const evidence = request.evidence.trim();
  if (evidence === '') {
    return { status: 'refused', reason: 'say what you checked, and what it showed, for the record' };
  }

  const intent = (await deps.ledger.outstandingIntents(request.userId)).find(
    (event) => String(event.payload.clientOrderId) === request.clientOrderId,
  );
  if (intent === undefined) {
    return {
      status: 'refused',
      reason: `no order ${request.clientOrderId} is waiting for an answer on "${request.userId}"; npm run status lists the ones that are`,
    };
  }

  let lookup;
  try {
    lookup = await deps.account.getOrder(request.clientOrderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'refused', reason: `the exchange could not be asked about this order: ${message}. Try again when it answers` };
  }
  if (lookup.kind === 'FOUND') {
    return {
      status: 'refused',
      reason: `the exchange can see order ${request.clientOrderId}: it is ${lookup.state.status}. The engine records that itself at the next tick`,
    };
  }
  if (lookup.kind === 'ABSENT') {
    return {
      status: 'refused',
      reason: `the account proves order ${request.clientOrderId} was never placed. The engine records that itself at the next tick`,
    };
  }

  const problem = amountProblem(request.outcome, deps.rules);
  if (problem !== null) {
    return { status: 'refused', reason: problem };
  }

  const side = String(intent.payload.side) as OrderSide;
  const payload =
    request.outcome.status === 'NOT_PLACED'
      ? { clientOrderId: request.clientOrderId, status: 'NOT_PLACED', source: 'operator', evidence }
      : { ...stateFrom(request.outcome, request.clientOrderId, side, deps.rules, evidence), source: 'operator', evidence };

  await deps.ledger.append({
    occurredAt: deps.now(),
    userId: request.userId,
    cycleDate: intent.cycleDate,
    type: 'ORDER_RESULT',
    payload,
  });
  return { status: 'recorded', clientOrderId: request.clientOrderId, cycleDate: intent.cycleDate, outcome: request.outcome };
}
```

Add the zero constant at the top of the file, next to the imports:

```ts
import Decimal from 'decimal.js';

const ZERO = new Decimal(0);
```

(and change the type-only import of `Decimal` above to this value import).

- [x] **Step 4: Run the tests**

Run: `npx vitest run tests/app/recordOrderOutcome.test.ts`
Expected: PASS.

- [x] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/app/recordOrderOutcome.ts tests/app/recordOrderOutcome.test.ts
git commit -m "feat: record a person's finding for an order the exchange cannot show"
git push
```

---

## Task 10: The `order:record` command, and `status` lists what is waiting

**Files:**
- Create: `src/cli/order-record.ts`
- Modify: `src/cli/status.ts`, `package.json`

- [x] **Step 1: Write the command**

Create `src/cli/order-record.ts`:

```ts
import Decimal from 'decimal.js';
import { parseArgs } from 'node:util';
import { recordOrderOutcome, type Outcome } from '../app/recordOrderOutcome.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

const STATUSES = new Map<string, Outcome['status']>([
  ['not-placed', 'NOT_PLACED'],
  ['rejected', 'REJECTED'],
  ['filled', 'FILLED'],
  ['partly-filled', 'PARTIALLY_FILLED_CANCELLED'],
]);

const USAGE = `Record what you found for an order the exchange cannot show:
  npm run order:record -- --order <id> --status not-placed --reason "what you checked"
  npm run order:record -- --order <id> --status rejected --reason "..."
  npm run order:record -- --order <id> --status filled --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
  npm run order:record -- --order <id> --status partly-filled --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
npm run status lists the orders waiting for an answer.`;

function amount(value: string | undefined, flag: string): Decimal {
  if (value === undefined) {
    throw new Error(`${flag} is needed for this status`);
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      order: { type: 'string' },
      status: { type: 'string' },
      reason: { type: 'string' },
      base: { type: 'string' },
      quote: { type: 'string' },
      fee: { type: 'string' },
      'fee-coin': { type: 'string' },
    },
  });
  const clientOrderId = values.order?.trim() ?? '';
  const status = STATUSES.get(values.status?.trim() ?? '');
  const evidence = values.reason?.trim() ?? '';
  if (clientOrderId === '' || status === undefined || evidence === '') {
    console.error(USAGE);
    return 1;
  }
  const outcome: Outcome =
    status === 'NOT_PLACED' || status === 'REJECTED'
      ? { status }
      : {
          status,
          base: amount(values.base, '--base'),
          quote: amount(values.quote, '--quote'),
          fee: amount(values.fee, '--fee'),
          feeCoin: values['fee-coin']?.trim().toUpperCase() ?? '',
        };

  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const result = await recordOrderOutcome(
      {
        ledger: engine.ledger,
        account: engine.deps.accountFor(userId),
        rules: await engine.market.getInstrumentRules(SYMBOL),
        now: () => new Date(),
      },
      { userId, clientOrderId, outcome, evidence },
    );
    if (result.status === 'refused') {
      console.error(`Nothing was recorded: ${result.reason}.`);
      return 1;
    }
    console.log(
      `Recorded ${values.status} for order ${clientOrderId}${result.cycleDate === null ? '' : `, under ${result.cycleDate}`}.`,
    );
    const account = await engine.accounts.get(userId);
    console.log(
      account?.frozen === true
        ? 'The account is still frozen. When you have finished checking, run: npm run unfreeze -- --reason "what you found"'
        : 'The account is unchanged.',
    );
    return 0;
  } finally {
    await engine.close();
  }
});
```

Add the script to `package.json`, after `"unfreeze"`:

```json
    "order:record": "tsx src/cli/order-record.ts",
```

- [x] **Step 2: List what is waiting, in `status`**

In `src/cli/status.ts`, read the rules alongside the price. Replace the price block with:

```ts
    let price: Decimal | null = null;
    let rules: InstrumentRules | null = null;
    try {
      rules = await engine.market.getInstrumentRules(SYMBOL);
      price = midPrice(await engine.market.getOrderBook(SYMBOL));
    } catch {
      // Shown as unavailable below; status must still work when Bybit does not.
    }
```

with these imports added at the top:

```ts
import type { InstrumentRules } from '../market/types.js';
import { formatDuration } from '../engine/cycle.js';
```

Then, after the run line and before `return 0`:

```ts
    const outstanding = await engine.ledger.outstandingIntents(userId);
    if (outstanding.length === 0) {
      console.log('No order is waiting for an answer.');
    } else {
      console.log('Orders waiting for an answer:');
      for (const intent of outstanding) {
        const what =
          intent.payload.side === 'BUY'
            ? `buy with up to ${String(intent.payload.quoteAmount)}${rules === null ? '' : ` ${rules.quoteCoin}`}`
            : `sell ${String(intent.payload.baseQty)}${rules === null ? '' : ` ${rules.baseCoin}`}`;
        console.log(
          `  ${String(intent.payload.clientOrderId)}  ${what}, for ${intent.cycleDate ?? 'no day'}, sent ${formatDuration(Date.now() - intent.occurredAt.getTime())} ago`,
        );
      }
      console.log('Check them on the exchange, then record what you find: npm run order:record');
    }
```

- [x] **Step 3: Check both commands by hand**

Run: `npm run typecheck && npm test`
Expected: PASS.

Run: `npm run status`
Expected: it prints the account, the balances, and `No order is waiting for an answer.`

Run: `npm run order:record`
Expected: the usage text, and exit code 1.

Run: `npm run order:record -- --order ca-nothing --status not-placed --reason "checked"`
Expected: `Nothing was recorded: no order ca-nothing is waiting for an answer on "founder"; npm run status lists the ones that are.`

- [x] **Step 4: Commit**

```bash
git add src/cli/order-record.ts src/cli/status.ts package.json
git commit -m "feat: add the order:record command, and list waiting orders in status"
git push
```

---

## Task 11: The dead end, reproduced and cleared

**Files:**
- Modify: `tests/engine/settleWhileStopped.test.ts`

- [x] **Step 1: Write the failing test**

Add to `tests/engine/settleWhileStopped.test.ts`. The first test documents the trap and must pass
as it is; the second needs the command from Task 9 and proves the way out.

```ts
describe('an order the exchange cannot show', () => {
  it('freezes again after an unfreeze, because time never proves an order was not placed', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    expect(ran(await runTick(h.deps))[0]!.result).toBe('FROZEN');

    await h.accounts.unfreeze('founder', 'looking into it', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    expect(ran(await runTick(h.deps))[0]!.result).toBe('FROZEN');
    expect(await results(h)).toEqual([]);
  });

  it('is cleared by recording what the founder found, and the day then completes', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    ran(await runTick(h.deps));

    const [intent] = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const recorded = await recordOrderOutcome(
      {
        ledger: h.ledger,
        account: h.deps.accountFor('founder'),
        rules: RULES,
        now: () => new Date(h.clock.now),
      },
      {
        userId: 'founder',
        clientOrderId: String(intent!.payload.clientOrderId),
        outcome: { status: 'NOT_PLACED' },
        evidence: 'Bybit order history shows nothing for that day',
      },
    );
    expect(recorded.status).toBe('recorded');

    // The order the founder checked was in fact placed, so the account is
    // already long: the run reconciles rather than buying again.
    await h.accounts.unfreeze('founder', 'recorded what Bybit showed', new Date(h.clock.now));
    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });
});
```

Add the imports this file now needs:

```ts
import { recordOrderOutcome } from '../../src/app/recordOrderOutcome.js';
import { RULES } from '../helpers/market.js';
```

- [x] **Step 2: Run them**

Run: `npx vitest run tests/engine/settleWhileStopped.test.ts -t "exchange cannot show"`
Expected: PASS. Both describe behaviour that Tasks 6 to 9 already built: the first is the trap
the spec's gap 2 describes, the second is the way out.

If the second test fails because the run places a second order, stop: that would mean sizing did
not see the balances the first order produced, which is a defect worth understanding before going
on.

- [x] **Step 3: Commit**

```bash
git add tests/engine/settleWhileStopped.test.ts
git commit -m "test: reproduce the invisible-order dead end, and clear it"
git push
```

---

## Task 12: The documents

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md`
- Modify: `docs/superpowers/specs/2026-09-22-customer-prototype-design.md`
- Modify: `docs/decisions.md`, `docs/deploy-vps.md`, `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-09-23-phase-2a-order-settlement.md` (this file)

- [x] **Step 1: The parent spec**

In `2026-09-22-phase-2-paper-engine-design.md`, add to the header, after the `Revised:` bullet:

```markdown
- **Revised by Phase 2a**, `2026-09-23-phase-2a-order-settlement-design.md`: orders already sent
  are settled for accounts that are not trading, including under the kill switch (section 4); a
  pause and a freeze are independent facts on `account_state` (section 8); and the way to record
  what a person found for an order the exchange cannot show, which section 13 carried forward,
  now exists.
```

- [x] **Step 2: The prototype spec**

In `2026-09-22-customer-prototype-design.md`, section 9, change R1's first line to:

```markdown
- **R1 — Reconcile orders while paused or stopped. Built**, on `phase-2a-order-settlement`
  (`2026-09-23-phase-2a-order-settlement-design.md`).
```

- [x] **Step 3: The decision log**

Add this to `docs/decisions.md`, immediately before `## Corrections made along the way`. Number
it after the last numbered entry — 24, unless another has been added since.

```markdown
## 24. What happens to an order already sent — DECIDED 2026-09-23

Full design: `docs/superpowers/specs/2026-09-23-phase-2a-order-settlement-design.md`.

- **The kill switch means no new orders**, not a silent engine: an order already sent is still
  looked up and recorded, and an account can still be frozen. An operator stop is when the record
  matters most, and reading back an order the engine itself sent changes nothing on the exchange.
  *Rejected:* the earlier meaning, where the engine did nothing at all, which left the ledger
  missing a trade the exchange had already made. A complete stop already exists, and is now in the
  runbook: `systemctl disable --now crypto-autotrader-cycle.timer`.
- **A pause and a freeze are independent facts.** The user owns the pause, the engine owns the
  freeze, and lifting one never lifts the other. *Rejected:* one status, where unfreezing an
  account its user had paused would have started trading again on it — which becomes possible as
  soon as settling can freeze a paused account.
- **A person may record any settled outcome for an order the exchange cannot show** — never
  placed, rejected, filled, or partly filled with its amounts — with the evidence they checked,
  and only while the exchange still cannot show it. Without it, an order stuck invisible freezes
  the account for good: unfreezing leads straight back to the same freeze, and the ledger cannot
  be edited. *Rejected:* allowing only "never placed", which leaves a partial fill or a rejection
  just as stuck; letting a person's word override what the exchange can actually see.
```

- [x] **Step 4: The runbook**

In `docs/deploy-vps.md`, add a short section, *Stopping, and orders already sent*:

- `npm run kill-switch -- on --reason "why"` stops new orders. Orders already sent are still
  checked and recorded, and an account can still be frozen.
- `sudo systemctl disable --now crypto-autotrader-cycle.timer` stops the engine completely. Use it when the
  engine itself is the problem.
- An order the exchange cannot show freezes the account after an hour. Check it on the exchange,
  record what you found with `npm run order:record`, then `npm run unfreeze`.

- [x] **Step 5: `CLAUDE.md`**

- In the state table, add a row for Phase 2a: code complete on `phase-2a-order-settlement`, with
  the test count after this work.
- In the commands table, add `npm run order:record`.
- In the merge order, put `phase-2a-order-settlement` after `phase-2-paper-engine`.
- In *Rules that are not negotiable*, add: an order that has been sent always gets exactly one
  recorded answer, whatever state its account is in.

- [x] **Step 6: Write the execution notes**

At the end of this plan, add an `## Execution notes` section: what was built, anything that
differed from the plan and why, the final test count, and any limitation accepted.

- [x] **Step 7: Run everything one last time**

Run: `npm run typecheck && npm test && npm audit --omit=dev`
Expected: PASS, no vulnerability in production dependencies.

- [x] **Step 8: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record what Phase 2a changes, and how to stop the engine"
git push
```

---

## Done when

1. Every task's checkboxes are ticked, and every test in the spec's section 9 exists.
2. `npm test`, `npm run typecheck`, the parity test, and `npm audit --omit=dev` pass.
3. The branch is pushed. **The founder decides when it merges and when it reaches the VPS**:
   during the fourteen paper-trading days, deploying it would mix two versions of the engine into
   the evidence.

---

## Execution notes

Built on 2026-09-23, inline, task by task. **537 tests pass** (508 before, 29 new), the type
check is clean, and `npm audit --omit=dev` finds no vulnerabilities.

**Before the first task, a flaky test.** The baseline run failed intermittently in
`tests/ops/lock.test.ts`. The cross-process tests started each contender through the `tsx`
command, which runs the script in a child process of its own, so killing the process the test
spawned left the real lock holder alive — on Windows until its job object killed it a moment
later, and on Linux indefinitely, which would have failed the `npm test` the runbook asks for on
the VPS. Contenders now run through `node --import tsx` in the spawned process itself, and print
their process ID for the test to check. Fixed on `phase-2-paper-engine` (`3eef71b`) and merged
in; five consecutive full runs passed.

**The workflow changed midway.** Tasks 1 to 6 were committed straight to this branch. From Task
7 on, at the founder's request, each task shipped as its own pull request into it, merged with a
merge commit: #1 (Task 7) to #6 (Task 12).

**Where the build differs from the plan:**

- **Task 6.** `recordResult` stays: `placeOrder` still records its own result through it. The
  plan said nothing called it.
- **Task 7.** `FakeMarket` already counts its calls in `market.calls`, so the test reads
  `calls.rules` and no helper changed.
- **Task 9.** The plan's expected average price was wrong: 998.92 / 0.01174 is 85086.88, not
  85087.73. The code was right; the test was corrected, and a case for recording a rejection was
  added. The same wrong figure in a code comment was corrected in Task 12.
- **Task 10.** `status` reads the instrument's rules only when an order is waiting, in its own
  `try`, so a normal `status` makes no extra request and a failed read leaves the coins unnamed
  instead of hiding the price. Tried by hand against a throwaway database, never the founder's.
- **Task 12.** The engine's timer is `crypto-autotrader-cycle.timer`, not
  `crypto-autotrader.timer` as the spec and this plan first said; both are corrected. The
  runbook already had a *Stopping* section, which was extended rather than replaced. The
  prototype spec lives on `product-prototype`, so its R1 line is updated there, in its own pull
  request. `CLAUDE.md` also gained the pull-request workflow, since Claude's memory is local to
  each machine.

**Limitations accepted:**

- **A person's recorded finding is final.** If the exchange later shows something different,
  nothing notices until trade-history reconciliation (R2) in Phase 2b. A wrong finding cannot
  trade twice, because sizing reads real balances, but it can leave the record wrong — the
  second test in Task 11 shows exactly that.
- **Manual trading on a stopped account is not detected until it trades again.** Settling reads
  no balances. R2 again.
- **The migration was tested on a bare database** built from the earlier migrations, holding an
  active, a paused and a frozen account. It has not met real data: this machine has no database,
  and the VPS has none yet.
