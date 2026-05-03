import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { generateSmartNotifications } from './notifications.service';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

router.get(
  '/',
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const query = req.query as unknown as z.infer<typeof querySchema>;
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;
    res.json(await generateSmartNotifications(req.userId!, year, month));
  }),
);

export default router;
