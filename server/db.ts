import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertBillingReceipt, InsertSubscription, InsertUser, InsertUserReport, billingReceipts, messages, profiles, subscriptions, userReports, userSecurity, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export const seedProfiles = [
  { id: 1, displayName: "Valentina R.", handle: "vale.andes", city: "Medellín", country: "Colombia", countryCode: "CO", avatarUrl: "https://i.pravatar.cc/160?img=47", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B2", matchScore: 96, timezone: "GMT−5", status: "online", verified: 1, interests: "Coffee culture, design, hiking" },
  { id: 2, displayName: "Mateo S.", handle: "mateo.sampa", city: "São Paulo", country: "Brazil", countryCode: "BR", avatarUrl: "https://i.pravatar.cc/160?img=12", nativeLanguage: "Portuguese", learningLanguage: "English", proficiency: "B1", matchScore: 91, timezone: "GMT−3", status: "online", verified: 1, interests: "Street photography, football, music" },
  { id: 3, displayName: "Lucía M.", handle: "lucia.porteña", city: "Buenos Aires", country: "Argentina", countryCode: "AR", avatarUrl: "https://i.pravatar.cc/160?img=32", nativeLanguage: "Spanish", learningLanguage: "Portuguese", proficiency: "A2", matchScore: 87, timezone: "GMT−3", status: "away", verified: 1, interests: "Books, cinema, architecture" },
  { id: 4, displayName: "Nadia K.", handle: "nadia.moves", city: "Toronto", country: "Canada", countryCode: "CA", avatarUrl: "https://i.pravatar.cc/160?img=49", nativeLanguage: "English", learningLanguage: "Spanish", proficiency: "C1", matchScore: 84, timezone: "GMT−4", status: "online", verified: 0, interests: "Running, museums, cooking" },
  { id: 5, displayName: "Rafael P.", handle: "rafa.pacífico", city: "Lima", country: "Peru", countryCode: "PE", avatarUrl: "https://i.pravatar.cc/160?img=68", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B2", matchScore: 82, timezone: "GMT−5", status: "offline", verified: 1, interests: "Surfing, food, startups" },
  { id: 6, displayName: "Sofia B.", handle: "sofia.baires", city: "Córdoba", country: "Argentina", countryCode: "AR", avatarUrl: "https://i.pravatar.cc/160?img=44", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B1", matchScore: 78, timezone: "GMT−3", status: "online", verified: 0, interests: "Yoga, podcasts, photography" },
];

export const seedMessages = [
  { id: 1, conversationKey: "valentina", senderName: "Valentina R.", body: "Hey! I saw you’re learning Spanish. Want to trade a coffee chat for a pronunciation warm-up?", createdAt: new Date(Date.now() - 1000 * 60 * 24), isRead: 1 },
  { id: 2, conversationKey: "valentina", senderName: "You", body: "That sounds perfect. I’m working on my Colombian expressions this week.", createdAt: new Date(Date.now() - 1000 * 60 * 18), isRead: 1 },
  { id: 3, conversationKey: "valentina", senderName: "Valentina R.", body: "Then you’re in the right place — I’ll send you three phrases from Medellín tomorrow ☕", createdAt: new Date(Date.now() - 1000 * 60 * 4), isRead: 0 },
];

export async function listProfiles() {
  const db = await getDb();
  if (!db) return seedProfiles;
  const result = await db.select().from(profiles).orderBy(desc(profiles.matchScore)).limit(24);
  return result.length ? result : seedProfiles;
}

export async function listMessages(conversationKey: string) {
  const db = await getDb();
  if (!db) return seedMessages.filter((message) => message.conversationKey === conversationKey);
  const result = await db.select().from(messages).where(eq(messages.conversationKey, conversationKey)).orderBy(messages.createdAt);
  return result.length ? result : seedMessages.filter((message) => message.conversationKey === conversationKey);
}

export async function createMessage(input: { conversationKey: string; senderName: string; body: string }) {
  const db = await getDb();
  if (!db) return { id: Date.now(), ...input, createdAt: new Date(), isRead: 1 };
  const result = await db.insert(messages).values({ ...input, isRead: 1 });
  return { id: Number(result[0].insertId), ...input, createdAt: new Date(), isRead: 1 };
}


const demoSubscription = {
  id: 0,
  userId: 0,
  provider: "demo",
  providerCustomerId: null,
  providerSubscriptionId: "demo_bold_pro_monthly",
  plan: "BOLD Pro Monthly",
  status: "active" as const,
  renewalDate: new Date("2026-10-22T00:00:00.000Z"),
  cancelAtPeriodEnd: 0,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date(),
};

export async function getSubscriptionForUser(userId: number, preview = false) {
  const db = await getDb();
  if (!db) return preview ? demoSubscription : { ...demoSubscription, userId, provider: "local", providerSubscriptionId: null, plan: "free", status: "free" as const, renewalDate: null };
  const result = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (result[0]) return result[0];
  return preview ? { ...demoSubscription, userId } : { ...demoSubscription, userId, provider: "local", providerSubscriptionId: null, plan: "free", status: "free" as const, renewalDate: null };
}

export async function saveSubscription(input: InsertSubscription) {
  const db = await getDb();
  if (!db) return { ...demoSubscription, ...input, id: Date.now(), updatedAt: new Date() };
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, input.userId)).limit(1);
  if (existing[0]) {
    await db.update(subscriptions).set({ ...input, updatedAt: new Date() }).where(eq(subscriptions.id, existing[0].id));
    return { ...existing[0], ...input, updatedAt: new Date() };
  }
  const result = await db.insert(subscriptions).values(input);
  return { ...input, id: Number(result[0].insertId), createdAt: new Date(), updatedAt: new Date() };
}

export async function cancelSubscriptionLocally(userId: number) {
  const current = await getSubscriptionForUser(userId, false);
  return saveSubscription({
    userId,
    provider: current.provider,
    providerCustomerId: current.providerCustomerId,
    providerSubscriptionId: current.providerSubscriptionId,
    plan: current.plan,
    status: "canceled",
    renewalDate: current.renewalDate,
    cancelAtPeriodEnd: 1,
  });
}

export async function listBillingReceipts(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(billingReceipts).where(eq(billingReceipts.userId, userId)).orderBy(desc(billingReceipts.paidAt));
}

export async function saveBillingReceipt(input: InsertBillingReceipt) {
  const db = await getDb();
  if (!db) return { ...input, id: Date.now(), createdAt: new Date() };
  const existing = await db.select().from(billingReceipts).where(eq(billingReceipts.providerInvoiceId, input.providerInvoiceId)).limit(1);
  if (existing[0]) return existing[0];
  const result = await db.insert(billingReceipts).values(input);
  return { ...input, id: Number(result[0].insertId), createdAt: new Date() };
}


export async function getAdminBillingOverview() {
  const db = await getDb();
  if (!db) {
    return {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      canceledSubscriptions: 0,
      cancellationRate: 0,
      recentPayments: [],
      lastUpdated: new Date(),
    };
  }
  const subscriptionRows = await db.select().from(subscriptions);
  const receiptRows = await db.select().from(billingReceipts).orderBy(desc(billingReceipts.paidAt)).limit(12);
  const totalSubscriptions = subscriptionRows.length;
  const activeSubscriptions = subscriptionRows.filter((row) => row.status === "active" || row.status === "trialing").length;
  const canceledSubscriptions = subscriptionRows.filter((row) => row.status === "canceled").length;
  return {
    totalSubscriptions,
    activeSubscriptions,
    canceledSubscriptions,
    cancellationRate: totalSubscriptions ? Math.round((canceledSubscriptions / totalSubscriptions) * 1000) / 10 : 0,
    recentPayments: receiptRows,
    lastUpdated: new Date(),
  };
}


export async function getUserSecurity(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(userSecurity).where(eq(userSecurity.userId, userId)).limit(1);
  return result[0];
}

export async function issueEmailVerification(userId: number) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
  const db = await getDb();
  if (db) {
    await db.insert(userSecurity).values({ userId, emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt, updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt, updatedAt: new Date() } });
  }
  return { token, expiresAt };
}

export async function verifyEmailToken(token: string) {
  const db = await getDb();
  if (!db) return false;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await db.select().from(userSecurity).where(and(eq(userSecurity.emailVerificationTokenHash, tokenHash), gt(userSecurity.emailVerificationExpiresAt, new Date()))).limit(1);
  const row = result[0];
  if (!row) return false;
  await db.update(userSecurity).set({ emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null, updatedAt: new Date() }).where(eq(userSecurity.userId, row.userId));
  return true;
}

export async function isUserEmailVerified(userId: number) {
  const security = await getUserSecurity(userId);
  return Boolean(security?.emailVerifiedAt);
}

export async function isUserBanned(userId: number) {
  const security = await getUserSecurity(userId);
  return Boolean(security?.bannedAt);
}

export async function createUserReport(input: InsertUserReport) {
  const db = await getDb();
  if (!db) return { ...input, id: Date.now(), status: "open" as const, createdAt: new Date() };
  const result = await db.insert(userReports).values(input);
  return { ...input, id: Number(result[0].insertId), status: "open" as const, createdAt: new Date() };
}

export async function listModerationReports() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userReports).orderBy(desc(userReports.createdAt)).limit(100);
}

export async function updateUserReport(input: { reportId: number; reviewerUserId: number; status: "reviewed" | "dismissed" | "banned" }) {
  const db = await getDb();
  if (!db) return { reportId: input.reportId, status: input.status };
  await db.update(userReports).set({ status: input.status, reviewedByUserId: input.reviewerUserId, reviewedAt: new Date() }).where(eq(userReports.id, input.reportId));
  return { reportId: input.reportId, status: input.status };
}

export async function banUser(userId: number) {
  const db = await getDb();
  if (!db) return { userId, bannedAt: new Date() };
  await db.insert(userSecurity).values({ userId, bannedAt: new Date(), updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { bannedAt: new Date(), updatedAt: new Date() } });
  return { userId, bannedAt: new Date() };
}


export async function ensureUserSecurity(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(userSecurity).values({ userId, updatedAt: new Date() }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
}
