import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signRefreshToken, signToken, verifyRefreshToken } from '../../utils/jwt';
import { toNumber } from '../../utils/money';
import {
  badRequest,
  conflict,
  HttpError,
  unauthorized,
} from '../../utils/errors';
import {
  emailPasswordReset,
  emailVerificationCode,
  sendEmail,
} from '../../utils/email';
import type { LoginInput, RegisterInput } from './auth.schema';

export type CodeKind = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

const googleClient = new OAuth2Client();

function issueAuthTokens(user: { id: string; email: string }) {
  return {
    token: signToken({ sub: user.id, email: user.email }),
    refreshToken: signRefreshToken({ sub: user.id, email: user.email }),
  };
}

const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  EU: 'EUR',
  JP: 'JPY',
  GB: 'GBP',
  CN: 'CNY',
  AU: 'AUD',
  CA: 'CAD',
  CH: 'CHF',
};

const CODE_TTL_MINUTES: Record<CodeKind, number> = {
  EMAIL_VERIFY: 30,
  PASSWORD_RESET: 15,
};

const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  countryCode: string;
  currency: string;
  paySchedule: string;
  plan: string;
  emailVerified: boolean;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  countryCode: u.countryCode,
  currency: u.currency,
  paySchedule: u.paySchedule,
  plan: u.plan,
  emailVerified: u.emailVerified,
});

function generateCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function googleAudiences() {
  return [
    env.GOOGLE_OAUTH_WEB_CLIENT_ID,
    env.GOOGLE_OAUTH_IOS_CLIENT_ID,
  ].filter((id): id is string => Boolean(id));
}

async function verifyGoogleIdToken(idToken: string) {
  const audiences = googleAudiences();
  if (audiences.length === 0) {
    throw new HttpError(503, 'Google sign-in is not configured on the backend.');
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: audiences,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw unauthorized('Google token is missing account details.');
    }
    if (!payload.email_verified) {
      throw unauthorized('Google email is not verified.');
    }
    return {
      providerSub: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name || payload.given_name || payload.email.split('@')[0],
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw unauthorized('Invalid Google sign-in token.');
  }
}

// Issue (and persist) a fresh one-time code, replacing any active one,
// and email it via Resend. Returns `delivered:false` when the email
// couldn't actually be sent (e.g. Resend free-tier sandbox rejecting any
// recipient that isn't the account owner). Callers can use this signal
// to gracefully short-circuit verification flows in development.
async function issueCode(
  userId: string,
  email: string,
  kind: CodeKind,
): Promise<{ code: string; delivered: boolean }> {
  // Invalidate any outstanding codes of this kind so only the latest works.
  await prisma.oneTimeCode.updateMany({
    where: { userId, kind, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES[kind] * 60_000);
  await prisma.oneTimeCode.create({
    data: { userId, kind, code, expiresAt },
  });

  // Console fallback — always log so dev can recover if email send fails.
  console.log(
    `[auth] ${kind} code for ${email}: ${code}  (expires in ${CODE_TTL_MINUTES[kind]} min)`,
  );

  const tpl = kind === 'EMAIL_VERIFY'
    ? emailVerificationCode(code)
    : emailPasswordReset(code);
  const delivered = await sendEmail({ to: email, ...tpl });

  return { code, delivered };
}

async function consumeCode(
  userId: string,
  kind: CodeKind,
  submitted: string,
): Promise<void> {
  const trimmed = submitted.trim();
  const record = await prisma.oneTimeCode.findFirst({
    where: { userId, kind, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw badRequest('Code not found. Request a new one.');
  if (record.expiresAt.getTime() < Date.now()) {
    throw badRequest('Code expired. Request a new one.');
  }
  if (record.code !== trimmed) throw badRequest('Incorrect code.');

  await prisma.oneTimeCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
}

// ── Auth ─────────────────────────────────────────────────────────────

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('Email already in use');

  const passwordHash = await hashPassword(input.password);
  let user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      countryCode: input.countryCode,
      currency: COUNTRY_CURRENCY[input.countryCode] ?? 'USD',
      paySchedule: input.paySchedule,
    },
  });

  const { delivered } = await issueCode(user.id, user.email, 'EMAIL_VERIFY');

  // Dev convenience: when the Resend sandbox refuses delivery (any address
  // that isn't the account owner), the user would otherwise be stuck on the
  // verify screen forever. Auto-verify them so testing isn't blocked.
  // In production this branch never fires — emails must actually be sent.
  if (!delivered && env.NODE_ENV !== 'production') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    console.log(
      `[auth] auto-verified ${user.email} (Resend sandbox can't deliver to this address)`,
    );
  }

  return { ...issueAuthTokens(user), user: publicUser(user) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid credentials');

  return { ...issueAuthTokens(user), user: publicUser(user) };
}

export async function loginWithGoogle(idToken: string) {
  const google = await verifyGoogleIdToken(idToken);

  const providerUser = await prisma.user.findFirst({
    where: { provider: 'google', providerSub: google.providerSub },
  });

  if (providerUser) {
    return { ...issueAuthTokens(providerUser), user: publicUser(providerUser) };
  }

  const existingEmailUser = await prisma.user.findUnique({
    where: { email: google.email },
  });

  if (existingEmailUser) {
    const user = await prisma.user.update({
      where: { id: existingEmailUser.id },
      data: {
        provider: 'google',
        providerSub: google.providerSub,
        emailVerified: true,
        emailVerifiedAt: existingEmailUser.emailVerifiedAt ?? new Date(),
      },
    });
    return { ...issueAuthTokens(user), user: publicUser(user) };
  }

  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const user = await prisma.user.create({
    data: {
      email: google.email,
      name: google.name,
      passwordHash,
      provider: 'google',
      providerSub: google.providerSub,
      countryCode: 'US',
      currency: 'USD',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  return { ...issueAuthTokens(user), user: publicUser(user) };
}

export async function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw unauthorized();
  return { ...issueAuthTokens(user), user: publicUser(user) };
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  return publicUser(user);
}

// ── Email verification ───────────────────────────────────────────────

export async function verifyEmail(userId: string, code: string) {
  await consumeCode(userId, 'EMAIL_VERIFY', code);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true, emailVerifiedAt: new Date() },
  });
  return { ok: true as const, message: 'Email verified.', user: publicUser(user) };
}

export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Don't leak whether the email is registered. Pretend success either way.
  if (!user) return { ok: true as const, message: 'If that email exists, a new code is on the way.' };
  if (user.emailVerified) {
    return { ok: true as const, message: 'Email already verified.' };
  }
  await issueCode(user.id, user.email, 'EMAIL_VERIFY');
  return { ok: true as const, message: 'A new verification code has been sent.' };
}

// ── Password reset ───────────────────────────────────────────────────

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always succeed silently to avoid email enumeration.
  if (user) {
    await issueCode(user.id, user.email, 'PASSWORD_RESET');
  }
  return {
    ok: true as const,
    message: 'If an account exists for that email, a reset code has been sent.',
  };
}

// Validates a PASSWORD_RESET code against the user's latest active code
// without consuming it. Throws on missing/expired/incorrect — same shape
// as consumeCode so the mobile flow can show consistent errors.
export async function verifyResetCode(email: string, code: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Mirror resetPassword's vague error to avoid email enumeration.
  if (!user) throw badRequest('Incorrect code.');

  const trimmed = code.trim();
  const record = await prisma.oneTimeCode.findFirst({
    where: { userId: user.id, kind: 'PASSWORD_RESET', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw badRequest('Code not found. Request a new one.');
  if (record.expiresAt.getTime() < Date.now()) {
    throw badRequest('Code expired. Request a new one.');
  }
  if (record.code !== trimmed) throw badRequest('Incorrect code.');

  return { ok: true as const };
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw badRequest('Invalid code or email.');
  await consumeCode(user.id, 'PASSWORD_RESET', code);
  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
  // Sign the user in directly so the app skips the login screen.
  return {
    ok: true as const,
    message: 'Password reset.',
    ...issueAuthTokens(updated),
    user: publicUser(updated),
  };
}

// ── Change password (authenticated) ──────────────────────────────────

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw badRequest('Current password is incorrect.');

  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  // Issue fresh tokens so the client doesn't keep a stale one.
  return {
    ok: true as const,
    message: 'Password updated.',
    ...issueAuthTokens(updated),
    user: publicUser(updated),
  };
}

// ── Delete account ───────────────────────────────────────────────────

export async function deleteAccount(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw badRequest('Incorrect password.');

  // Every related table has onDelete: Cascade pointing back to User, so
  // dropping the user wipes their entire footprint in one statement.
  await prisma.user.delete({ where: { id: userId } });
  return { ok: true as const, message: 'Account deleted.' };
}

// ── Export data ──────────────────────────────────────────────────────

const decimalToNumber = (d: Prisma.Decimal | null | undefined) => toNumber(d ?? new Prisma.Decimal(0));

export async function exportData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, countryCode: true, currency: true,
      paySchedule: true, plan: true, planSince: true, emailVerified: true,
      emailVerifiedAt: true, createdAt: true, updatedAt: true,
    },
  });
  if (!user) throw unauthorized();

  const [
    budgets, incomes, expenses, savings, debts, recurring,
    categories, conversations, notifications,
  ] = await Promise.all([
    prisma.budgetMonth.findMany({ where: { userId } }),
    prisma.income.findMany({ where: { userId } }),
    prisma.expense.findMany({
      where: { userId },
      include: { category: { select: { name: true, icon: true, color: true } } },
    }),
    prisma.savingsGoal.findMany({ where: { userId } }),
    prisma.debt.findMany({ where: { userId } }),
    prisma.recurringBill.findMany({
      where: { userId },
      include: { category: { select: { name: true } } },
    }),
    prisma.userCategory.findMany({
      where: { userId },
      include: { category: true },
    }),
    prisma.conversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, createdAt: true },
        },
      },
    }),
    prisma.notification.findMany({ where: { userId } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schema: 'paycheck.export.v1',
    user,
    budgets: budgets.map((b) => ({
      ...b,
      plannedIncome: decimalToNumber(b.plannedIncome),
      savingsTarget: decimalToNumber(b.savingsTarget),
    })),
    incomes: incomes.map((i) => ({ ...i, amount: decimalToNumber(i.amount) })),
    expenses: expenses.map((e) => ({ ...e, amount: decimalToNumber(e.amount) })),
    savingsGoals: savings.map((s) => ({
      ...s,
      targetAmount: decimalToNumber(s.targetAmount),
      savedAmount: decimalToNumber(s.savedAmount),
    })),
    debts: debts.map((d) => ({
      ...d,
      totalAmount: decimalToNumber(d.totalAmount),
      remainingAmount: decimalToNumber(d.remainingAmount),
      interestRate: Number(d.interestRate),
      minimumPayment: decimalToNumber(d.minimumPayment),
    })),
    recurringBills: recurring.map((r) => ({ ...r, amount: decimalToNumber(r.amount) })),
    customCategories: categories.map((c) => c.category),
    conversations,
    notifications,
  };
}

// Silence unused-env warning when this gets imported without using env.
void env;
