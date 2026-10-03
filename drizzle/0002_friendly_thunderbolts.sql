CREATE TABLE `billingReceipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'stripe',
	`providerInvoiceId` varchar(120) NOT NULL,
	`amountCents` int NOT NULL DEFAULT 0,
	`currency` varchar(8) NOT NULL DEFAULT 'usd',
	`status` varchar(32) NOT NULL DEFAULT 'paid',
	`receiptUrl` text,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingReceipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'stripe',
	`providerCustomerId` varchar(120),
	`providerSubscriptionId` varchar(120),
	`plan` varchar(80) NOT NULL DEFAULT 'free',
	`status` enum('active','trialing','past_due','canceled','free') NOT NULL DEFAULT 'free',
	`renewalDate` timestamp,
	`cancelAtPeriodEnd` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
