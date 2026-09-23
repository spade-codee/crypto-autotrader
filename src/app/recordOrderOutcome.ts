import Decimal from 'decimal.js';
import type { OrderLookup, OrderSide, OrderState, TradingAccount } from '../exchange/trading.js';
import type { Ledger } from '../ledger/ledger.js';
import type { InstrumentRules } from '../market/types.js';

const ZERO = new Decimal(0);

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

/** The order state a settled outcome describes, in the fields the engine itself records. */
function stateFrom(
  outcome: Exclude<Outcome, { status: 'NOT_PLACED' }>,
  clientOrderId: string,
  side: OrderSide,
  rules: InstrumentRules,
  evidence: string,
): OrderState {
  if (outcome.status === 'REJECTED') {
    return {
      clientOrderId,
      side,
      status: 'REJECTED',
      filledBaseQty: ZERO,
      filledQuoteAmount: ZERO,
      avgPrice: null,
      fee: ZERO,
      // The coin a fee would have been charged in, as the paper account records it.
      feeCoin: side === 'BUY' ? rules.baseCoin : rules.quoteCoin,
      rejectReason: evidence,
    };
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
 * deliberate step (Phase 2a spec, section 6).
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

  let lookup: OrderLookup;
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
