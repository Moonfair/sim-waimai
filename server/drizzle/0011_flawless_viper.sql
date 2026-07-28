ALTER TABLE "orders" ADD COLUMN "delivery_type" text DEFAULT 'simulated' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rider_user_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "grabbed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_rider_user_id_users_id_fk" FOREIGN KEY ("rider_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_rider_hall_idx" ON "orders" USING btree ("delivery_type","status","rider_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_type_check" CHECK ("orders"."delivery_type" IN ('simulated', 'real_person'));