type VerificationDelivery = { delivered: boolean; mode: "provider" | "preview" };

export async function sendVerificationEmail(input: { to: string; verificationUrl: string }): Promise<VerificationDelivery> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { delivered: false, mode: "preview" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "Verify your BOLD email",
      html: `<p>Welcome to BOLD.</p><p>Confirm your email to unlock full chat and matching.</p><p><a href="${input.verificationUrl}">Verify my email</a></p><p>This link expires in 24 hours.</p>`,
    }),
  });
  if (!response.ok) throw new Error("Verification email provider rejected the message.");
  return { delivered: true, mode: "provider" };
}
