CREATE TABLE `publication_tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	`publication` integer NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`publication`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `publication_tags_idx_tag` ON `publication_tags` (`tag`);--> statement-breakpoint
CREATE INDEX `publication_tags_idx_publication` ON `publication_tags` (`publication`);--> statement-breakpoint
CREATE UNIQUE INDEX `publication_tags_publication_tag_unique` ON `publication_tags` (`publication`,`tag`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_citations` (
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
);
--> statement-breakpoint
INSERT INTO `__new_citations`("id", "created", "updated", "experiment", "from", "to", "from_experiment", "to_experiment") SELECT "id", "created", "updated", "experiment", "from", "to", "experiment", "experiment" FROM `citations`;--> statement-breakpoint
DROP TABLE `citations`;--> statement-breakpoint
ALTER TABLE `__new_citations` RENAME TO `citations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `citations_idx_from` ON `citations` (`from`);--> statement-breakpoint
CREATE INDEX `citations_idx_to` ON `citations` (`to`);--> statement-breakpoint
CREATE INDEX `citations_idx_from_experiment` ON `citations` (`from_experiment`);--> statement-breakpoint
CREATE INDEX `citations_idx_to_experiment` ON `citations` (`to_experiment`);--> statement-breakpoint
CREATE UNIQUE INDEX `citations_from_to_unique` ON `citations` (`from`,`to`);--> statement-breakpoint
ALTER TABLE `agents` ADD `clearance` text DEFAULT 'INTERNAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `publications` ADD `restriction` text DEFAULT 'INTERNAL' NOT NULL;