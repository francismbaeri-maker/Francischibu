import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing the Manus auth flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const profiles = mysqlTable("profiles", {
  id: int("id").autoincrement().primaryKey(),
  displayName: varchar("displayName", { length: 120 }).notNull(),
  handle: varchar("handle", { length: 80 }).notNull().unique(),
  city: varchar("city", { length: 120 }).notNull(),
  country: varchar("country", { length: 120 }).notNull(),
  countryCode: varchar("countryCode", { length: 8 }).notNull(),
  avatarUrl: text("avatarUrl").notNull(),
  nativeLanguage: varchar("nativeLanguage", { length: 80 }).notNull(),
  learningLanguage: varchar("learningLanguage", { length: 80 }).notNull(),
  proficiency: varchar("proficiency", { length: 40 }).notNull(),
  matchScore: int("matchScore").notNull().default(80),
  timezone: varchar("timezone", { length: 80 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("online"),
  verified: int("verified").notNull().default(0),
  interests: text("interests").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationKey: varchar("conversationKey", { length: 120 }).notNull(),
  senderName: varchar("senderName", { length: 120 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  isRead: int("isRead").notNull().default(1),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = typeof profiles.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;


/**
 * Local billing cache and business state. Stripe remains the source of truth for
 * provider details; these fields let the account page render status and renewal
 * information without exposing payment data or storing card details.
 */
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerCustomerId: varchar("providerCustomerId", { length: 120 }),
  providerSubscriptionId: varchar("providerSubscriptionId", { length: 120 }),
  plan: varchar("plan", { length: 80 }).notNull().default("free"),
  status: mysqlEnum("status", ["active", "trialing", "past_due", "canceled", "free"]).notNull().default("free"),
  renewalDate: timestamp("renewalDate"),
  cancelAtPeriodEnd: int("cancelAtPeriodEnd").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const billingReceipts = mysqlTable("billingReceipts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerInvoiceId: varchar("providerInvoiceId", { length: 120 }).notNull(),
  amountCents: int("amountCents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default("usd"),
  status: varchar("status", { length: 32 }).notNull().default("paid"),
  receiptUrl: text("receiptUrl"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;
export type BillingReceipt = typeof billingReceipts.$inferSelect;
export type InsertBillingReceipt = typeof billingReceipts.$inferInsert;


/** Security state for account verification and moderation. Verification tokens are stored hashed. */
export const userSecurity = mysqlTable("userSecurity", {
  userId: int("userId").primaryKey(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  emailVerificationTokenHash: varchar("emailVerificationTokenHash", { length: 128 }),
  emailVerificationExpiresAt: timestamp("emailVerificationExpiresAt"),
  bannedAt: timestamp("bannedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const userReports = mysqlTable("userReports", {
  id: int("id").autoincrement().primaryKey(),
  reporterUserId: int("reporterUserId").notNull(),
  reportedUserId: int("reportedUserId"),
  reportedProfileId: int("reportedProfileId"),
  targetLabel: varchar("targetLabel", { length: 160 }).notNull(),
  conversationKey: varchar("conversationKey", { length: 120 }),
  reason: varchar("reason", { length: 40 }).notNull(),
  details: text("details"),
  status: mysqlEnum("status", ["open", "reviewed", "dismissed", "banned"]).notNull().default("open"),
  reviewedByUserId: int("reviewedByUserId"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserSecurity = typeof userSecurity.$inferSelect;
export type InsertUserSecurity = typeof userSecurity.$inferInsert;
export type UserReport = typeof userReports.$inferSelect;
export type InsertUserReport = typeof userReports.$inferInsert;
