CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`file_name` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`uploaded_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`details` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text,
	`address` text,
	`phone` text,
	`timezone` text DEFAULT 'America/Bogota' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nit` text,
	`address` text,
	`phone` text,
	`logo_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`qr_code` text NOT NULL,
	`name` text NOT NULL,
	`serial_number` text,
	`model` text,
	`brand` text,
	`year` integer,
	`type` text DEFAULT 'GENERAL' NOT NULL,
	`category` text NOT NULL,
	`subcategory` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`location_id` text,
	`asset_number` text,
	`purchase_date` text,
	`purchase_value` real,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_code_unique` ON `equipment` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_qr_code_unique` ON `equipment` (`qr_code`);--> statement-breakpoint
CREATE TABLE `helpdesk_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`tracking_token` text NOT NULL,
	`requester_name` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_phone` text,
	`branch_id` text NOT NULL,
	`area` text NOT NULL,
	`request_type` text NOT NULL,
	`priority` text DEFAULT 'MEDIUM' NOT NULL,
	`description` text NOT NULL,
	`attachments` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`assigned_to_id` text,
	`equipment_id` text,
	`related_work_order_id` text,
	`sla_deadline` text,
	`resolved_at` text,
	`closed_at` text,
	`resolution_notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `helpdesk_tickets_code_unique` ON `helpdesk_tickets` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `helpdesk_tickets_tracking_token_unique` ON `helpdesk_tickets` (`tracking_token`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`building` text,
	`floor` text,
	`area` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `maintenance_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`frequency` text NOT NULL,
	`next_due_date` text NOT NULL,
	`alert_days_before` integer DEFAULT 7 NOT NULL,
	`checklist_template` text,
	`estimated_hours` real,
	`assigned_to_user_id` text,
	`assigned_to_provider_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `predictive_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`variable` text NOT NULL,
	`unit` text NOT NULL,
	`value` real NOT NULL,
	`min_threshold` real,
	`max_threshold` real,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`recorded_by` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`nit` text,
	`name` text NOT NULL,
	`contact` text,
	`email` text,
	`phone` text,
	`specialty` text,
	`city` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spare_part_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`spare_part_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`work_order_id` text,
	`movement_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`notes` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`spare_part_id`) REFERENCES `spare_parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spare_part_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`spare_part_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`spare_part_id`) REFERENCES `spare_parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spare_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit` text DEFAULT 'UND' NOT NULL,
	`category` text,
	`provider_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spare_parts_code_unique` ON `spare_parts` (`code`);--> statement-breakpoint
CREATE TABLE `ticket_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`content` text NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `helpdesk_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password` text NOT NULL,
	`role` text NOT NULL,
	`branch_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wo_spare_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`spare_part_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spare_part_id`) REFERENCES `spare_parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`priority` text DEFAULT 'MEDIUM' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`equipment_id` text NOT NULL,
	`technician_id` text,
	`provider_id` text,
	`helpdesk_ticket_id` text,
	`scheduled_date` text,
	`started_at` text,
	`completed_at` text,
	`estimated_hours` real,
	`labor_hours` real,
	`before_images` text,
	`after_images` text,
	`tech_signature_key` text,
	`client_signature_key` text,
	`signer_name` text,
	`signer_role` text,
	`checklist` text,
	`notes` text,
	`closed_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_code_unique` ON `work_orders` (`code`);