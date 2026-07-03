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
    // FK sırası (çocuk → ebeveyn):
    // OtpDismissal → OTPLog → Device → RoutingRule → GroupMember → Group → User → Project.
    await prisma.otpDismissal.deleteMany();
    await prisma.oTPLog.deleteMany();
    await prisma.device.deleteMany();
    await prisma.routingRule.deleteMany();
    await prisma.groupMember.deleteMany();
    await prisma.group.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    // Rate limit sayaçlarını sıfırla → testler birbirini etkilemesin.
    resetRateLimiters();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}
