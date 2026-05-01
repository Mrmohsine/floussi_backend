import { Prisma } from '@prisma/client';

// Helpers to keep money arithmetic precise on the backend.
// Always pass strings to Prisma.Decimal to avoid float drift.

export const toDecimal = (n: number | string) =>
  new Prisma.Decimal(typeof n === 'number' ? n.toFixed(2) : n);

export const sum = (values: Prisma.Decimal[]) =>
  values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0));

export const toNumber = (d: Prisma.Decimal | null | undefined) =>
  d ? Number(d.toFixed(2)) : 0;
