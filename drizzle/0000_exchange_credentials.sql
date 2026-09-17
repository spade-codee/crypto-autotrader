CREATE TABLE "exchange_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exchange" text NOT NULL,
	"environment" text NOT NULL,
	"api_key_hint" text NOT NULL,
	"key_version" integer NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_credentials_owner_idx" ON "exchange_credentials" USING btree ("user_id","exchange","environment");