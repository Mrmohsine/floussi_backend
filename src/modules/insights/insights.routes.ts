import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { generateInsights } from './insights.service';

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

router.get(
  '/',
  validate(querySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.query as unknown as z.infer<typeof querySchema>;
    res.json(await generateInsights(req.userId!, year, month));
  }),
);

export default router;
