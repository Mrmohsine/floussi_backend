import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(72),
  paySchedule: z
    .enum(['WEEKLY', 'BIWEEKLY', 'TWICE_MONTHLY', 'MONTHLY'])
    .default('BIWEEKLY'),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
