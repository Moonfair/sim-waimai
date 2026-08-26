DROP INDEX "changelog_entries_version_idx";--> statement-breakpoint
ALTER TABLE "changelog_entries" ALTER COLUMN "version_major" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "changelog_entries" ALTER COLUMN "version_minor" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "changelog_entries" ALTER COLUMN "version_patch" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "changelog_entries" DROP COLUMN "version";