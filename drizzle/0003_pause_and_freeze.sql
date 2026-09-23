ALTER TABLE "account_state" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_state" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "account_state" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_state" ADD COLUMN "frozen_reason" text;--> statement-breakpoint
-- Every account keeps the state it already had.
UPDATE "account_state" SET
  "paused" = ("status" = 'paused'),
  "frozen" = ("status" = 'frozen'),
  "paused_reason" = CASE WHEN "status" = 'paused' THEN "reason" END,
  "frozen_reason" = CASE WHEN "status" = 'frozen' THEN "reason" END;
