import { prisma } from '../../config/prisma';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signToken } from '../../utils/jwt';
import { conflict, unauthorized } from '../../utils/errors';
import type { LoginInput, RegisterInput } from './auth.schema';

const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  currency: string;
  paySchedule: string;
  plan: string;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  currency: u.currency,
  paySchedule: u.paySchedule,
  plan: u.plan,
});

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict('Email already in use');

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      paySchedule: input.paySchedule,
    },
  });

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
