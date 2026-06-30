/**
 * Cleanup cron job birim testi.
 * node-cron ve prisma mock'lanır — gerçek zamanlayıcı/DB yok.
 * Doğrulanan davranış (CLAUDE.md FAZ 4): job hatası uygulamayı durdurmaz, yalnızca loglanır.
 */

const deleteManyMock = jest.fn();
const scheduleMock = jest.fn();

jest.mock('@config/prisma', () => ({
  prisma: {
    oTPLog: { deleteMany: deleteManyMock },
  },
}));

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: scheduleMock },
}));

import { logger } from '@infrastructure/logger';
import { runCleanup, startCleanupJob } from '@jobs/cleanup.job';

/** Mikrotask kuyruğunu boşaltır (then/catch zincirinin tamamlanması için). */
const flushPromises = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('cleanup.job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('runCleanup', () => {
    it('süresi geçmiş kayıtları siler ve sayıyı döner', async () => {
      deleteManyMock.mockResolvedValue({ count: 7 });

      await expect(runCleanup()).resolves.toBe(7);

      const where = deleteManyMock.mock.calls[0]?.[0] as {
        where: { expiresAt: { lt: Date } };
      };
      expect(where.where.expiresAt.lt).toBeInstanceOf(Date);
    });
  });

  describe('startCleanupJob', () => {
    it('cron.schedule ile UTC 02:00 zamanlar ve task döner', () => {
      const fakeTask = { stop: jest.fn() };
      scheduleMock.mockReturnValue(fakeTask);

      const task = startCleanupJob();

      expect(scheduleMock).toHaveBeenCalledTimes(1);
      const [expression, , options] = scheduleMock.mock.calls[0] as [
        string,
        unknown,
        { timezone: string },
      ];
      expect(expression).toBe('0 2 * * *');
      expect(options.timezone).toBe('UTC');
      expect(task).toBe(fakeTask);
    });

    it('zamanlanan callback başarıyla çalışınca silinen sayıyı info loglar', async () => {
      deleteManyMock.mockResolvedValue({ count: 3 });
      scheduleMock.mockReturnValue({ stop: jest.fn() });

      startCleanupJob();
      const scheduledCb = scheduleMock.mock.calls[0]?.[1] as () => void;
      scheduledCb();
      await flushPromises();

      expect(logger.info).toHaveBeenCalledWith(
        { deleted: 3 },
        expect.any(String),
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        expect.stringContaining('başarısız'),
      );
    });

    it('job hata fırlatırsa yakalanır ve error loglanır (uygulama devam eder)', async () => {
      deleteManyMock.mockRejectedValue(new Error('DB down'));
      scheduleMock.mockReturnValue({ stop: jest.fn() });

      startCleanupJob();
      const scheduledCb = scheduleMock.mock.calls[0]?.[1] as () => void;
      // Fırlatmamalı — hata zincir içinde yutulur.
      expect(() => scheduledCb()).not.toThrow();
      await flushPromises();

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
