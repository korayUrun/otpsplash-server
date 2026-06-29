import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { PrismaOtpRepository } from '@modules/otp/otp.repository';

/** Her gün UTC 02:00. */
const CLEANUP_SCHEDULE = '0 2 * * *';

/** DB silme mantığı repository'de — job yalnızca zamanlama/loglama yapar (SRP). */
const otpRepository = new PrismaOtpRepository(prisma);

/**
 * Süresi geçmiş OTP kayıtlarını siler.
 * Hata uygulamayı durdurmamalı — yakalanır ve yalnızca loglanır (CLAUDE.md FAZ 4).
 */
export async function runCleanup(): Promise<number> {
  return otpRepository.deleteExpired();
}

/**
 * Cleanup cron job'unu başlatır.
 * @returns Durdurulabilir ScheduledTask (graceful shutdown'da stop edilir).
 */
export function startCleanupJob(): ScheduledTask {
  const task = cron.schedule(
    CLEANUP_SCHEDULE,
    () => {
      runCleanup()
        .then((count) => {
          logger.info({ deleted: count }, 'cleanup: süresi geçmiş OTP silindi');
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'cleanup: job başarısız (uygulama devam ediyor)');
        });
    },
    { timezone: 'UTC' },
  );

  logger.info({ schedule: CLEANUP_SCHEDULE }, 'cleanup job zamanlandı');
  return task;
}
