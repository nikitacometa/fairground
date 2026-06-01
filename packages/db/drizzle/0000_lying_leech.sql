CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"game_id" text NOT NULL,
	"amount_microalgo" bigint NOT NULL,
	"vrf_round" bigint NOT NULL,
	"vrf_output" text,
	"salt_hash" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"multiplier" integer,
	"net_payout_microalgo" bigint,
	"referrer_wallet" text,
	"referral_rake_bps" integer,
	"txn_id" text,
	"resolve_txn_id" text,
	"proof_card_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jackpot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_microalgo" bigint DEFAULT 0 NOT NULL,
	"contribution_bps" integer DEFAULT 0 NOT NULL,
	"win_odds_one_in" integer DEFAULT 1000 NOT NULL,
	"last_trigger_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"wins" bigint DEFAULT 0 NOT NULL,
	"losses" bigint DEFAULT 0 NOT NULL,
	"total_volume_microalgo" bigint DEFAULT 0 NOT NULL,
	"wins_amount_microalgo" bigint DEFAULT 0 NOT NULL,
	"losses_amount_microalgo" bigint DEFAULT 0 NOT NULL,
	"jackpot_hits" bigint DEFAULT 0 NOT NULL,
	"last_round" bigint DEFAULT 0 NOT NULL,
	"games_played" bigint DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"wallet_address" text NOT NULL,
	"game_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"commit_round" bigint NOT NULL,
	"resolve_round" bigint,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_wallet_idx" ON "bets" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "bets_vrf_round_idx" ON "bets" USING btree ("vrf_round");--> statement-breakpoint
CREATE INDEX "bets_outcome_idx" ON "bets" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "bets_txn_id_unique" ON "bets" USING btree ("txn_id") WHERE "bets"."txn_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bets_resolve_txn_id_unique" ON "bets" USING btree ("resolve_txn_id") WHERE "bets"."resolve_txn_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lb_wallet_idx" ON "leaderboard_snapshots" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "lb_wins_idx" ON "leaderboard_snapshots" USING btree ("wins");--> statement-breakpoint
CREATE INDEX "lb_volume_idx" ON "leaderboard_snapshots" USING btree ("total_volume_microalgo");--> statement-breakpoint
CREATE INDEX "sessions_state_idx" ON "sessions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "sessions_commit_round_idx" ON "sessions" USING btree ("commit_round");--> statement-breakpoint
CREATE INDEX "sessions_wallet_idx" ON "sessions" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_wallet_commit_round_unique" ON "sessions" USING btree ("wallet_address","commit_round");--> statement-breakpoint
CREATE INDEX "sessions_bet_id_idx" ON "sessions" USING btree ("bet_id");