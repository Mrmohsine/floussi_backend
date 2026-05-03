import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { toDecimal, toNumber } from '../../utils/money';
import { badRequest, notFound } from '../../utils/errors';
import { assertCanCreateRecurring } from '../billing/enforce';

const router = Router();
router.use(requireAuth);

const money = z.coerce.number().positive().max(99_999_999);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  categoryId: z.string().min(1),
  amount: money,
  frequency: z.enum(['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'YEARLY']).default('MONTHLY'),
  dueDay: z.coerce.number().int().min(1).max(31),
  paymentMethod: z
    .enum(['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER'])
    .default('DEBIT_CARD'),
  active: z.boolean().default(true),
  note: z.string().max(280).optional().nullable(),
});

const updateSchema = createSchema.partial();

const serialize = (b: any) => ({ ...b, amount: toNumber(b.amount) });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const bills = await prisma.recurringBill.findMany({
      where: { userId: req.userId! },
      include: { category: true },
      orderBy: [{ active: 'desc' }, { dueDay: 'asc' }],
    });
    res.json(bills.map(serialize));
  }),
);

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    await assertCanCreateRecurring(req.userId!);
    const cat = await prisma.category.findFirst({
      where: {
        id: req.body.categoryId,
        OR: [{ isSystem: true }, { userId: req.userId! }],
      },
    });
    if (!cat) throw badRequest('Invalid category');
    const b = await prisma.recurringBill.create({
      data: {
        ...req.body,
        userId: req.userId!,
        amount: toDecimal(req.body.amount),
      },
      include: { category: true },
    });
    res.status(201).json(serialize(b));
  }),
);

router.patch(
  '/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringBill.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    const b = await prisma.recurringBill.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        amount: req.body.amount !== undefined ? toDecimal(req.body.amount) : undefined,
      },
      include: { category: true },
    });
    res.json(serialize(b));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.recurringBill.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!existing) throw notFound();
    await prisma.recurringBill.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

export default router;
