import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { prisma } from '../../config/prisma';

const router = Router();

const createCategorySchema = z.object({
  name: z.string().min(1).max(40),
  icon: z.string().min(1).max(40).default('tag'),
  color: z.string().regex(/^#?[0-9A-Fa-f]{6}$/).default('#6366F1'),
});

// List system + this user's categories, enriched with usageCount so the
// picker can surface frequently-used ones first.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const [cats, counts] = await Promise.all([
      prisma.category.findMany({
        where: { OR: [{ isSystem: true }, { userId }] },
      }),
      prisma.expense.groupBy({
        by: ['categoryId'],
        where: { userId },
        _count: { _all: true },
      }),
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const enriched = cats
      .map((c) => ({ ...c, usageCount: countMap.get(c.id) ?? 0 }))
      .sort(
        (a, b) =>
          b.usageCount - a.usageCount ||
          a.name.localeCompare(b.name),
      );
    res.json(enriched);
  }),
);

router.post(
  '/',
  requireAuth,
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const cat = await prisma.category.create({
      data: { ...req.body, userId: req.userId! },
    });
    res.status(201).json(cat);
  }),
);

export default router;
