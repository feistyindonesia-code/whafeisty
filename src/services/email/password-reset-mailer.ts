import nodemailer from 'nodemailer';

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured to send password reset emails`);
  return value;
}

export async function sendPasswordResetEmail(to: string, code: string) {
  const host = requiredEnv('SMTP_HOST');
  const from = requiredEnv('SMTP_FROM');
  const port = Number(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }
  if (process.env.NODE_ENV === 'production' && !secure) {
    throw new Error('SMTP_SECURE=true is required in production');
  }

  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  if ((user && !password) || (!user && password)) {
    throw new Error('SMTP_USER and SMTP_PASSWORD must both be configured');
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: password } : undefined,
  });

  try {
    await transport.sendMail({
      from,
      to,
      subject: 'Your Whafeisty password reset code',
      text: `Your password reset code is ${code}. It expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<p>Your Whafeisty password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
    });
  } finally {
    transport.close();
  }
}

export function isPasswordResetEmailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}
