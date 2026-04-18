-- Migration: Add publication restrictions and tags support
-- This migration adds:
-- 1. clearance field to agents table (INTERNAL/PUBLIC)
-- 2. restriction field to publications table (INTERNAL/PUBLIC)
-- 3. publication_tags table for thematic tagging
-- 4. from_experiment and to_experiment fields to citations for cross-experiment support

-- Add clearance column to agents table
ALTER TABLE `agents` ADD `clearance` text DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint

-- Add restriction column to publications table
ALTER TABLE `publications` ADD `restriction` text DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint

-- Create publication_tags table
CREATE TABLE `publication_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`publication` integer NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint

-- Add indexes for publication_tags
CREATE UNIQUE INDEX `publication_tags_publication_tag_unique` ON `publication_tags` (`publication`,`tag`);--> statement-breakpoint
CREATE INDEX `publication_tags_idx_tag` ON `publication_tags` (`tag`);--> statement-breakpoint
CREATE INDEX `publication_tags_idx_publication` ON `publication_tags` (`publication`);--> statement-breakpoint

-- Add from_experiment and to_experiment columns to citations
-- First, add the new columns with temporary values
ALTER TABLE `citations` ADD `from_experiment` integer;--> statement-breakpoint
ALTER TABLE `citations` ADD `to_experiment` integer;--> statement-breakpoint

-- Populate from_experiment and to_experiment from existing experiment column
UPDATE `citations` SET `from_experiment` = `experiment`, `to_experiment` = `experiment`;--> statement-breakpoint

-- Now make them NOT NULL (SQLite doesn't support ALTER COLUMN, so we need to recreate)
-- Create a temporary table with the new schema
CREATE TABLE `citations_new` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`experiment` integer,
	`from` integer NOT NULL,
	`to` integer NOT NULL,
	`from_experiment` integer NOT NULL,
	`to_experiment` integer NOT NULL,
	FOREIGN KEY (`experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_experiment`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint

-- Copy data from old table to new table
INSERT INTO `citations_new` SELECT `id`, `created`, `updated`, `experiment`, `from`, `to`, `from_experiment`, `to_experiment` FROM `citations`;--> statement-breakpoint

-- Drop old table
DROP TABLE `citations`;--> statement-breakpoint

-- Rename new table to original name
ALTER TABLE `citations_new` RENAME TO `citations`;--> statement-breakpoint

-- Recreate indexes for citations (with updated unique constraint)
CREATE UNIQUE INDEX `citations_from_to_unique` ON `citations` (`from`,`to`);--> statement-breakpoint
CREATE INDEX `citations_idx_from` ON `citations` (`from`);--> statement-breakpoint
CREATE INDEX `citations_idx_to` ON `citations` (`to`);--> statement-breakpoint
CREATE INDEX `citations_idx_from_experiment` ON `citations` (`from_experiment`);--> statement-breakpoint
CREATE INDEX `citations_idx_to_experiment` ON `citations` (`to_experiment`);
