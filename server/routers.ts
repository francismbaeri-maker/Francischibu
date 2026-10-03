import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { banUser, cancelSubscriptionLocally, createMessage, createUserReport, getAdminBillingOverview, getSubscriptionForUser, isUserBanned, isUserEmailVerified, issueEmailVerification, listBillingReceipts, listMessages, listModerationReports, listProfiles, saveBillingReceipt, saveSubscription, updateUserReport, verifyEmailToken } from "./db";
import { cancelProviderSubscription, createProviderCheckout, listProviderInvoices, syncProviderSubscription } from "./billingProvider";
import { sendVerificationEmail } from "./emailVerification";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

const billingInput = z.object({ plan: z.enum(["monthly", "annual"]).default("monthly") });

async function assertVerifiedMember(userId: number) {
  if (await isUserBanned(userId)) throw new TRPCError({ code: "FORBIDDEN", message: "This account has been suspended." });
  if (!(await isUserEmailVerified(userId))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Please verify your email before using chat or matching." });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    securityStatus: protectedProcedure.query(async ({ ctx }) => ({ emailVerified: await isUserEmailVerified(ctx.user.id), banned: await isUserBanned(ctx.user.id) })),
    requestEmailVerification: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.email) throw new TRPCError({ code: "BAD_REQUEST", message: "An email address is required to verify this account." });
      const issued = await issueEmailVerification(ctx.user.id);
      const origin = String(ctx.req.headers.origin ?? "http://localhost:3000");
      const verificationUrl = `${origin}/verify-email?token=${issued.token}`;
      const delivery = await sendVerificationEmail({ to: ctx.user.email, verificationUrl });
      return { verificationUrl: delivery.mode === "preview" ? verificationUrl : null, delivery: delivery.mode, expiresAt: issued.expiresAt };
    }),
    verifyEmail: publicProcedure.input(z.object({ token: z.string().min(32).max(128) })).mutation(({ input }) => verifyEmailToken(input.token)),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  discovery: router({
    profiles: publicProcedure
      .input(z.object({ country: z.string().optional(), language: z.string().optional() }).optional())
      .query(async ({ input }) => {
        const profiles = await listProfiles();
        return profiles.filter((profile) => {
          const countryMatch = !input?.country || input.country === "All regions" || profile.country === input.country;
          const languageMatch = !input?.language || input.language === "Any language" || profile.nativeLanguage === input.language || profile.learningLanguage === input.language;
          return countryMatch && languageMatch;
        });
      }),
    connect: protectedProcedure.input(z.object({ profileId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      await assertVerifiedMember(ctx.user.id);
      return { success: true, profileId: input.profileId } as const;
    }),
  }),
  chat: router({
    messages: publicProcedure.input(z.object({ conversationKey: z.string().default("valentina") })).query(({ input }) => listMessages(input.conversationKey)),
    send: protectedProcedure.input(z.object({ conversationKey: z.string(), senderName: z.string().default("You"), body: z.string().min(1).max(1000) })).mutation(async ({ ctx, input }) => { await assertVerifiedMember(ctx.user.id); return createMessage(input); }),
    report: protectedProcedure.input(z.object({ conversationKey: z.string(), targetLabel: z.string().min(1).max(160), reportedUserId: z.number().int().positive().optional(), reportedProfileId: z.number().int().positive().optional(), reason: z.enum(["spam", "harassment", "fraud", "inappropriate", "other"]), details: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => { if (await isUserBanned(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN", message: "This account has been suspended." }); return createUserReport({ reporterUserId: ctx.user.id, targetLabel: input.targetLabel, reportedUserId: input.reportedUserId, reportedProfileId: input.reportedProfileId, conversationKey: input.conversationKey, reason: input.reason, details: input.details }); }),
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
      const updated = ctx.user ? await cancelSubscriptionLocally(userId) : { ...current, status: "canceled" as const, cancelAtPeriodEnd: 1 };
      return { provider: providerResult, subscription: updated };
    }),
  }),
  admin: router({
    billingOverview: adminProcedure.query(() => getAdminBillingOverview()),
    reports: adminProcedure.query(() => listModerationReports()),
    reviewReport: adminProcedure.input(z.object({ reportId: z.number().int().positive(), status: z.enum(["reviewed", "dismissed", "banned"]), ban: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
      const reports = await listModerationReports();
      const report = reports.find((item) => item.id === input.reportId);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found." });
      if (input.ban && !report.reportedUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "This report is not linked to a user account." });
      if (input.ban && report.reportedUserId) await banUser(report.reportedUserId);
      return updateUserReport({ reportId: input.reportId, reviewerUserId: ctx.user.id, status: input.ban ? "banned" : input.status });
    }),
  }),
});

export type AppRouter = typeof appRouter;
