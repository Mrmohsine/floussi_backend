import { PrismaClient } from '@prisma/client';
import { env } from './env';

const prismaClientSingleton = () =>
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

declare global {
  // eslint-disable-next-line no-var
  var __paycheckPrisma: ReturnType<typeof prismaClientSingleton> | undefined;
}

export const prisma = globalThis.__paycheckPrisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalThis.__paycheckPrisma = prisma;
}
