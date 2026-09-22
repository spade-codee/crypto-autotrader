CREATE TABLE "account_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_log" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_runs" (
	"cycle_date" date NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"last_error" text,
	CONSTRAINT "cycle_runs_cycle_date_user_id_pk" PRIMARY KEY("cycle_date","user_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"user_id" text,
	"cycle_date" date,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_balances" (
	"user_id" text NOT NULL,
	"coin" text NOT NULL,
	"free" numeric(38, 18) NOT NULL,
	CONSTRAINT "paper_balances_user_id_coin_pk" PRIMARY KEY("user_id","coin")
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"client_order_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"requested" numeric(38, 18) NOT NULL,
	"status" text NOT NULL,
	"filled_base_qty" numeric(38, 18) NOT NULL,
	"filled_quote_amount" numeric(38, 18) NOT NULL,
	"avg_price" numeric(38, 18),
	"fee" numeric(38, 18) NOT NULL,
	"fee_coin" text NOT NULL,
	"reject_reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ledger_events_user_idx" ON "ledger_events" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "ledger_events_day_idx" ON "ledger_events" USING btree ("cycle_date","type");