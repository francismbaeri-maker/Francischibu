import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ctx = {
  user: null,
  req: { protocol: "https", headers: {} },
  res: {},
} as TrpcContext;

describe("BOLD public procedures", () => {
  it("returns a seeded directory for discovery", async () => {
    const result = await appRouter.createCaller(ctx).discovery.profiles();
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some((profile) => profile.country === "Colombia")).toBe(true);
  });

  it("returns the language spark conversation", async () => {
    const result = await appRouter.createCaller(ctx).chat.messages({ conversationKey: "valentina" });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]?.body).toContain("Spanish");
  });

  it("returns a persisted-ready subscription status for the billing page", async () => {
    const result = await appRouter.createCaller(ctx).billing.status();
    expect(result.status).toBe("active");
    expect(result.plan).toContain("BOLD Pro");
    expect(result.renewalDate).toBeInstanceOf(Date);
  });

  it("returns a safe provider setup state when payment keys are not configured", async () => {
    const result = await appRouter.createCaller(ctx).billing.intent({ plan: "monthly" });
    expect(result.status).toBe("provider_keys_required");
    expect(result.checkoutUrl).toBeNull();
  });

  it("routes cancellation through the billing provider adapter and updates local state", async () => {
    const result = await appRouter.createCaller(ctx).billing.cancel();
    expect(result.provider.status).toBe("local_only");
    expect(result.subscription.status).toBe("canceled");
    expect(result.subscription.cancelAtPeriodEnd).toBe(1);
  });

  it("blocks non-admin users from billing analytics", async () => {
    await expect(appRouter.createCaller(ctx).admin.billingOverview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns subscription and payment metrics for administrators", async () => {
    const adminCtx = {
      ...ctx,
      user: { id: 1, openId: "admin-test", name: "Admin", email: "admin@example.com", loginMethod: "test", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    } as TrpcContext;
    const result = await appRouter.createCaller(adminCtx).admin.billingOverview();
    expect(result).toHaveProperty("activeSubscriptions");
    expect(result).toHaveProperty("cancellationRate");
    expect(Array.isArray(result.recentPayments)).toBe(true);
  });
});
