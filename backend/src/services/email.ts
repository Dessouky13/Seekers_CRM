import nodemailer from "nodemailer";

function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
    port:   Number(process.env.BREVO_SMTP_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
  });
}

const FROM = `"${process.env.EMAIL_FROM_NAME ?? "Seekers AI"}" <${process.env.EMAIL_FROM ?? "Team@seekersai.org"}>`;

export async function sendInviteEmail(
  to: string,
  inviteUrl: string,
  role: string,
): Promise<void> {
  await getTransporter().sendMail({
    from:    FROM,
    to,
    subject: "You're invited to Seekers AI OS",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7C3AED">Seekers AI OS</h2>
        <p>You've been invited to join the team as a <strong>${role}</strong>.</p>
        <p>
          <a href="${inviteUrl}"
             style="display:inline-block;padding:10px 20px;background:#7C3AED;color:#fff;border-radius:6px;text-decoration:none">
            Accept Invite
          </a>
        </p>
        <p style="color:#888;font-size:13px">This invite expires in 48 hours.</p>
      </div>
    `,
  });
}

export interface SendOutreachEmailResult {
  messageId: string;
  accepted:  string[];
  rejected:  string[];
}

const LOGO_URL = process.env.LOGO_URL ?? "https://seekers-crm.vercel.app/logo-symbol.png";
const SITE_URL = process.env.SITE_URL ?? "https://seekersai.org";

// Build a default signature when a rep hasn't set their own.
// Uses brand colors + the hosted logo so it renders consistently in any client.
export function buildDefaultSignature(opts: {
  name?:  string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const name  = opts.name  ?? "The Seekers team";
  const title = opts.title ?? "Seekers AI Automation Solutions";
  const email = opts.email ?? process.env.EMAIL_FROM ?? "team@seekersai.org";
  const phone = opts.phone ?? null;

  // Build a WhatsApp-friendly tel link if phone provided (strip spaces, keep +)
  const phoneCompact = phone ? phone.replace(/\s+/g, "") : null;
  const whatsappLink = phoneCompact ? `https://wa.me/${phoneCompact.replace(/[^\d+]/g, "").replace(/^\+/, "")}` : null;

  return `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;color:#555;line-height:1.5">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="${LOGO_URL}" alt="Seekers AI" width="42" height="42" style="display:block;border-radius:6px"/>
        <div>
          <div style="color:#111;font-weight:600;font-size:14px">${escapeHtml(name)}</div>
          <div style="color:#666;font-size:12px">${escapeHtml(title)}</div>
        </div>
      </div>
      <div style="margin-top:10px;color:#666;font-size:12px">
        <a href="${SITE_URL}" style="color:#7c3aed;text-decoration:none">${SITE_URL.replace(/^https?:\/\//, "")}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${escapeHtml(email)}" style="color:#7c3aed;text-decoration:none">${escapeHtml(email)}</a>
        ${phone ? `&nbsp;·&nbsp;<a href="${whatsappLink}" style="color:#7c3aed;text-decoration:none">${escapeHtml(phone)}</a>` : ""}
      </div>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Generic outreach send. body can be plain text (we'll wrap it in HTML) or HTML directly.
// signatureHtml is appended AFTER the body in the rendered HTML.
export async function sendOutreachEmail(opts: {
  to:            string;
  subject:       string;
  body:          string;
  fromName?:     string;
  replyTo?:      string;
  signatureHtml?: string;
}): Promise<SendOutreachEmailResult> {
  const from = opts.fromName
    ? `"${opts.fromName}" <${process.env.EMAIL_FROM ?? "team@seekersai.org"}>`
    : FROM;

  // If body doesn't look like HTML, convert newlines to <br> and wrap minimally
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(opts.body);
  const bodyHtml = isHtml
    ? opts.body
    : opts.body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;line-height:1.55;color:#222">
${bodyHtml}
${opts.signatureHtml ?? ""}
</div>`;

  const info = await getTransporter().sendMail({
    from,
    to:       opts.to,
    subject:  opts.subject,
    html,
    text:     isHtml ? undefined : opts.body,    // text version is body only (no signature)
    replyTo:  opts.replyTo,
  });

  return {
    messageId: info.messageId ?? "",
    accepted:  (info.accepted as string[]) ?? [],
    rejected:  (info.rejected as string[]) ?? [],
  };
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  await getTransporter().sendMail({
    from:    FROM,
    to,
    subject: "Reset your Seekers AI OS password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7C3AED">Seekers AI OS</h2>
        <p>We received a request to reset your password.</p>
        <p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:10px 20px;background:#7C3AED;color:#fff;border-radius:6px;text-decoration:none">
            Reset Password
          </a>
        </p>
        <p style="color:#888;font-size:13px">
          This link expires in 1 hour. If you didn't request this, you can ignore this email.
        </p>
      </div>
    `,
  });
}
