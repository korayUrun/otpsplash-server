import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '@config/env';

/**
 * PrismaClient singleton.
 * globalThis pattern ile hot-reload (nodemon/ts-node) sırasında
 * birden fazla bağlantı havuzu açılmasını engeller.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction() ? ['error'] : ['error', 'warn'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
