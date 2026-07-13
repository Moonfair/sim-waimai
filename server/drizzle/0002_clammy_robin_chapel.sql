ALTER TABLE "menu_items" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
CREATE INDEX "menu_items_review_status_idx" ON "menu_items" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "restaurants_review_status_idx" ON "restaurants" USING btree ("review_status");--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_review_status_check" CHECK ("menu_items"."review_status" IN ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_review_status_check" CHECK ("restaurants"."review_status" IN ('pending', 'approved', 'rejected'));