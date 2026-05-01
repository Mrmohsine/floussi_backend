import { z } from 'zod';

const money = z.coerce.number().positive().max(99_999_999);

export const createExpenseSchema = z.object({
  amount: money,
  categoryId: z.string().min(1),
  date: z.coerce.date(),
  note: z.string().max(280).optional().nullable(),
  paymentMethod: z
    .enum(['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER'])
    .default('DEBIT_CARD'),
  type: z.enum(['FIXED_BILL', 'VARIABLE']).default('VARIABLE'),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  categoryId: z.string().optional(),
  type: z.enum(['FIXED_BILL', 'VARIABLE']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
