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

export const verifyEmailSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email().toLowerCase(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

// `token` here is the 6-digit OTP from the email. Named `token` to match the
// mobile API surface.
export const resetPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  token: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  password: z.string().min(8).max(72),
});

// Same payload as resetPassword without the password — server checks the
// code is valid (without consuming it) so the client can gate UI on it.
export const verifyResetCodeSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
