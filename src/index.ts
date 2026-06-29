import type { Server as HttpServer } from 'node:http';
import type { ScheduledTask } from 'node-cron';
import { createApp } from './app';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { startCleanupJob } from '@jobs/cleanup.job';

/** Graceful shutdown'da kapatılacak kaynaklar. */
interface Runtime {
  httpServer: HttpServer;
  cleanupTask: ScheduledTask;
}

let runtime: Runtime | undefined;
let shuttingDown = false;

async function bootstrap(): Promise<void> {
  // 1) DB bağlantısı — başarısızsa fail-fast.
  await prisma.$connect();
  logger.info('veritabanı bağlantısı kuruldu');

  // 2) HTTP + Socket.IO sunucusunu başlat.
  const { httpServer } = createApp();

  await new Promise<void>((resolve) => {
    httpServer.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'sunucu dinlemede');
      resolve();
    });
  });

  // 3) Cron job'larını başlat.
  const cleanupTask = startCleanupJob();

  runtime = { httpServer, cleanupTask };
}

/**
 * Kaynakları sırayla kapatır: cron → HTTP → Prisma.
 * İkinci sinyal gelirse tekrar girmez (idempotent).
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown başladı');

  try {
    if (runtime) {
      runtime.cleanupTask.stop();
      await new Promise<void>((resolve, reject) => {
        runtime!.httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP sunucusu kapatıldı');
    }
    await prisma.$disconnect();
    logger.info('veritabanı bağlantısı kapatıldı');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'shutdown sırasında hata');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandledRejection — shutdown');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaughtException — shutdown');
  void shutdown('uncaughtException');
});

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'bootstrap başarısız');
  process.exit(1);
});
