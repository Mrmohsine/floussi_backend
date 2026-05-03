import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createExpenseSchema,
  listExpensesQuery,
  updateExpenseSchema,
} from './expenses.schema';
import * as service from './expenses.service';
import { assertCanCreateExpense } from '../billing/enforce';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  validate(listExpensesQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.listExpenses(req.userId!, req.query as any));
  }),
);

router.post(
  '/',
  validate(createExpenseSchema),
  asyncHandler(async (req, res) => {
    await assertCanCreateExpense(req.userId!);
    res.status(201).json(await service.createExpense(req.userId!, req.body));
  }),
);

router.patch(
  '/:id',
  validate(updateExpenseSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.updateExpense(req.userId!, req.params.id, req.body));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await service.deleteExpense(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

export default router;
