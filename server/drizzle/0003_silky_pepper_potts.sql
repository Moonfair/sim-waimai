ALTER TABLE "menu_items" ADD COLUMN "ai_verdict" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "ai_confidence" real;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "ai_verdict" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "ai_confidence" real;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_ai_verdict_check" CHECK ("menu_items"."ai_verdict" IN ('approve', 'reject', 'uncertain'));--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_ai_verdict_check" CHECK ("restaurants"."ai_verdict" IN ('approve', 'reject', 'uncertain'));