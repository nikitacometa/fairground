CREATE TABLE "draw_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_id" uuid NOT NULL,
	"epoch_id" bigint NOT NULL,
	"wallet_address" text NOT NULL,
	"tickets" bigint DEFAULT 0 NOT NULL,
	"wagered_microalgo" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"epoch_id" bigint NOT NULL,
	"state" text DEFAULT 'committed' NOT NULL,
	"pot_microalgo" bigint DEFAULT 0 NOT NULL,
	"rollover_microalgo" bigint DEFAULT 0 NOT NULL,
	"total_tickets" bigint DEFAULT 0 NOT NULL,
	"total_entries" bigint DEFAULT 0 NOT NULL,
	"commit_round" bigint DEFAULT 0 NOT NULL,
	"vrf_round" bigint,
	"beacon_output" text,
	"winner_address" text,
	"winner_nfd" text,
	"winner_payout_microalgo" bigint,
	"runners_up" jsonb,
	"commit_txn_id" text,
	"resolve_txn_id" text,
	"proof_card_url" text,
	"drawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "app_id" bigint;--> statement-breakpoint
ALTER TABLE "draw_tickets" ADD CONSTRAINT "draw_tickets_draw_id_draws_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draw_tickets_epoch_wallet_unique" ON "draw_tickets" USING btree ("epoch_id","wallet_address");--> statement-breakpoint
CREATE INDEX "draw_tickets_epoch_idx" ON "draw_tickets" USING btree ("epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draws_epoch_id_unique" ON "draws" USING btree ("epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draws_resolve_txn_id_unique" ON "draws" USING btree ("resolve_txn_id") WHERE "draws"."resolve_txn_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "draws_drawn_at_idx" ON "draws" USING btree ("drawn_at");--> statement-breakpoint
CREATE INDEX "sessions_app_id_idx" ON "sessions" USING btree ("app_id");