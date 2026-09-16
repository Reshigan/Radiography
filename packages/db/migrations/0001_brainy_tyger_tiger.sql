CREATE TABLE `agent_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`hand_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`title` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`steps` text NOT NULL,
	`leash_checks` text NOT NULL,
	`approval_persona` text,
	`approval_reason` text,
	`approved_by` text,
	`approved_at` text,
	`error` text,
	`llm_used` integer DEFAULT false NOT NULL,
	`aggregate_type` text,
	`aggregate_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_tasks_status` ON `agent_tasks` (`status`,`practice_id`);--> statement-breakpoint
CREATE INDEX `agent_tasks_hand` ON `agent_tasks` (`hand_id`);--> statement-breakpoint
CREATE TABLE `hands` (
	`id` text PRIMARY KEY NOT NULL,
	`hand_id` text NOT NULL,
	`practice_id` text,
	`name` text NOT NULL,
	`module` text NOT NULL,
	`mandate` text NOT NULL,
	`level` text NOT NULL,
	`leash` text NOT NULL,
	`approval_policy` text,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
