CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`order_no` text NOT NULL,
	`site_id` text,
	`patient_id` text NOT NULL,
	`referrer_id` text,
	`referral_id` text,
	`channel` text DEFAULT 'portal' NOT NULL,
	`procedures` text NOT NULL,
	`priority` text DEFAULT 'routine' NOT NULL,
	`icd10` text NOT NULL,
	`clinical_info` text,
	`justification` text DEFAULT 'justified' NOT NULL,
	`justification_note` text,
	`appropriateness` text,
	`recent_study` text,
	`protocolling_required` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`appointment_id` text,
	`funding_case_id` text,
	`funder_type` text,
	`cancel_reason` text,
	`created_by` text,
	`valid_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orders_practice_status` ON `orders` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_patient` ON `orders` (`patient_id`);--> statement-breakpoint
CREATE INDEX `orders_referrer` ON `orders` (`referrer_id`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`channel` text NOT NULL,
	`source_name` text,
	`source_contact` text,
	`raw_text` text,
	`photo_text` text,
	`artefact_hash` text,
	`patient_id` text,
	`referrer_id` text,
	`parsed` text,
	`confidence` integer,
	`status` text DEFAULT 'received' NOT NULL,
	`needs_info` text,
	`order_id` text,
	`task_id` text,
	`reject_reason` text,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `referrals_practice_status` ON `referrals` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `referrals_patient` ON `referrals` (`patient_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`order_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text NOT NULL,
	`modality_type` text NOT NULL,
	`procedure_code` text NOT NULL,
	`procedure_description` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`source` text DEFAULT 'desk' NOT NULL,
	`booked_by` text,
	`hold_expires_at` text,
	`reminders_sent` text,
	`no_show_score` integer,
	`no_show_model` text,
	`distance_km` integer,
	`constraints_evaluated` text,
	`soft_overrides` text,
	`rescheduled_from_id` text,
	`cancel_reason` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `appointments_room_time` ON `appointments` (`room_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_site_time` ON `appointments` (`site_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_patient` ON `appointments` (`patient_id`);--> statement-breakpoint
CREATE INDEX `appointments_order` ON `appointments` (`order_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`channel` text DEFAULT 'whatsapp' NOT NULL,
	`mobile` text NOT NULL,
	`patient_id` text,
	`referral_id` text,
	`order_id` text,
	`appointment_id` text,
	`state` text DEFAULT 'new' NOT NULL,
	`offers` text,
	`messages` text NOT NULL,
	`handed_over_reason` text,
	`claimed_by` text,
	`last_task_id` text,
	`misunderstandings` integer DEFAULT 0 NOT NULL,
	`opt_in` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_mobile` ON `conversations` (`mobile`);--> statement-breakpoint
CREATE INDEX `conversations_practice_state` ON `conversations` (`practice_id`,`state`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text DEFAULT 'whatsapp' NOT NULL,
	`due_at` text NOT NULL,
	`sent_at` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`text` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reminders_due` ON `reminders` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `slot_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text NOT NULL,
	`modality_type` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`slot_minutes` integer NOT NULL,
	`duration_by_procedure` text,
	`block_type` text DEFAULT 'open' NOT NULL,
	`walk_in_reserve_pct` integer DEFAULT 0 NOT NULL,
	`effective_from` text DEFAULT '2026-01-01' NOT NULL,
	`effective_to` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `slot_templates_room_day` ON `slot_templates` (`room_id`,`weekday`);--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`order_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`procedure_code` text NOT NULL,
	`modality_type` text NOT NULL,
	`site_id` text,
	`radius_km` integer DEFAULT 30 NOT NULL,
	`priority` text DEFAULT 'routine' NOT NULL,
	`earliest_from` text,
	`flexibility` text DEFAULT 'any' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`offered_appointment_id` text,
	`offer_expires_at` text,
	`offers_made` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `waitlist_practice_status` ON `waitlist` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `authorisations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`funding_case_id` text NOT NULL,
	`order_id` text NOT NULL,
	`funder_id` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`request_payload` text NOT NULL,
	`response_payload` text,
	`funder_reference` text,
	`auth_number` text,
	`valid_from` text,
	`valid_to` text,
	`approved_cents` integer,
	`reason` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`submitted_by` text,
	`task_id` text,
	`submitted_at` text NOT NULL,
	`responded_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `authorisations_case` ON `authorisations` (`funding_case_id`);--> statement-breakpoint
CREATE TABLE `funders` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`type` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`administrator` text,
	`options` text NOT NULL,
	`dsp` integer DEFAULT false NOT NULL,
	`rules` text NOT NULL,
	`contact` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funders_code` ON `funders` (`code`);--> statement-breakpoint
CREATE TABLE `funding_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`order_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`site_id` text,
	`funder_type` text NOT NULL,
	`funder_id` text,
	`scheme_name` text,
	`scheme_option` text,
	`member_no` text,
	`dependant_code` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`benefit_check` text,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`scheme_portion_cents` integer DEFAULT 0 NOT NULL,
	`patient_portion_cents` integer DEFAULT 0 NOT NULL,
	`reason_codes` text NOT NULL,
	`auth_required` integer DEFAULT false NOT NULL,
	`auth_status` text,
	`auth_number` text,
	`auth_valid_to` text,
	`quote_id` text,
	`third_party_ref` text,
	`proceed_at_risk_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `funding_cases_order` ON `funding_cases` (`order_id`);--> statement-breakpoint
CREATE INDEX `funding_cases_practice_status` ON `funding_cases` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`funding_case_id` text NOT NULL,
	`order_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`lines` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`scheme_portion_cents` integer NOT NULL,
	`patient_portion_cents` integer NOT NULL,
	`reason_codes` text NOT NULL,
	`assumptions` text NOT NULL,
	`valid_until` text NOT NULL,
	`binding` integer DEFAULT true NOT NULL,
	`fee_schedule_version` text DEFAULT 'demo-2026.1' NOT NULL,
	`rule_pack_version` text DEFAULT 'demo-2026.1' NOT NULL,
	`accepted_at` text,
	`accepted_via` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotes_case` ON `quotes` (`funding_case_id`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`type` text NOT NULL,
	`version` text DEFAULT '2026.1' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`granted` integer DEFAULT true NOT NULL,
	`signed_via` text NOT NULL,
	`signer_relationship` text DEFAULT 'self' NOT NULL,
	`evidence` text,
	`signed_at` text NOT NULL,
	`withdrawn_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consents_encounter` ON `consents` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`appointment_id` text,
	`order_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`status` text DEFAULT 'pre_checked_in' NOT NULL,
	`channel` text DEFAULT 'patient_space' NOT NULL,
	`arrived_at` text,
	`identity_level` integer DEFAULT 0 NOT NULL,
	`identity_verified_at` text,
	`identity_evidence` text,
	`scheme_card_captured` integer DEFAULT false NOT NULL,
	`language` text,
	`interpreter` text,
	`chaperone` integer DEFAULT false NOT NULL,
	`accessibility` text,
	`infection_control` text,
	`queue_ticket` text,
	`queue_room` text,
	`called_at` text,
	`in_room_at` text,
	`done_at` text,
	`wait_minutes` integer,
	`collect` text,
	`collected_cents` integer DEFAULT 0 NOT NULL,
	`still_needed` text,
	`gate_override` text,
	`wristband_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `encounters_site_status` ON `encounters` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `encounters_appointment` ON `encounters` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `encounters_patient` ON `encounters` (`patient_id`);--> statement-breakpoint
CREATE TABLE `queue_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`ticket` text NOT NULL,
	`room_type` text NOT NULL,
	`room` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`issued_at` text NOT NULL,
	`called_at` text,
	`estimated_wait_minutes` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_site_status` ON `queue_tickets` (`site_id`,`status`);--> statement-breakpoint
CREATE TABLE `safety_questionnaires` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`set` text NOT NULL,
	`version` text DEFAULT '2026.1' NOT NULL,
	`answers` text NOT NULL,
	`completeness` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`blocking_items` text NOT NULL,
	`conditions` text,
	`answered_by` text,
	`answered_via` text,
	`cleared_by` text,
	`cleared_at` text,
	`clearance_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `safety_encounter` ON `safety_questionnaires` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `contrast_administrations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`worklist_item_id` text NOT NULL,
	`study_id` text,
	`patient_id` text NOT NULL,
	`agent` text NOT NULL,
	`concentration` text,
	`weight_kg` integer,
	`egfr` integer,
	`volume_planned_ml` integer,
	`volume_delivered_ml` integer,
	`rate_ml_s_x10` integer,
	`batch_no` text,
	`expiry` text,
	`manual_reason` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`administered_by` text,
	`administered_at` text,
	`reaction` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contrast_item` ON `contrast_administrations` (`worklist_item_id`);--> statement-breakpoint
CREATE TABLE `protocols` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`modality_type` text NOT NULL,
	`body_part` text NOT NULL,
	`procedure_codes` text NOT NULL,
	`age_band` text DEFAULT 'adult' NOT NULL,
	`contrast` integer DEFAULT false NOT NULL,
	`parameters` text NOT NULL,
	`expected_series` text NOT NULL,
	`drl_quantity` text,
	`drl_value` integer,
	`contrast_rule` text,
	`requires_rgt` integer DEFAULT false NOT NULL,
	`standing_rule` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `protocols_modality` ON `protocols` (`modality_type`,`body_part`);--> statement-breakpoint
CREATE TABLE `repeat_rejects` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text NOT NULL,
	`modality_type` text NOT NULL,
	`worklist_item_id` text,
	`study_id` text,
	`series_id` text,
	`kind` text DEFAULT 'repeat' NOT NULL,
	`reason_code` text NOT NULL,
	`reason_text` text,
	`technologist_user_id` text,
	`qc_suggested` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rr_room` ON `repeat_rejects` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `worklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text NOT NULL,
	`modality_type` text NOT NULL,
	`order_id` text,
	`appointment_id` text,
	`patient_id` text NOT NULL,
	`patient_name` text,
	`referrer_id` text,
	`procedure_code` text NOT NULL,
	`procedure_description` text,
	`body_part` text,
	`laterality` text,
	`contrast` integer DEFAULT false NOT NULL,
	`priority` text DEFAULT 'routine' NOT NULL,
	`indication` text,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`protocol_id` text,
	`protocol_source` text,
	`protocol_provenance` text,
	`safety_gate` text,
	`identity_check` text,
	`technologist_user_id` text,
	`study_id` text,
	`accession` text,
	`arrived_at` text,
	`started_at` text,
	`completed_at` text,
	`cancel_reason` text,
	`technologist_note` text,
	`emergency` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wl_room_day` ON `worklist_items` (`room_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `wl_site` ON `worklist_items` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `wl_appt` ON `worklist_items` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`study_id` text NOT NULL,
	`series_id` text NOT NULL,
	`sop_uid` text NOT NULL,
	`number` integer NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text DEFAULT 'image/svg+xml' NOT NULL,
	`rows` integer DEFAULT 512 NOT NULL,
	`cols` integer DEFAULT 512 NOT NULL,
	`view` text,
	`laterality` text,
	`rejected` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `instances_study` ON `instances` (`study_id`);--> statement-breakpoint
CREATE INDEX `instances_series` ON `instances` (`series_id`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`study_id` text NOT NULL,
	`series_uid` text NOT NULL,
	`number` integer NOT NULL,
	`description` text NOT NULL,
	`modality` text NOT NULL,
	`view` text,
	`instance_count` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `series_study` ON `series` (`study_id`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`study_id` text NOT NULL,
	`report_id` text,
	`token` text NOT NULL,
	`scope` text DEFAULT 'study' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_persona` text,
	`recipient_name` text NOT NULL,
	`recipient_mobile_masked` text,
	`consent_basis` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`opens` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_token` ON `share_links` (`token`);--> statement-breakpoint
CREATE INDEX `share_study` ON `share_links` (`study_id`);--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text,
	`patient_id` text NOT NULL,
	`accession` text NOT NULL,
	`study_uid` text NOT NULL,
	`order_id` text,
	`appointment_id` text,
	`worklist_item_id` text,
	`referrer_id` text,
	`modality` text NOT NULL,
	`procedure_code` text NOT NULL,
	`procedure_description` text,
	`body_part` text NOT NULL,
	`laterality` text,
	`indication` text,
	`priority` text DEFAULT 'routine' NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`series_count` integer DEFAULT 0 NOT NULL,
	`instance_count` integer DEFAULT 0 NOT NULL,
	`storage_prefix` text NOT NULL,
	`prior_ids` text,
	`key_image_ids` text,
	`technologist_note` text,
	`technologist_user_id` text,
	`retention_class` text DEFAULT 'standard' NOT NULL,
	`external` integer DEFAULT false NOT NULL,
	`unmatched` integer DEFAULT false NOT NULL,
	`received_at` text NOT NULL,
	`completed_at` text,
	`reported_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studies_accession` ON `studies` (`accession`);--> statement-breakpoint
CREATE INDEX `studies_patient` ON `studies` (`patient_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `studies_practice_status` ON `studies` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `studies_site_day` ON `studies` (`site_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `dose_records` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text,
	`study_id` text NOT NULL,
	`accession` text NOT NULL,
	`patient_id` text NOT NULL,
	`modality` text NOT NULL,
	`protocol_id` text,
	`protocol_code` text NOT NULL,
	`quantity` text NOT NULL,
	`value_x1000` integer NOT NULL,
	`ctdivol_x1000` integer,
	`effective_msv_x1000` integer,
	`size_class` text DEFAULT 'standard' NOT NULL,
	`drl_value_x1000` integer,
	`drl_source` text,
	`ratio_pct` integer,
	`outlier` integer DEFAULT false NOT NULL,
	`alert_level` text DEFAULT 'none' NOT NULL,
	`likely_cause` text,
	`pregnancy_declared` text,
	`justification` text,
	`justified_by` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`source` text DEFAULT 'rdsr' NOT NULL,
	`technologist_user_id` text,
	`repeats` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dose_study` ON `dose_records` (`study_id`);--> statement-breakpoint
CREATE INDEX `dose_site` ON `dose_records` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dose_patient` ON `dose_records` (`patient_id`);--> statement-breakpoint
CREATE TABLE `dosimetry` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text,
	`staff_name` text NOT NULL,
	`role` text NOT NULL,
	`badge_type` text DEFAULT 'OSL' NOT NULL,
	`badge_placement` text DEFAULT 'body' NOT NULL,
	`cycle` text NOT NULL,
	`issued_at` text NOT NULL,
	`due_back_at` text NOT NULL,
	`returned_at` text,
	`result_usv` integer,
	`investigation_level_usv` integer DEFAULT 500 NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`rpo_signed_by` text,
	`rpo_signed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dosimetry_site_cycle` ON `dosimetry` (`site_id`,`cycle`);--> statement-breakpoint
CREATE TABLE `qa_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text NOT NULL,
	`modality_type` text NOT NULL,
	`test_type` text NOT NULL,
	`frequency` text NOT NULL,
	`blocking` integer DEFAULT false NOT NULL,
	`due_at` text NOT NULL,
	`done_at` text,
	`result` text,
	`values` text,
	`performed_by` text,
	`rpo_signed_by` text,
	`rpo_signed_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qa_room_due` ON `qa_tests` (`room_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `qa_site` ON `qa_tests` (`site_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `inference_results` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`accession` text NOT NULL,
	`model_id` text NOT NULL,
	`model_version` text NOT NULL,
	`task` text NOT NULL,
	`mode` text DEFAULT 'activated' NOT NULL,
	`result` text NOT NULL,
	`priority` text,
	`flagged` integer DEFAULT false NOT NULL,
	`positive_count` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`compute` text NOT NULL,
	`input_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inf_study` ON `inference_results` (`study_id`);--> statement-breakpoint
CREATE INDEX `inf_model_site` ON `inference_results` (`model_id`,`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `model_events` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`site_id` text,
	`model_id` text NOT NULL,
	`model_version` text,
	`type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`actor_user_id` text,
	`resolved_by` text,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_events_model` ON `model_events` (`model_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `model_events_type` ON `model_events` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `model_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`practice_id` text,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`task` text NOT NULL,
	`output_class` integer NOT NULL,
	`modalities` text NOT NULL,
	`body_parts` text,
	`vendor` text NOT NULL,
	`samd_status` text NOT NULL,
	`compute` text NOT NULL,
	`overlays_default` text DEFAULT 'on' NOT NULL,
	`lifecycle` text DEFAULT 'shadow' NOT NULL,
	`site_status` text NOT NULL,
	`validation_summary` text NOT NULL,
	`limitations` text,
	`description` text,
	`demo` integer DEFAULT true NOT NULL,
	`bundle_digest` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `models_model` ON `model_registry` (`model_id`);--> statement-breakpoint
CREATE TABLE `addenda` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`report_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`kind` text DEFAULT 'addendum' NOT NULL,
	`text` text NOT NULL,
	`reason` text NOT NULL,
	`signed_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `addenda_report` ON `addenda` (`report_id`);--> statement-breakpoint
CREATE TABLE `peer_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`report_id` text NOT NULL,
	`study_id` text NOT NULL,
	`original_radiologist_user_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`score` text,
	`category` text,
	`notes` text,
	`blinded_impression` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`scored_at` text
);
--> statement-breakpoint
CREATE INDEX `peer_reviewer` ON `peer_reviews` (`reviewer_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `report_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`modality` text NOT NULL,
	`body_part` text NOT NULL,
	`sections` text NOT NULL,
	`mandatory_fields` text NOT NULL,
	`pick_lists` text,
	`icd10_prompts` text,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `templates_modality` ON `report_templates` (`modality`,`body_part`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`study_id` text NOT NULL,
	`accession` text NOT NULL,
	`patient_id` text NOT NULL,
	`referrer_id` text,
	`radiologist_user_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`template_id` text,
	`sections` text NOT NULL,
	`structured_findings` text NOT NULL,
	`candidates` text NOT NULL,
	`followups` text NOT NULL,
	`draft_provenance` text,
	`critical` integer DEFAULT false NOT NULL,
	`critical_category` text,
	`reportable_categories` text NOT NULL,
	`consistency_warnings` text,
	`warnings_acknowledged` integer DEFAULT false NOT NULL,
	`warnings_ack_reason` text,
	`priority` text DEFAULT 'routine' NOT NULL,
	`subspecialty` text,
	`claimed_by` text,
	`claimed_at` text,
	`lock_expires_at` text,
	`signed_at` text,
	`signed_hpcsa_no` text,
	`reading_time_sec` integer,
	`reading_rvu_x100` integer,
	`reading_fee_cents` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_study` ON `reports` (`study_id`);--> statement-breakpoint
CREATE INDEX `reports_status` ON `reports` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `reports_referrer` ON `reports` (`referrer_id`,`signed_at`);--> statement-breakpoint
CREATE INDEX `reports_patient` ON `reports` (`patient_id`,`signed_at`);--> statement-breakpoint
CREATE TABLE `critical_results` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`report_id` text NOT NULL,
	`study_id` text NOT NULL,
	`accession` text NOT NULL,
	`patient_id` text NOT NULL,
	`referrer_id` text,
	`radiologist_user_id` text NOT NULL,
	`category` text NOT NULL,
	`window_minutes` integer DEFAULT 30 NOT NULL,
	`contact_chain` text NOT NULL,
	`attempts` text NOT NULL,
	`escalation_level` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` text NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` text,
	`acknowledgement_channel` text,
	`closed_at` text,
	`hand_task_id` text,
	`taken_over_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `crit_status` ON `critical_results` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `crit_report` ON `critical_results` (`report_id`);--> statement-breakpoint
CREATE TABLE `followups` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`report_id` text NOT NULL,
	`study_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`referrer_id` text,
	`what` text NOT NULL,
	`when_text` text NOT NULL,
	`why` text NOT NULL,
	`who` text DEFAULT 'referrer' NOT NULL,
	`schedule_source` text,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reminders` text NOT NULL,
	`closed_reason` text,
	`closed_evidence` text,
	`closed_by` text,
	`closed_at` text,
	`escalated_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fu_status` ON `followups` (`practice_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `fu_referrer` ON `followups` (`referrer_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_masked` text NOT NULL,
	`template` text NOT NULL,
	`body` text NOT NULL,
	`related_type` text,
	`related_id` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notif_related` ON `notifications` (`related_type`,`related_id`);--> statement-breakpoint
CREATE TABLE `result_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`report_id` text NOT NULL,
	`study_id` text NOT NULL,
	`referrer_id` text,
	`patient_id` text,
	`recipient_type` text NOT NULL,
	`channel` text NOT NULL,
	`recipient_masked` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` text NOT NULL,
	`delivered_at` text,
	`opened_at` text,
	`acknowledged_at` text,
	`acknowledged_by` text,
	`amendment` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deliv_report` ON `result_deliveries` (`report_id`);--> statement-breakpoint
CREATE INDEX `deliv_referrer` ON `result_deliveries` (`referrer_id`,`status`);--> statement-breakpoint
CREATE TABLE `account_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`description` text NOT NULL,
	`reason` text,
	`arithmetic` text,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_transactions_account` ON `account_transactions` (`account_id`,`at`);--> statement-breakpoint
CREATE TABLE `billing_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`period` text NOT NULL,
	`unbilled` text,
	`in_flight` text,
	`provision` text,
	`checklist` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`signed_by` text,
	`signed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `billing_periods_practice` ON `billing_periods` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`patient_id` text NOT NULL,
	`study_id` text,
	`report_id` text,
	`order_id` text,
	`accession` text,
	`service_date` text NOT NULL,
	`modality` text,
	`procedure_codes` text NOT NULL,
	`icd10` text NOT NULL,
	`funder_id` text NOT NULL,
	`funder_type` text NOT NULL,
	`member_no` text,
	`dependant_code` text,
	`referrer_id` text,
	`radiologist_user_id` text,
	`lines` text NOT NULL,
	`subtotal_excl_cents` integer DEFAULT 0 NOT NULL,
	`vat_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`expected_funder_cents` integer DEFAULT 0 NOT NULL,
	`expected_patient_cents` integer DEFAULT 0 NOT NULL,
	`patient_portion_reason` text,
	`schedule_id` text,
	`status` text DEFAULT 'unbilled' NOT NULL,
	`coding` text,
	`exception` text,
	`auth_ref` text,
	`claim_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`blocking_reason` text,
	`owner` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charges_practice_status` ON `charges` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `charges_patient` ON `charges` (`patient_id`);--> statement-breakpoint
CREATE INDEX `charges_service_date` ON `charges` (`service_date`);--> statement-breakpoint
CREATE TABLE `claim_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`channel` text NOT NULL,
	`received_at` text NOT NULL,
	`outcome` text NOT NULL,
	`code` text,
	`message` text,
	`rule` text,
	`switch_ref` text,
	`paid_cents` integer,
	`payload` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claim_responses_claim` ON `claim_responses` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`claim_ref` text NOT NULL,
	`charge_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`site_id` text,
	`funder_id` text NOT NULL,
	`funder_type` text NOT NULL,
	`member_no` text,
	`dependant_code` text,
	`icd10` text NOT NULL,
	`lines` text NOT NULL,
	`fields` text NOT NULL,
	`total_cents` integer NOT NULL,
	`expected_funder_cents` integer NOT NULL,
	`expected_patient_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`channel` text DEFAULT 'batch' NOT NULL,
	`batch_id` text,
	`switch_ref` text,
	`response_codes` text,
	`submitted_at` text,
	`responded_at` text,
	`service_date` text NOT NULL,
	`stale_date` text,
	`scrub` text,
	`rule_pack_version` text,
	`rejection_code` text,
	`rejection_class` text,
	`rejection_reason` text,
	`exception` text,
	`original_claim_id` text,
	`resubmit_count` integer DEFAULT 0 NOT NULL,
	`pmb` integer DEFAULT false NOT NULL,
	`submitted_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claims_practice_status` ON `claims` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `claims_ref` ON `claims` (`claim_ref`);--> statement-breakpoint
CREATE INDEX `claims_funder` ON `claims` (`funder_id`);--> statement-breakpoint
CREATE INDEX `claims_patient` ON `claims` (`patient_id`);--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`claim_id` text,
	`charge_id` text,
	`raised_via` text DEFAULT 'whatsapp' NOT NULL,
	`reason` text NOT NULL,
	`message` text,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome` text,
	`evidence` text,
	`sla_due_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `disputes_practice` ON `disputes` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `dunning_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`run_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text,
	`step` text NOT NULL,
	`channel` text NOT NULL,
	`template` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`amount_cents` integer NOT NULL,
	`scheduled_for` text NOT NULL,
	`sent_at` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`paylink_token` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dunning_actions_run` ON `dunning_actions` (`run_id`);--> statement-breakpoint
CREATE INDEX `dunning_actions_account` ON `dunning_actions` (`account_id`);--> statement-breakpoint
CREATE TABLE `dunning_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`hand_task_id` text,
	`policy_version` text,
	`actions` integer DEFAULT 0 NOT NULL,
	`by_channel` text NOT NULL,
	`by_step` text NOT NULL,
	`by_band` text NOT NULL,
	`exclusions` text NOT NULL,
	`inside_window` integer DEFAULT 0 NOT NULL,
	`needs_human` integer DEFAULT 0 NOT NULL,
	`sample_reviewed_by` text,
	`sample_reviewed_at` text,
	`status` text DEFAULT 'done' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fee_schedule_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`price_excl_cents` integer NOT NULL,
	`unit` text DEFAULT 'per_unit' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fee_schedule_lines_schedule` ON `fee_schedule_lines` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `fee_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`funder_id` text NOT NULL,
	`funder_type` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`uplift_pct` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fee_schedules_practice_funder` ON `fee_schedules` (`practice_id`,`funder_id`);--> statement-breakpoint
CREATE TABLE `handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`checklist` text NOT NULL,
	`clean` integer DEFAULT false NOT NULL,
	`failing` text NOT NULL,
	`collector` text DEFAULT 'Registered collector (demo)' NOT NULL,
	`prescription_date` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`proposed_by` text NOT NULL,
	`hand_task_id` text,
	`approved_by` text,
	`approved_at` text,
	`released_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `handovers_practice` ON `handovers` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `patient_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`account_no` text NOT NULL,
	`debtor_class` text DEFAULT 'patient' NOT NULL,
	`debtor_name` text,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`ageing_start_at` text,
	`due_date` text,
	`liability_reason` text,
	`propensity` text,
	`flags` text NOT NULL,
	`consent_channels` text,
	`language` text DEFAULT 'en' NOT NULL,
	`dunning_stage` text,
	`last_contact_at` text,
	`contacts_last_7d` integer DEFAULT 0 NOT NULL,
	`delivered` text NOT NULL,
	`plan_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`external_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `patient_accounts_practice` ON `patient_accounts` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `patient_accounts_patient` ON `patient_accounts` (`patient_id`);--> statement-breakpoint
CREATE TABLE `payment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`total_cents` integer NOT NULL,
	`instalment_count` integer NOT NULL,
	`instalment_cents` integer NOT NULL,
	`interest_pct` integer DEFAULT 0 NOT NULL,
	`schedule` text NOT NULL,
	`method` text DEFAULT 'paylink' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_plans_practice` ON `payment_plans` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text,
	`patient_id` text,
	`site_id` text,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reference` text,
	`receipt_no` text,
	`link_token` text,
	`link_expires_at` text,
	`taken_by` text,
	`psp_ref` text,
	`settled_at` text,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_practice` ON `payments` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `payments_link` ON `payments` (`link_token`);--> statement-breakpoint
CREATE TABLE `rejection_waves` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`funder_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`codes` text NOT NULL,
	`started_at` text NOT NULL,
	`claim_count` integer DEFAULT 0 NOT NULL,
	`at_risk_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`paused_rule` text,
	`probable_cause` text,
	`rule_pack_version` text,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `remittances` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`funder_id` text NOT NULL,
	`reference` text NOT NULL,
	`received_at` text NOT NULL,
	`total_cents` integer NOT NULL,
	`lines` text NOT NULL,
	`matched_cents` integer DEFAULT 0 NOT NULL,
	`unmatched_cents` integer DEFAULT 0 NOT NULL,
	`short_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`bank_ref` text,
	`banked_at` text,
	`hand_task_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remittances_practice` ON `remittances` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `write_offs` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`account_id` text NOT NULL,
	`patient_id` text,
	`claim_id` text,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`root_cause` text,
	`proposed_by` text NOT NULL,
	`approver_persona` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`period` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `write_offs_practice` ON `write_offs` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`assumptions` text,
	`lines` text NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budgets_practice` ON `budgets` (`practice_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `distributions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`period` text NOT NULL,
	`distributable_cents` integer NOT NULL,
	`bridge` text NOT NULL,
	`solvency_test` text,
	`waterfall` text NOT NULL,
	`approvals` text NOT NULL,
	`required_approvals` integer DEFAULT 3 NOT NULL,
	`resolution_ref` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`payment_file` text,
	`payment_file_hash` text,
	`proposed_by` text,
	`released_by` text,
	`released_at` text,
	`paid_at` text,
	`bank_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `distributions_practice` ON `distributions` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `fiscal_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`locked_at` text,
	`lock_ref` text,
	`close_steps` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fiscal_periods_practice` ON `fiscal_periods` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `gl_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`ifrs_group` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `intercompany_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`period` text NOT NULL,
	`rule_type` text NOT NULL,
	`number` text NOT NULL,
	`basis` text NOT NULL,
	`evidence` text,
	`amount_excl_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`dispute_note` text,
	`dispute_window_ends_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `intercompany_practice_period` ON `intercompany_invoices` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `journals` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`period` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`event_name` text,
	`description` text NOT NULL,
	`lines` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`reversal_of` text,
	`posted_at` text NOT NULL,
	`posted_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `journals_practice_period` ON `journals` (`practice_id`,`period`);--> statement-breakpoint
CREATE INDEX `journals_source_ref` ON `journals` (`source_ref`);--> statement-breakpoint
CREATE TABLE `pnl_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`period` text NOT NULL,
	`lines` text NOT NULL,
	`revenue_cents` integer NOT NULL,
	`short_payments_cents` integer NOT NULL,
	`reading_fees_cents` integer NOT NULL,
	`management_fee_cents` integer NOT NULL,
	`platform_fee_cents` integer DEFAULT 0 NOT NULL,
	`rent_cents` integer NOT NULL,
	`staff_cents` integer NOT NULL,
	`consumables_cents` integer NOT NULL,
	`other_cents` integer NOT NULL,
	`ebitda_cents` integer NOT NULL,
	`depreciation_cents` integer NOT NULL,
	`tax_provision_cents` integer NOT NULL,
	`profit_after_tax_cents` integer NOT NULL,
	`reserve_cents` integer NOT NULL,
	`distributable_cents` integer NOT NULL,
	`collections_cents` integer DEFAULT 0 NOT NULL,
	`unbilled_cents` integer DEFAULT 0 NOT NULL,
	`studies` integer DEFAULT 0 NOT NULL,
	`kpis` text,
	`budget_revenue_cents` integer,
	`budget_ebitda_cents` integer,
	`status` text DEFAULT 'soft' NOT NULL,
	`locked_at` text,
	`computed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pnl_practice_period` ON `pnl_snapshots` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `reserved_matters` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`ref` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer,
	`rule` text NOT NULL,
	`votes` text NOT NULL,
	`attachments` text,
	`thread` text,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reserved_matters_practice` ON `reserved_matters` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `shareholder_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`distribution_id` text NOT NULL,
	`period` text NOT NULL,
	`shareholder_name` text NOT NULL,
	`shareholder_user_id` text,
	`share_class` text,
	`pct` integer NOT NULL,
	`gross_cents` integer NOT NULL,
	`dividends_tax_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`segments` text,
	`bank_ref` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shareholder_statements_practice` ON `shareholder_statements` (`practice_id`,`period`);--> statement-breakpoint
CREATE TABLE `acquisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`name` text NOT NULL,
	`region` text,
	`sites` text NOT NULL,
	`modalities` text,
	`stage` text DEFAULT 'target' NOT NULL,
	`owner` text,
	`indicative_ebitda_cents` integer,
	`jv_split` text,
	`effective_date` text,
	`merger_threshold` text,
	`checklist` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `board_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`period` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text NOT NULL,
	`generated_by` text,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metric_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`metric_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real,
	`numerator` real,
	`denominator` real,
	`source` text DEFAULT 'computed' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_snapshots_key` ON `metric_snapshots` (`practice_id`,`metric_id`,`date`);--> statement-breakpoint
CREATE INDEX `metric_snapshots_date` ON `metric_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `saved_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`user_id` text,
	`persona` text,
	`question` text NOT NULL,
	`metric_ids` text NOT NULL,
	`answer` text,
	`task_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text NOT NULL,
	`provenance` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cpd_points` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`cycle_year` integer NOT NULL,
	`activity` text NOT NULL,
	`points` real NOT NULL,
	`ethics_points` real DEFAULT 0 NOT NULL,
	`certificate_ref` text,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`type` text NOT NULL,
	`number` text,
	`issuer` text,
	`issued_at` text,
	`expiry` text,
	`verified` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`verified_by` text,
	`evidence_ref` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `credentials_staff` ON `credentials` (`staff_id`);--> statement-breakpoint
CREATE INDEX `credentials_expiry` ON `credentials` (`expiry`);--> statement-breakpoint
CREATE TABLE `leave` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`type` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`days` real NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`reason` text,
	`certificate_ref` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`hours` real NOT NULL,
	`role` text NOT NULL,
	`required_competency` text,
	`staff_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`filled_by` text,
	`agency_name` text,
	`agency_cents` integer,
	`overtime` integer DEFAULT false NOT NULL,
	`gap_reason` text,
	`note` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shifts_site_date` ON `shifts` (`site_id`,`date`);--> statement-breakpoint
CREATE INDEX `shifts_staff` ON `shifts` (`staff_id`);--> statement-breakpoint
CREATE INDEX `shifts_status` ON `shifts` (`status`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`employment_type` text DEFAULT 'permanent' NOT NULL,
	`home_site_id` text,
	`site_ids` text,
	`competencies` text NOT NULL,
	`hpcsa_no` text,
	`hpcsa_expiry` text,
	`radiation_worker` integer DEFAULT false NOT NULL,
	`dosimetry_badge` text,
	`contract_hours_per_week` real DEFAULT 45 NOT NULL,
	`fte_pct` integer DEFAULT 100 NOT NULL,
	`hourly_cost_cents` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`start_date` text,
	`end_date` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_practice` ON `staff` (`practice_id`);--> statement-breakpoint
CREATE INDEX `staff_role` ON `staff` (`role`);--> statement-breakpoint
CREATE TABLE `time_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`shift_id` text,
	`site_id` text NOT NULL,
	`clock_in` text NOT NULL,
	`clock_out` text,
	`method` text DEFAULT 'app' NOT NULL,
	`hours_worked` real,
	`overtime_hours` real DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_attendance_staff` ON `time_attendance` (`staff_id`,`clock_in`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`room_id` text,
	`modality_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'modality' NOT NULL,
	`type` text,
	`vendor` text,
	`model` text,
	`serial` text,
	`asset_tag` text,
	`status` text DEFAULT 'in_service' NOT NULL,
	`service_contract` text,
	`vendor_contact` text,
	`pm_schedule` text,
	`predictive_signal` text,
	`uptime_30d_pct` real,
	`licence_ref` text,
	`downtime_started_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_site` ON `assets` (`site_id`);--> statement-breakpoint
CREATE INDEX `assets_practice` ON `assets` (`practice_id`);--> statement-breakpoint
CREATE TABLE `consumables` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`category` text DEFAULT 'contrast' NOT NULL,
	`product` text NOT NULL,
	`lot` text NOT NULL,
	`expiry` text NOT NULL,
	`qty_on_hand` integer NOT NULL,
	`unit` text DEFAULT 'vial' NOT NULL,
	`reorder_point` integer DEFAULT 20 NOT NULL,
	`daily_usage` real DEFAULT 0 NOT NULL,
	`supplier` text,
	`unit_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consumables_site` ON `consumables` (`site_id`,`category`);--> statement-breakpoint
CREATE TABLE `edge_gateways` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`last_heartbeat_at` text,
	`tunnel_ms` integer,
	`backlog_studies` integer DEFAULT 0 NOT NULL,
	`disk_pct` integer DEFAULT 20 NOT NULL,
	`ups_pct` integer DEFAULT 100 NOT NULL,
	`ups_minutes_left` integer,
	`state_since` text,
	`version` text,
	`local_worklist_mirror` integer DEFAULT true NOT NULL,
	`note` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`partner` text,
	`transport` text,
	`direction` text DEFAULT 'in' NOT NULL,
	`last_message_at` text,
	`messages_24h` integer DEFAULT 0 NOT NULL,
	`errors_24h` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `load_shedding_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`stage` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`generator_covers` text,
	`source` text DEFAULT 'schedule' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`ref` text NOT NULL,
	`supplier` text NOT NULL,
	`category` text NOT NULL,
	`lines` text NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`raised_by` text,
	`hand_task_id` text,
	`work_order_id` text,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`type` text NOT NULL,
	`qty` integer NOT NULL,
	`study_id` text,
	`user_id` text,
	`note` text,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`site_id` text,
	`ref` text NOT NULL,
	`category` text NOT NULL,
	`severity` text DEFAULT 'p3' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`linked_ref` text,
	`runbook` text,
	`opened_by` text,
	`assigned_to` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telemetry` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`text_value` text,
	`unit` text,
	`source` text DEFAULT 'edge' NOT NULL,
	`at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telemetry_asset_metric` ON `telemetry` (`asset_id`,`metric`,`at`);--> statement-breakpoint
CREATE TABLE `vendor_access_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text,
	`ref` text NOT NULL,
	`vendor` text NOT NULL,
	`engineer` text,
	`purpose` text NOT NULL,
	`scope` text NOT NULL,
	`requested_start` text NOT NULL,
	`requested_end` text NOT NULL,
	`approved_start` text,
	`approved_end` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`requested_by` text,
	`approved_by` text,
	`approved_at` text,
	`recording_ref` text,
	`work_order_id` text,
	`conditions` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text NOT NULL,
	`asset_id` text,
	`ref` text NOT NULL,
	`type` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`title` text NOT NULL,
	`symptoms` text,
	`status` text DEFAULT 'open' NOT NULL,
	`vendor_ticket` text,
	`sla_hours` real,
	`sla_started_at` text,
	`sla_due_at` text,
	`po_id` text,
	`po_cents` integer,
	`downtime_started_at` text,
	`downtime_ended_at` text,
	`root_cause` text,
	`reported_by` text,
	`assigned_to` text,
	`hand_task_id` text,
	`timeline` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_orders_status` ON `work_orders` (`status`,`practice_id`);--> statement-breakpoint
CREATE INDEX `work_orders_asset` ON `work_orders` (`asset_id`);--> statement-breakpoint
CREATE TABLE `audit_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`audit_id` text NOT NULL,
	`grade` text NOT NULL,
	`description` text NOT NULL,
	`owner` text,
	`due_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`capa` text,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`ref` text NOT NULL,
	`type` text NOT NULL,
	`scope` text NOT NULL,
	`auditor` text,
	`scheduled_at` text,
	`completed_at` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`checklist` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `complaints` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`ref` text NOT NULL,
	`channel` text NOT NULL,
	`route` text DEFAULT 'internal' NOT NULL,
	`category` text NOT NULL,
	`complainant_masked` text,
	`subject` text NOT NULL,
	`detail` text,
	`severity` text DEFAULT 'minor' NOT NULL,
	`received_at` text NOT NULL,
	`acknowledge_by` text NOT NULL,
	`acknowledged_at` text,
	`respond_by` text NOT NULL,
	`responded_at` text,
	`status` text DEFAULT 'received' NOT NULL,
	`external_ref` text,
	`linked_ref` text,
	`legal_hold` integer DEFAULT false NOT NULL,
	`response_draft` text,
	`incident_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_subject_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`ref` text NOT NULL,
	`type` text NOT NULL,
	`requester_masked` text NOT NULL,
	`patient_id` text,
	`channel` text DEFAULT 'patient_space' NOT NULL,
	`identity_verified` integer DEFAULT false NOT NULL,
	`received_at` text NOT NULL,
	`statutory_days` integer DEFAULT 30 NOT NULL,
	`statutory_due_at` text NOT NULL,
	`policy_days` integer DEFAULT 14 NOT NULL,
	`policy_due_at` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`checklist` text NOT NULL,
	`redactions` text,
	`released_by` text,
	`fulfilled_at` text,
	`extension_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evidence_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`manifest` text NOT NULL,
	`html` text,
	`generated_by` text,
	`hand_task_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`ref` text NOT NULL,
	`category` text NOT NULL,
	`severity` integer DEFAULT 3 NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`occurred_at` text NOT NULL,
	`reported_at` text NOT NULL,
	`reported_by` text,
	`patient_masked` text,
	`patient_id` text,
	`modality_id` text,
	`room_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`timeline` text NOT NULL,
	`immediate_actions` text,
	`rca` text,
	`corrective_actions` text,
	`disclosure` text,
	`regulator` text,
	`report_draft` text,
	`learning_summary` text,
	`linked_refs` text,
	`closed_at` text,
	`closed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `incidents_status` ON `incidents` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `incidents_ref` ON `incidents` (`ref`);--> statement-breakpoint
CREATE TABLE `obligation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`obligation_id` text NOT NULL,
	`due_date` text NOT NULL,
	`lead_days` integer NOT NULL,
	`fire_date` text NOT NULL,
	`title` text NOT NULL,
	`assignee` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `obligation_events_fire` ON `obligation_events` (`practice_id`,`fire_date`);--> statement-breakpoint
CREATE TABLE `obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`domain` text NOT NULL,
	`instrument` text NOT NULL,
	`section` text,
	`obligation` text NOT NULL,
	`responsible_entity` text NOT NULL,
	`owner_persona` text NOT NULL,
	`trigger` text,
	`control` text,
	`output` text,
	`evidence` text,
	`automation` text DEFAULT 'A2' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`frequency` text DEFAULT 'annual' NOT NULL,
	`due_date` text,
	`last_done_at` text,
	`evidence_refs` text,
	`submission_ref` text,
	`version` integer DEFAULT 1 NOT NULL,
	`effective_from` text DEFAULT '2026-01-01' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `obligations_due` ON `obligations` (`practice_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`effective_date` text NOT NULL,
	`review_due` text,
	`owner` text,
	`applies_to` text,
	`mandatory` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`staff_id` text NOT NULL,
	`version` integer NOT NULL,
	`acknowledged_at` text NOT NULL,
	`method` text DEFAULT 'in_app' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `policy_ack_policy` ON `policy_acknowledgements` (`policy_id`);--> statement-breakpoint
CREATE TABLE `reportable_results` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`site_id` text,
	`ref` text NOT NULL,
	`category` text NOT NULL,
	`category_label` text NOT NULL,
	`patient_masked` text,
	`patient_id` text,
	`report_id` text,
	`study_id` text,
	`accession` text,
	`referrer_id` text,
	`referrer_name` text,
	`ack_window_hours` integer DEFAULT 24 NOT NULL,
	`ack_due_at` text NOT NULL,
	`ack_at` text,
	`ack_by` text,
	`pack_name` text,
	`pack_sent_at` text,
	`pack_channel` text,
	`status` text DEFAULT 'open' NOT NULL,
	`patient_release_withheld` integer DEFAULT false NOT NULL,
	`escalations` integer DEFAULT 0 NOT NULL,
	`last_escalated_at` text,
	`linked_incident_id` text,
	`notes` text,
	`closed_at` text,
	`closed_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reportable_results_status` ON `reportable_results` (`practice_id`,`status`);