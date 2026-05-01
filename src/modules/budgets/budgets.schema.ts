import { z } from 'zod';

const money = z.coerce.number().nonnegative().max(99_999_999);

export const upsertBudgetSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  plannedIncome: money,
  savingsTarget: money.default(0),
  notes: z.string().max(500).optional().nullable(),
});

export type UpsertBudgetInput = z.infer<typeof upsertBudgetSchema>;
