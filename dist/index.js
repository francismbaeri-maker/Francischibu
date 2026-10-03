// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var profiles = mysqlTable("profiles", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationKey: varchar("conversationKey", { length: 120 }).notNull(),
  senderName: varchar("senderName", { length: 120 }).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  isRead: int("isRead").notNull().default(1)
});
var subscriptions = mysqlTable("subscriptions", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var billingReceipts = mysqlTable("billingReceipts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerInvoiceId: varchar("providerInvoiceId", { length: 120 }).notNull(),
  amountCents: int("amountCents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default("usd"),
  status: varchar("status", { length: 32 }).notNull().default("paid"),
  receiptUrl: text("receiptUrl"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
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
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  for (const field of textFields) {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
var seedProfiles = [
  { id: 1, displayName: "Valentina R.", handle: "vale.andes", city: "Medell\xEDn", country: "Colombia", countryCode: "CO", avatarUrl: "https://i.pravatar.cc/160?img=47", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B2", matchScore: 96, timezone: "GMT\u22125", status: "online", verified: 1, interests: "Coffee culture, design, hiking" },
  { id: 2, displayName: "Mateo S.", handle: "mateo.sampa", city: "S\xE3o Paulo", country: "Brazil", countryCode: "BR", avatarUrl: "https://i.pravatar.cc/160?img=12", nativeLanguage: "Portuguese", learningLanguage: "English", proficiency: "B1", matchScore: 91, timezone: "GMT\u22123", status: "online", verified: 1, interests: "Street photography, football, music" },
  { id: 3, displayName: "Luc\xEDa M.", handle: "lucia.porte\xF1a", city: "Buenos Aires", country: "Argentina", countryCode: "AR", avatarUrl: "https://i.pravatar.cc/160?img=32", nativeLanguage: "Spanish", learningLanguage: "Portuguese", proficiency: "A2", matchScore: 87, timezone: "GMT\u22123", status: "away", verified: 1, interests: "Books, cinema, architecture" },
  { id: 4, displayName: "Nadia K.", handle: "nadia.moves", city: "Toronto", country: "Canada", countryCode: "CA", avatarUrl: "https://i.pravatar.cc/160?img=49", nativeLanguage: "English", learningLanguage: "Spanish", proficiency: "C1", matchScore: 84, timezone: "GMT\u22124", status: "online", verified: 0, interests: "Running, museums, cooking" },
  { id: 5, displayName: "Rafael P.", handle: "rafa.pac\xEDfico", city: "Lima", country: "Peru", countryCode: "PE", avatarUrl: "https://i.pravatar.cc/160?img=68", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B2", matchScore: 82, timezone: "GMT\u22125", status: "offline", verified: 1, interests: "Surfing, food, startups" },
  { id: 6, displayName: "Sofia B.", handle: "sofia.baires", city: "C\xF3rdoba", country: "Argentina", countryCode: "AR", avatarUrl: "https://i.pravatar.cc/160?img=44", nativeLanguage: "Spanish", learningLanguage: "English", proficiency: "B1", matchScore: 78, timezone: "GMT\u22123", status: "online", verified: 0, interests: "Yoga, podcasts, photography" }
];
var seedMessages = [
  { id: 1, conversationKey: "valentina", senderName: "Valentina R.", body: "Hey! I saw you\u2019re learning Spanish. Want to trade a coffee chat for a pronunciation warm-up?", createdAt: new Date(Date.now() - 1e3 * 60 * 24), isRead: 1 },
  { id: 2, conversationKey: "valentina", senderName: "You", body: "That sounds perfect. I\u2019m working on my Colombian expressions this week.", createdAt: new Date(Date.now() - 1e3 * 60 * 18), isRead: 1 },
  { id: 3, conversationKey: "valentina", senderName: "Valentina R.", body: "Then you\u2019re in the right place \u2014 I\u2019ll send you three phrases from Medell\xEDn tomorrow \u2615", createdAt: new Date(Date.now() - 1e3 * 60 * 4), isRead: 0 }
];
async function listProfiles() {
  const db = await getDb();
  if (!db) return seedProfiles;
  const result = await db.select().from(profiles).orderBy(desc(profiles.matchScore)).limit(24);
  return result.length ? result : seedProfiles;
}
async function listMessages(conversationKey) {
  const db = await getDb();
  if (!db) return seedMessages.filter((message) => message.conversationKey === conversationKey);
  const result = await db.select().from(messages).where(eq(messages.conversationKey, conversationKey)).orderBy(messages.createdAt);
  return result.length ? result : seedMessages.filter((message) => message.conversationKey === conversationKey);
}
async function createMessage(input) {
  const db = await getDb();
  if (!db) return { id: Date.now(), ...input, createdAt: /* @__PURE__ */ new Date(), isRead: 1 };
  const result = await db.insert(messages).values({ ...input, isRead: 1 });
  return { id: Number(result[0].insertId), ...input, createdAt: /* @__PURE__ */ new Date(), isRead: 1 };
}
var demoSubscription = {
  id: 0,
  userId: 0,
  provider: "demo",
  providerCustomerId: null,
  providerSubscriptionId: "demo_bold_pro_monthly",
  plan: "BOLD Pro Monthly",
  status: "active",
  renewalDate: /* @__PURE__ */ new Date("2026-10-22T00:00:00.000Z"),
  cancelAtPeriodEnd: 0,
  createdAt: /* @__PURE__ */ new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: /* @__PURE__ */ new Date()
};
async function getSubscriptionForUser(userId, preview = false) {
  const db = await getDb();
  if (!db) return preview ? demoSubscription : { ...demoSubscription, userId, provider: "local", providerSubscriptionId: null, plan: "free", status: "free", renewalDate: null };
  const result = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (result[0]) return result[0];
  return preview ? { ...demoSubscription, userId } : { ...demoSubscription, userId, provider: "local", providerSubscriptionId: null, plan: "free", status: "free", renewalDate: null };
}
async function saveSubscription(input) {
  const db = await getDb();
  if (!db) return { ...demoSubscription, ...input, id: Date.now(), updatedAt: /* @__PURE__ */ new Date() };
  const existing = await db.select().from(subscriptions).where(eq(subscriptions.userId, input.userId)).limit(1);
  if (existing[0]) {
    await db.update(subscriptions).set({ ...input, updatedAt: /* @__PURE__ */ new Date() }).where(eq(subscriptions.id, existing[0].id));
    return { ...existing[0], ...input, updatedAt: /* @__PURE__ */ new Date() };
  }
  const result = await db.insert(subscriptions).values(input);
  return { ...input, id: Number(result[0].insertId), createdAt: /* @__PURE__ */ new Date(), updatedAt: /* @__PURE__ */ new Date() };
}
async function cancelSubscriptionLocally(userId) {
  const current = await getSubscriptionForUser(userId, false);
  return saveSubscription({
    userId,
    provider: current.provider,
    providerCustomerId: current.providerCustomerId,
    providerSubscriptionId: current.providerSubscriptionId,
    plan: current.plan,
    status: "canceled",
    renewalDate: current.renewalDate,
    cancelAtPeriodEnd: 1
  });
}
async function listBillingReceipts(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(billingReceipts).where(eq(billingReceipts.userId, userId)).orderBy(desc(billingReceipts.paidAt));
}
async function saveBillingReceipt(input) {
  const db = await getDb();
  if (!db) return { ...input, id: Date.now(), createdAt: /* @__PURE__ */ new Date() };
  const existing = await db.select().from(billingReceipts).where(eq(billingReceipts.providerInvoiceId, input.providerInvoiceId)).limit(1);
  if (existing[0]) return existing[0];
  const result = await db.insert(billingReceipts).values(input);
  return { ...input, id: Number(result[0].insertId), createdAt: /* @__PURE__ */ new Date() };
}
async function getAdminBillingOverview() {
  const db = await getDb();
  if (!db) {
    return {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      canceledSubscriptions: 0,
      cancellationRate: 0,
      recentPayments: [],
      lastUpdated: /* @__PURE__ */ new Date()
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
    cancellationRate: totalSubscriptions ? Math.round(canceledSubscriptions / totalSubscriptions * 1e3) / 10 : 0,
    recentPayments: receiptRows,
    lastUpdated: /* @__PURE__ */ new Date()
  };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { z as z2 } from "zod";

// server/billingProvider.ts
var stripeSecret = () => process.env.STRIPE_SECRET_KEY;
async function stripeRequest(path3, init = {}) {
  const key = stripeSecret();
  if (!key) return null;
  const response = await fetch(`https://api.stripe.com/v1/${path3}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...init.headers ?? {}
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Billing provider error (${response.status}): ${detail.slice(0, 240)}`);
  }
  return await response.json();
}
function statusForLocal(status) {
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (status === "active") return "active";
  return "free";
}
async function createProviderCheckout(input) {
  const priceId = input.plan === "annual" ? process.env.STRIPE_BOLD_PRO_ANNUAL_PRICE_ID : process.env.STRIPE_BOLD_PRO_MONTHLY_PRICE_ID;
  if (!stripeSecret() || !priceId) {
    return { provider: "unconfigured", status: "provider_keys_required", checkoutUrl: null };
  }
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", `${input.origin}/account?billing=success`);
  body.set("cancel_url", `${input.origin}/account?billing=cancelled`);
  body.set("allow_promotion_codes", "true");
  body.set("client_reference_id", String(input.userId));
  body.set("metadata[user_id]", String(input.userId));
  body.set("metadata[customer_email]", input.email ?? "");
  body.set("metadata[customer_name]", input.name ?? "");
  if (input.email) body.set("customer_email", input.email);
  const session = await stripeRequest("checkout/sessions", { method: "POST", body });
  return { provider: "stripe", status: "checkout_ready", checkoutUrl: session?.url ?? null, sessionId: session?.id ?? null };
}
async function cancelProviderSubscription(subscriptionId) {
  if (!subscriptionId || !stripeSecret()) return { provider: "unconfigured", status: "local_only" };
  await stripeRequest(`subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "POST", body: new URLSearchParams({ cancel_at_period_end: "true" }) });
  return { provider: "stripe", status: "cancel_at_period_end" };
}
async function syncProviderSubscription(subscription) {
  if (!subscription.providerSubscriptionId || !stripeSecret()) return null;
  const remote = await stripeRequest(`subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}`);
  if (!remote) return null;
  return {
    providerCustomerId: remote.customer,
    providerSubscriptionId: remote.id,
    plan: subscription.plan,
    status: statusForLocal(remote.status),
    renewalDate: new Date(remote.current_period_end * 1e3),
    cancelAtPeriodEnd: remote.cancel_at_period_end ? 1 : 0
  };
}
async function listProviderInvoices(customerId) {
  if (!customerId || !stripeSecret()) return [];
  const result = await stripeRequest(`invoices?customer=${encodeURIComponent(customerId)}&limit=24`);
  return (result?.data ?? []).map((invoice) => ({
    providerInvoiceId: invoice.id,
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    status: invoice.status === "paid" ? "paid" : invoice.status ?? "open",
    receiptUrl: invoice.hosted_invoice_url,
    paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1e3) : null
  }));
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
var billingInput = z2.object({ plan: z2.enum(["monthly", "annual"]).default("monthly") });
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  discovery: router({
    profiles: publicProcedure.input(z2.object({ country: z2.string().optional(), language: z2.string().optional() }).optional()).query(async ({ input }) => {
      const profiles2 = await listProfiles();
      return profiles2.filter((profile) => {
        const countryMatch = !input?.country || input.country === "All regions" || profile.country === input.country;
        const languageMatch = !input?.language || input.language === "Any language" || profile.nativeLanguage === input.language || profile.learningLanguage === input.language;
        return countryMatch && languageMatch;
      });
    })
  }),
  chat: router({
    messages: publicProcedure.input(z2.object({ conversationKey: z2.string().default("valentina") })).query(({ input }) => listMessages(input.conversationKey)),
    send: publicProcedure.input(z2.object({ conversationKey: z2.string(), senderName: z2.string().default("You"), body: z2.string().min(1).max(1e3) })).mutation(({ input }) => createMessage(input))
  }),
  billing: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 1;
      const current = await getSubscriptionForUser(userId, !ctx.user);
      const synced = await syncProviderSubscription(current);
      if (synced && ctx.user) return saveSubscription({ userId, provider: current.provider, ...synced });
      return current;
    }),
    history: publicProcedure.query(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 1;
      const current = await getSubscriptionForUser(userId, !ctx.user);
      const remote = await listProviderInvoices(current.providerCustomerId);
      if (remote.length && ctx.user) {
        for (const receipt of remote) await saveBillingReceipt({ userId, provider: current.provider, ...receipt });
      }
      const local = await listBillingReceipts(userId);
      return remote.length ? remote : local;
    }),
    checkout: publicProcedure.input(billingInput).mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const origin = String(ctx.req.headers.origin ?? "http://localhost:3000");
      return createProviderCheckout({ userId: user?.id ?? 1, email: user?.email, name: user?.name, plan: input.plan, origin });
    }),
    intent: publicProcedure.input(billingInput.optional()).mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      const origin = String(ctx.req.headers.origin ?? "http://localhost:3000");
      return createProviderCheckout({ userId: user?.id ?? 1, email: user?.email, name: user?.name, plan: input?.plan ?? "monthly", origin });
    }),
    cancel: publicProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user?.id ?? 1;
      const current = await getSubscriptionForUser(userId, !ctx.user);
      const providerResult = await cancelProviderSubscription(current.providerSubscriptionId);
      const updated = ctx.user ? await cancelSubscriptionLocally(userId) : { ...current, status: "canceled", cancelAtPeriodEnd: 1 };
      return { provider: providerResult, subscription: updated };
    })
  }),
  admin: router({
    billingOverview: adminProcedure.query(() => getAdminBillingOverview())
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
