import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { prisma } from '../../config/prisma';

const router = Router();

const updateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  paySchedule: z.enum(['WEEKLY', 'BIWEEKLY', 'TWICE_MONTHLY', 'MONTHLY']).optional(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'MAD', 'CAD', 'AUD', 'JPY']).optional(),
});

router.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: req.body,
      select: { id: true, name: true, email: true, currency: true, paySchedule: true, plan: true },
    });
    res.json(user);
  }),
);

export default router;
