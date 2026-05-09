import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { prisma } from '../../config/prisma';
import { countryCodeSchema } from '../auth/auth.schema';

const router = Router();

const countryCurrency: Record<string, string> = {
  US: 'USD',
  EU: 'EUR',
  JP: 'JPY',
  GB: 'GBP',
  CN: 'CNY',
  AU: 'AUD',
  CA: 'CAD',
  CH: 'CHF',
};

const updateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  countryCode: countryCodeSchema.optional(),
  paySchedule: z.enum(['WEEKLY', 'BIWEEKLY', 'TWICE_MONTHLY', 'MONTHLY']).optional(),
  currency: z.enum(['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF']).optional(),
});

router.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    const data = {
      ...req.body,
      ...(req.body.countryCode ? { currency: countryCurrency[req.body.countryCode] } : {}),
    };
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        countryCode: true,
        currency: true,
        paySchedule: true,
        plan: true,
      },
    });
    res.json(user);
  }),
);

export default router;
