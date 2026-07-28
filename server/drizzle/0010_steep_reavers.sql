CREATE TABLE "banned_devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"banned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"banned_reason" text,
	"banned_by" text NOT NULL,
	"banned_from_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "user_devices" (
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "banned_devices" ADD CONSTRAINT "banned_devices_banned_from_user_id_users_id_fk" FOREIGN KEY ("banned_from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_devices_device_idx" ON "user_devices" USING btree ("device_id");