import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { upsertBudgetSchema } from './budgets.schema';
import * as service from './budgets.service';
import { assertWithinHistoryWindow, getUserPlan } from '../billing/enforce';
import { PLAN_LIMITS } from '../billing/plans';

const router = Router();
router.use(requireAuth);

const summaryQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

router.get(
  '/summary',
  validate(summaryQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { year, month } = req.query as unknown as z.infer<typeof summaryQuery>;
    const plan = await getUserPlan(req.userId!);
    assertWithinHistoryWindow(plan, year, month);
    res.json(await service.getBudgetSummary(req.userId!, year, month));
  }),
);

const historyQuery = z.object({
  months: z.coerce.number().int().min(1).max(60).optional(),
});

router.get(
  '/history',
  validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { months } = req.query as unknown as z.infer<typeof historyQuery>;
    const plan = await getUserPlan(req.userId!);
    // Clamp to whichever is smaller: requested count or plan's history window.
    // Always at least 1 (current month).
    const planLimit = PLAN_LIMITS[plan].historyMonths;
    const count = Math.max(1, Math.min(months ?? planLimit, planLimit));
    res.json(await service.getBudgetHistory(req.userId!, count));
  }),
);

router.put(
  '/',
  validate(upsertBudgetSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.upsertBudget(req.userId!, req.body));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await service.deleteBudget(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

export default router;
