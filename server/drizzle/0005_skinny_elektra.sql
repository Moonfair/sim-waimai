ALTER TABLE "reviews" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_verdict" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ai_confidence" real;--> statement-breakpoint
CREATE INDEX "reviews_review_status_idx" ON "reviews" USING btree ("review_status");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_review_status_check" CHECK ("reviews"."review_status" IN ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ai_verdict_check" CHECK ("reviews"."ai_verdict" IN ('approve', 'reject', 'uncertain'));