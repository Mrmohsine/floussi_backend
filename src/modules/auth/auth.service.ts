import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signToken } from '../../utils/jwt';
import { toNumber } from '../../utils/money';
import { badRequest, conflict, unauthorized } from '../../utils/errors';
import {
  emailPasswordReset,
  emailVerificationCode,
  sendEmail,
} from '../../utils/email';
import type { LoginInput, RegisterInput } from './auth.schema';

export type CodeKind = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

const CODE_TTL_MINUTES: Record<CodeKind, number> = {
  EMAIL_VERIFY: 30,
  PASSWORD_RESET: 15,
};

const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  currency: string;
  paySchedule: string;
  plan: string;
  emailVerified: boolean;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  currency: u.currency,
  paySchedule: u.paySchedule,
  plan: u.plan,
  emailVerified: u.emailVerified,
});

function generateCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
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

  const token = signToken({ sub: user.id, email: user.email });
  return { token, user: publicUser(user) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw unauthorized('Invalid credentials');

  const token = signToken({ sub: user.id, email: user.email });
  return { token, user: publicUser(user) };
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
  const token = signToken({ sub: updated.id, email: updated.email });
  return {
    ok: true as const,
    message: 'Password reset.',
    token,
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

  // Issue a fresh access token so the client doesn't keep a stale one.
  const token = signToken({ sub: updated.id, email: updated.email });
  return {
    ok: true as const,
    message: 'Password updated.',
    token,
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
      id: true, email: true, name: true, currency: true, paySchedule: true,
      plan: true, planSince: true, emailVerified: true, emailVerifiedAt: true,
      createdAt: true, updatedAt: true,
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
    prisma.category.findMany({ where: { userId } }),
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
    customCategories: categories,
    conversations,
    notifications,
  };
}

// Silence unused-env warning when this gets imported without using env.
void env;
