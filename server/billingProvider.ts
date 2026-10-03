import type { BillingReceipt, Subscription } from "../drizzle/schema";

const stripeSecret = () => process.env.STRIPE_SECRET_KEY;

export function isBillingProviderConfigured() {
  return Boolean(stripeSecret());
}

async function stripeRequest<T>(path: string, init: RequestInit = {}) {
  const key = stripeSecret();
  if (!key) return null;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Billing provider error (${response.status}): ${detail.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
};

type StripeInvoice = {
  id: string;
  amount_paid: number;
  currency: string;
  status: string | null;
  hosted_invoice_url: string | null;
  status_transitions?: { paid_at: number | null };
};

type StripeCheckoutSession = { id: string; url: string | null };

function statusForLocal(status: string): Subscription["status"] {
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (status === "active") return "active";
  return "free";
}

export async function createProviderCheckout(input: {
  userId: number;
  email?: string | null;
  name?: string | null;
  plan: "monthly" | "annual";
  origin: string;
}) {
  const priceId = input.plan === "annual" ? process.env.STRIPE_BOLD_PRO_ANNUAL_PRICE_ID : process.env.STRIPE_BOLD_PRO_MONTHLY_PRICE_ID;
  if (!stripeSecret() || !priceId) {
    return { provider: "unconfigured", status: "provider_keys_required" as const, checkoutUrl: null };
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
  const session = await stripeRequest<StripeCheckoutSession>("checkout/sessions", { method: "POST", body });
  return { provider: "stripe", status: "checkout_ready" as const, checkoutUrl: session?.url ?? null, sessionId: session?.id ?? null };
}

export async function cancelProviderSubscription(subscriptionId: string | null) {
  if (!subscriptionId || !stripeSecret()) return { provider: "unconfigured", status: "local_only" as const };
  await stripeRequest<StripeSubscription>(`subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "POST", body: new URLSearchParams({ cancel_at_period_end: "true" }) });
  return { provider: "stripe", status: "cancel_at_period_end" as const };
}

export async function syncProviderSubscription(subscription: Subscription) {
  if (!subscription.providerSubscriptionId || !stripeSecret()) return null;
  const remote = await stripeRequest<StripeSubscription>(`subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}`);
  if (!remote) return null;
  return {
    providerCustomerId: remote.customer,
    providerSubscriptionId: remote.id,
    plan: subscription.plan,
    status: statusForLocal(remote.status),
    renewalDate: new Date(remote.current_period_end * 1000),
    cancelAtPeriodEnd: remote.cancel_at_period_end ? 1 : 0,
  };
}

export async function listProviderInvoices(customerId: string | null) {
  if (!customerId || !stripeSecret()) return [] as Array<Pick<BillingReceipt, "providerInvoiceId" | "amountCents" | "currency" | "status" | "receiptUrl" | "paidAt">>;
  const result = await stripeRequest<{ data: StripeInvoice[] }>(`invoices?customer=${encodeURIComponent(customerId)}&limit=24`);
  return (result?.data ?? []).map((invoice) => ({
    providerInvoiceId: invoice.id,
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    status: invoice.status === "paid" ? "paid" : invoice.status ?? "open",
    receiptUrl: invoice.hosted_invoice_url,
    paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : null,
  }));
}
