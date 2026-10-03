CREATE TABLE `userReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reporterUserId` int NOT NULL,
	`reportedUserId` int,
	`reportedProfileId` int,
	`targetLabel` varchar(160) NOT NULL,
	`conversationKey` varchar(120),
	`reason` varchar(40) NOT NULL,
	`details` text,
	`status` enum('open','reviewed','dismissed','banned') NOT NULL DEFAULT 'open',
	`reviewedByUserId` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSecurity` (
	`userId` int NOT NULL,
	`emailVerifiedAt` timestamp,
	`emailVerificationTokenHash` varchar(128),
	`emailVerificationExpiresAt` timestamp,
	`bannedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userSecurity_userId` PRIMARY KEY(`userId`)
);
