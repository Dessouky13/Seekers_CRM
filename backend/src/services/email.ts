import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";

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

// Deliverability-optimized signature for cold outreach.
//
// Cold-outreach spam triggers we deliberately AVOID:
//   • External images (logo on third-party CDN) — biggest single spam-score hit
//   • Multiple clickable styled <a> tags — "marketing template" fingerprint
//   • Inline-styled wrapper divs with max-width / font-family / colors
//
// What we keep:
//   • Brand identity as plain text ("The Seekers team" / company line)
//   • Email + phone as PLAIN TEXT — Gmail/Outlook auto-link these on render,
//     so the recipient still gets a clickable email/WhatsApp number, but
//     spam filters see plain text. Best of both worlds.
//
// Phone falls back to SIGNATURE_PHONE env var so every email gets it.
export function buildDefaultSignature(opts: {
  name?:  string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const email = opts.email ?? process.env.EMAIL_FROM      ?? "team@seekersai.org";
  const phone = opts.phone ?? process.env.SIGNATURE_PHONE ?? null;

  const contact = [escapeHtml(email), phone ? escapeHtml(phone) : null]
    .filter(Boolean)
    .join(" &middot; ");

  // Plain <p> tags only — no fonts, no colors, no <a> tags, no images.
  // Looks like a human typed it; email clients auto-link the email and phone.
  return [
    `<p style="margin-top:24px;margin-bottom:4px">— The Seekers team</p>`,
    `<p style="margin:0">Seekers AI Automation Solutions</p>`,
    `<p style="margin:4px 0 0 0">${contact}</p>`,
  ].join("\n");
}

// Plain-text equivalent of buildDefaultSignature. Used for the text/plain MIME
// alternative — emails without a real text alt get a hefty spam penalty.
export function buildDefaultSignatureText(opts: {
  email?: string | null;
  phone?: string | null;
}): string {
  const email = opts.email ?? process.env.EMAIL_FROM      ?? "team@seekersai.org";
  const phone = opts.phone ?? process.env.SIGNATURE_PHONE ?? null;
  const contact = [email, phone].filter(Boolean).join(" · ");
  // "-- " (dash dash space) is the RFC-3676 sig delimiter — Gmail/Outlook
  // collapse everything below it as quoted-signature, which is the standard
  // friendly cold-email shape.
  return `\n\n-- \nThe Seekers team\nSeekers AI Automation Solutions\n${contact}`;
}

// Strip HTML to plaintext for the text/plain MIME alternative.
// Not perfect, but handles the cases our outreach bodies produce (<p>, <br>, <a>).
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Generic outreach send. body can be plain text (we'll wrap it in HTML) or HTML directly.
// signatureHtml is appended AFTER the body in the rendered HTML.
// signatureText is the plain-text equivalent (defaults to stripping signatureHtml).
export async function sendOutreachEmail(opts: {
  to:             string;
  subject:        string;
  body:           string;
  fromName?:      string;
  replyTo?:       string;
  signatureHtml?: string;
  signatureText?: string;
}): Promise<SendOutreachEmailResult> {
  const from = opts.fromName
    ? `"${opts.fromName}" <${process.env.EMAIL_FROM ?? "team@seekersai.org"}>`
    : FROM;

  // If body doesn't look like HTML, convert newlines to <br> and wrap minimally
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(opts.body);
  const bodyHtml = isHtml
    ? opts.body
    : opts.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n");

  // NO outer styled wrapper div — that "max-width:560px;font-family:..." pattern
  // is a known marketing-template fingerprint. Plain <p> tags inherit the
  // recipient's default font/size, which looks like a hand-typed email.
  const html = `${bodyHtml}\n${opts.signatureHtml ?? ""}`;

  // Always supply a real text/plain alternative. Missing/empty text parts
  // are a major spam-filter penalty for cold outreach.
  const bodyText = isHtml ? htmlToText(opts.body) : opts.body;
  const sigText  = opts.signatureText ?? (opts.signatureHtml ? htmlToText(opts.signatureHtml) : "");
  const text     = sigText ? `${bodyText.trim()}\n${sigText}` : bodyText;

  const mailOpts: nodemailer.SendMailOptions = {
    from,
    to:       opts.to,
    subject:  opts.subject,
    html,
    text,
    replyTo:  opts.replyTo,
  };

  // Compose the raw RFC-822 bytes locally — used for both SMTP and IMAP-APPEND
  // so the Sent folder has byte-identical content to what the recipient got.
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const composed = await composer.sendMail(mailOpts);
  const rawBytes = composed.message as Buffer;

  // Real SMTP send
  const info = await getTransporter().sendMail(mailOpts);

  // Fire-and-forget IMAP-APPEND so the email shows up in Namecheap PE webmail.
  // Failure here NEVER blocks the SMTP send.
  appendRawToImapSent(rawBytes).catch((err) => {
    console.warn("[email] IMAP append to Sent failed:", err?.message ?? err);
  });

  return {
    messageId: info.messageId ?? "",
    accepted:  (info.accepted as string[]) ?? [],
    rejected:  (info.rejected as string[]) ?? [],
  };
}

// ── IMAP-APPEND: save raw RFC-822 bytes to the Sent folder ──
// Uses the same mailbox credentials as SMTP. Configurable folder name
// (Namecheap PE uses "Sent", some servers use "Sent Items" or "[Gmail]/Sent Mail").
export async function appendRawToImapSent(rawBytes: Buffer): Promise<void> {
  const host = process.env.IMAP_HOST ?? "mail.privateemail.com";
  const port = Number(process.env.IMAP_PORT ?? 993);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;
  const sentFolder = process.env.SENT_FOLDER ?? "Sent";

  if (!user || !pass) {
    console.warn("[email] IMAP append skipped — no SMTP/IMAP creds");
    return;
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.append(sentFolder, rawBytes, ["\\Seen"]);
  } finally {
    try { await client.logout(); } catch { /* swallow */ }
  }
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
