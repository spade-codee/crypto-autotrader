-- The ledger is the track record: history may only grow.
CREATE FUNCTION ledger_events_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON ledger_events
  FOR EACH ROW EXECUTE FUNCTION ledger_events_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_events_no_truncate
  BEFORE TRUNCATE ON ledger_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_events_reject_change();
--> statement-breakpoint
-- Each client order ID has exactly one intent and at most one result (spec section 4.2).
CREATE UNIQUE INDEX ledger_events_one_intent_per_order
  ON ledger_events ((payload->>'clientOrderId'))
  WHERE type = 'ORDER_INTENT';
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_events_one_result_per_order
  ON ledger_events ((payload->>'clientOrderId'))
  WHERE type = 'ORDER_RESULT';
