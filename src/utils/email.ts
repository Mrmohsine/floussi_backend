import { Resend } from 'resend';
import { env } from '../config/env';

let _client: Resend | null = null;

function client(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_client) _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

// Send via Resend when configured; otherwise log so dev still works.
// Returns true if dispatched to an external provider, false if logged-only.
export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<boolean> {
  const c = client();
  if (!c) {
    console.log(`[email:console] to=${to} subject=${subject}`);
    if (text) console.log(`[email:console] body:\n${text}`);
    return false;
  }
  try {
    const { data, error } = await c.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      console.warn(
        `[email] resend rejected to=${to}: ${error.message ?? JSON.stringify(error)}`,
      );
      return false;
    }
    console.log(`[email] sent via resend id=${data?.id ?? '?'} to=${to}`);
    return true;
  } catch (err) {
    console.warn('[email] send failed', err);
    return false;
  }
}

// Templates ────────────────────────────────────────────────────────

const wrap = (title: string, body: string) => `
  <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
              max-width:480px;margin:32px auto;padding:24px;color:#0F172A;
              border:1px solid #E5E7EB;border-radius:16px;background:#FFFFFF;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#107C41;">${title}</h1>
    ${body}
    <p style="margin-top:32px;font-size:12px;color:#94A3B8;">
      Paycheck — your money, your way.
    </p>
  </div>`;

export function emailVerificationCode(code: string) {
  const subject = 'Your Paycheck verification code';
  const html = wrap('Verify your email',
    `<p>Use this 6-digit code to confirm your email:</p>
     <p style="font-size:32px;font-weight:700;letter-spacing:6px;
               background:#E6F4EC;padding:16px;border-radius:12px;
               text-align:center;color:#0B5C30;">${code}</p>
     <p style="color:#5F6B7A;">This code expires in 30 minutes.</p>`);
  const text = `Your Paycheck verification code: ${code}\nExpires in 30 minutes.`;
  return { subject, html, text };
}

export function emailPasswordReset(code: string) {
  const subject = 'Your Paycheck password reset code';
  const html = wrap('Reset your password',
    `<p>Someone (hopefully you) asked to reset the password for this account.
        Enter this 6-digit code in the app:</p>
     <p style="font-size:32px;font-weight:700;letter-spacing:6px;
               background:#E6F4EC;padding:16px;border-radius:12px;
               text-align:center;color:#0B5C30;">${code}</p>
     <p style="color:#5F6B7A;">This code expires in 15 minutes. If you didn't request a reset, ignore this email — your password stays the same.</p>`);
  const text = `Your Paycheck password reset code: ${code}\nExpires in 15 minutes.\nIf you didn't request this, ignore this email.`;
  return { subject, html, text };
}
