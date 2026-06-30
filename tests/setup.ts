import { sep } from 'node:path';
import { prisma } from '@config/prisma';
import { resetRateLimiters } from '@middleware/rateLimiter';

/**
 * Yalnızca integration testleri DB'ye dokunur. Unit testler (token/password)
 * DB gerektirmemeli; bu yüzden temizlik kancaları sadece integration yolunda kurulur.
 */
const testPath = expect.getState().testPath ?? '';
const isIntegration = testPath.includes(`${sep}integration${sep}`);

if (isIntegration) {
  beforeEach(async () => {
    // FK sırası: OTPLog → Device → User → Project.
    await prisma.oTPLog.deleteMany();
    await prisma.device.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    // Rate limit sayaçlarını sıfırla → testler birbirini etkilemesin.
    resetRateLimiters();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}
