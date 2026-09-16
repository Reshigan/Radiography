CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`user_id` text,
	`persona` text,
	`action` text NOT NULL,
	`object_type` text,
	`object_id` text,
	`details` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_object` ON `audit_log` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `entity_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text NOT NULL,
	`child_id` text NOT NULL,
	`type` text NOT NULL,
	`fee_model` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `legal_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_id`) REFERENCES `legal_entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`name` text NOT NULL,
	`aggregate_type` text,
	`aggregate_id` text,
	`payload` text NOT NULL,
	`actor_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`processed_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `events_unprocessed` ON `events` (`processed_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`practice_id` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`registered_name` text NOT NULL,
	`trading_name` text,
	`cipc_no` text,
	`vat_no` text,
	`tax_no` text,
	`bhf_practice_no` text,
	`accession_prefix` text,
	`financial_year_end` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `modalities` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`site_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`type` text NOT NULL,
	`vendor` text,
	`model` text,
	`serial` text,
	`ae_title` text,
	`install_date` text,
	`warranty_until` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_qa_at` text,
	`next_qa_due` text,
	`next_pm_due` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `patient_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`assigning_authority` text,
	`value` text NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`epid` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`date_of_birth` text,
	`sex` text,
	`language` text DEFAULT 'en' NOT NULL,
	`mobile` text,
	`email` text,
	`id_type` text,
	`id_number` text,
	`id_country` text,
	`id_verified_at` text,
	`scheme_id` text,
	`scheme_name` text,
	`scheme_option` text,
	`member_no` text,
	`dependant_code` text,
	`address` text,
	`guardian_patient_id` text,
	`consents` text,
	`flags` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patients_practice` ON `patients` (`practice_id`);--> statement-breakpoint
CREATE INDEX `patients_epid` ON `patients` (`epid`);--> statement-breakpoint
CREATE INDEX `patients_name` ON `patients` (`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `reference_data` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`practice_id` text,
	`value` text NOT NULL,
	`effective_from` text DEFAULT '2000-01-01' NOT NULL,
	`effective_to` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `refdata_kind_key` ON `reference_data` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `referrers` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`name` text NOT NULL,
	`hpcsa_no` text,
	`hpcsa_verified_at` text,
	`bhf_practice_no` text,
	`discipline` text,
	`practice_name` text,
	`phone` text,
	`email` text,
	`delivery_prefs` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`name` text NOT NULL,
	`room_type` text NOT NULL,
	`licence_no` text,
	`licence_expiry` text,
	`rpo_user_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`practice_id` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shareholdings` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`shareholder_entity_id` text,
	`shareholder_user_id` text,
	`shareholder_name` text NOT NULL,
	`share_class` text DEFAULT 'ordinary' NOT NULL,
	`shares` integer NOT NULL,
	`voting_pct` integer,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `legal_entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shareholder_entity_id`) REFERENCES `legal_entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`province` text,
	`lat` integer,
	`lng` integer,
	`phone` text,
	`opening_hours` text,
	`hospital_partner_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `legal_entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sites_practice` ON `sites` (`practice_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`persona` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`hpcsa_no` text,
	`hpcsa_verified_at` text,
	`password_hash` text NOT NULL,
	`mfa_enabled` integer DEFAULT false NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`site_ids` text,
	`patient_id` text,
	`referrer_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email` ON `users` (`email`);