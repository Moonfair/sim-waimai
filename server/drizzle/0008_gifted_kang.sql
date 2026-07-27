CREATE TABLE "moderation_alert_state" (
	"id" text PRIMARY KEY NOT NULL,
	"is_breaching" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
