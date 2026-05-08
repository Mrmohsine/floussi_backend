import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  appleOAuthSchema,
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  googleOAuthSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  verifyResetCodeSchema,
} from './auth.schema';
import * as service from './auth.service';
import * as oauthService from './oauth.service';

const router = Router();

router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const result = await service.register(req.body);
    res.status(201).json(result);
  }),
);

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await service.login(req.body);
    res.json(result);
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.me(req.userId!));
  }),
);

// Logout is client-side (drop the token). Stub kept for symmetry.
router.post('/logout', requireAuth, (_req, res) => res.json({ ok: true }));

// ── OAuth (Google + Apple) ────────────────────────────────────────
// Mobile signs in via the platform native sheet, then POSTs the
// resulting id_token here. We verify it against the provider's JWKS,
// find-or-create the user, and return the same { token, user } shape
// as /auth/login so the auth store treats it identically.
router.post(
  '/oauth/google',
  validate(googleOAuthSchema),
  asyncHandler(async (req, res) => {
    res.json(await oauthService.googleSignIn(req.body.idToken));
  }),
);

router.post(
  '/oauth/apple',
  validate(appleOAuthSchema),
  asyncHandler(async (req, res) => {
    res.json(await oauthService.appleSignIn(req.body.idToken, req.body.fullName ?? null));
  }),
);

// ── Email verification ────────────────────────────────────────────
router.post(
  '/verify-email',
  requireAuth,
  validate(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyEmail(req.userId!, req.body.code));
  }),
);

router.post(
  '/resend-verification',
  validate(resendVerificationSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.resendVerification(req.body.email));
  }),
);

// ── Password reset ────────────────────────────────────────────────
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.forgotPassword(req.body.email));
  }),
);

router.post(
  '/verify-reset-code',
  validate(verifyResetCodeSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyResetCode(req.body.email, req.body.code));
  }),
);

router.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await service.resetPassword(req.body.email, req.body.token, req.body.password),
    );
  }),
);

// ── Change password (authenticated) ───────────────────────────────
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await service.changePassword(
        req.userId!,
        req.body.currentPassword,
        req.body.newPassword,
      ),
    );
  }),
);

// ── Delete account ────────────────────────────────────────────────
router.delete(
  '/account',
  requireAuth,
  validate(deleteAccountSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.deleteAccount(req.userId!, req.body.password));
  }),
);

// ── Export data ───────────────────────────────────────────────────
router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await service.exportData(req.userId!);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="paycheck-export.json"',
    );
    res.json(data);
  }),
);

export default router;
