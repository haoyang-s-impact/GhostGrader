CREATE TABLE `answers` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`question_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_name` text NOT NULL,
	`student_index` integer NOT NULL,
	`text` text NOT NULL,
	`lms_answer_id` text DEFAULT '' NOT NULL,
	`submitted_at` integer DEFAULT 0 NOT NULL,
	`pulled_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `answers_assignment_idx` ON `answers` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `answers_question_idx` ON `answers` (`assignment_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`course` text NOT NULL,
	`learning_objectives` text NOT NULL,
	`questions` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`lms_assignment_id` text DEFAULT '' NOT NULL,
	`last_pulled_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assignments_teacher_idx` ON `assignments` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `assignments_course_idx` ON `assignments` (`course_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`name` text NOT NULL,
	`term` text DEFAULT '' NOT NULL,
	`lms_course_id` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `courses_teacher_idx` ON `courses` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`student_id` text NOT NULL,
	`student_index` integer NOT NULL,
	`student_name` text DEFAULT '' NOT NULL,
	`points` real NOT NULL,
	`max_points` real NOT NULL,
	`suggested_points` real,
	`missing_concepts` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decisions_assignment_idx` ON `decisions` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `decisions_question_idx` ON `decisions` (`assignment_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `overrides` (
	`assignment_id` text NOT NULL,
	`key` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `overrides_pair_idx` ON `overrides` (`assignment_id`,`key`);--> statement-breakpoint
CREATE TABLE `pushes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`question_id` text NOT NULL,
	`student_id` text NOT NULL,
	`points` real NOT NULL,
	`client_reference_id` text NOT NULL,
	`status` text NOT NULL,
	`lms_grade_id` text DEFAULT '' NOT NULL,
	`pushed_at` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pushes_assignment_idx` ON `pushes` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `session_stats` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`alerts_raised` integer DEFAULT 0 NOT NULL,
	`alerts_aligned` integer DEFAULT 0 NOT NULL,
	`checks_raised` integer DEFAULT 0 NOT NULL,
	`checks_approved` integer DEFAULT 0 NOT NULL,
	`checks_raised_for` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lms_student_id` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `students_lms_idx` ON `students` (`lms_student_id`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL
);
