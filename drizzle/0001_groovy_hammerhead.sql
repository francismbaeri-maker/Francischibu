CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationKey` varchar(120) NOT NULL,
	`senderName` varchar(120) NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`isRead` int NOT NULL DEFAULT 1,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`handle` varchar(80) NOT NULL,
	`city` varchar(120) NOT NULL,
	`country` varchar(120) NOT NULL,
	`countryCode` varchar(8) NOT NULL,
	`avatarUrl` text NOT NULL,
	`nativeLanguage` varchar(80) NOT NULL,
	`learningLanguage` varchar(80) NOT NULL,
	`proficiency` varchar(40) NOT NULL,
	`matchScore` int NOT NULL DEFAULT 80,
	`timezone` varchar(80) NOT NULL,
	`status` varchar(40) NOT NULL DEFAULT 'online',
	`verified` int NOT NULL DEFAULT 0,
	`interests` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `profiles_handle_unique` UNIQUE(`handle`)
);
