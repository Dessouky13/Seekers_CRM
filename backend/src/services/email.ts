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
