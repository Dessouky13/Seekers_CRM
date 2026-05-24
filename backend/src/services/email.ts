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

// Generic outreach send. body can be plain text (we'll wrap it in HTML) or HTML directly.
export async function sendOutreachEmail(opts: {
  to:       string;
  subject:  string;
  body:     string;
  fromName?: string;
  replyTo?:  string;
}): Promise<SendOutreachEmailResult> {
  const from = opts.fromName
    ? `"${opts.fromName}" <${process.env.EMAIL_FROM ?? "Team@seekersai.org"}>`
    : FROM;

  // If body doesn't look like HTML, convert newlines to <br> and wrap minimally
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(opts.body);
  const html = isHtml
    ? opts.body
    : `<div style="font-family:sans-serif;max-width:560px;line-height:1.55;color:#222">
         ${opts.body.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}
       </div>`;

  const info = await getTransporter().sendMail({
    from,
    to:       opts.to,
    subject:  opts.subject,
    html,
    text:     isHtml ? undefined : opts.body,
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
