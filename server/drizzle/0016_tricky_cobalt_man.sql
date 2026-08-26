ALTER TABLE "changelog_entries" ADD COLUMN "version_major" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "version_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "changelog_entries" ADD COLUMN "version_patch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "changelog_entries_version_parts_idx" ON "changelog_entries" USING btree ("version_major","version_minor","version_patch");