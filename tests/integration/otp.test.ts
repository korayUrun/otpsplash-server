import request from 'supertest';
import { Role, RoutingTarget, Source, type ServiceRegistry } from '@prisma/client';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';
import { tokenService } from '@modules/auth/token.service';
import { createApp } from '../../src/app';
import {
  createTestDevice,
  createTestOtpLog,
  createTestProject,
  createTestRoutingRule,
  createTestService,
  createTestUser,
} from '../helpers/fixtures';
import {
  getDeveloperToken,
  getDeviceSecret,
  getReceiverToken,
} from '../helpers/auth.helper';

const { app, io } = createApp();
const encryptor = new AesGcmOtpEncryptor();

/** Device Secret başlığı (CLAUDE.md API kontratı: X-Device-Secret). */
const SECRET_HEADER = 'X-Device-Secret';

afterAll(() => {
  io.close();
});

/** Aynı projede receiver + developer (token'lı) kurar — sharing/history senaryoları için. */
async function projectWithReceiverAndDeveloper(): Promise<{
  projectId: string;
  receiver: { id: string; token: string };
  developer: { id: string; token: string };
}> {
  const project = await createTestProject();
  const { user: receiver } = await createTestUser({
    projectId: project.id,
    role: Role.RECEIVER,
  });
  const { user: developer } = await createTestUser({
    projectId: project.id,
    role: Role.DEVELOPER,
  });
  const sign = (u: typeof receiver): string =>
    tokenService.generateAccessToken({
      sub: u.id,
      email: u.email,
      role: u.role,
      projectId: u.projectId,
    });
  return {
    projectId: project.id,
    receiver: { id: receiver.id, token: sign(receiver) },
    developer: { id: developer.id, token: sign(developer) },
  };
}

/**
 * Bir koşul sağlanana kadar kısa aralıklarla bekler.
 * Kova kayıtları (recordUnmatched) fire-and-forget yazıldığından, HTTP yanıtı döndükten
 * sonra satırın belirmesi bir tık gecikebilir — bu yardımcı yarışı deterministik kılar.
 */
async function waitFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: koşul zaman aşımına uğradı');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Bir projede senderPattern'i `senderRaw`'ı tanıyan aktif servis kurar. */
function createMatchingService(
  projectId: string,
  senderRaw: string,
): Promise<ServiceRegistry> {
  return createTestService({
    projectId,
    name: 'Binance',
    senderPattern: `^${senderRaw}$`,
  });
}

describe('POST /api/otp', () => {
  it('200 — geçerli X-Device-Secret + code + senderRaw', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: '847291', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toEqual(expect.any(String));
    // Eşleşen servis/kural yok → kimseye gitmez.
    expect(res.body.data.deliveredTo).toBe(0);
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('401 — X-Device-Secret yok (DEVICE_SECRET_INVALID)', async () => {
    const res = await request(app)
      .post('/api/otp')
      .send({ code: '847291', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('401 — geçersiz X-Device-Secret (DEVICE_SECRET_INVALID)', async () => {
    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, 'deadbeef'.repeat(8))
      .send({ code: '847291', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('401 — revoke edilmiş cihaz (DEVICE_REVOKED)', async () => {
    const { deviceSecret } = await getDeviceSecret({ isRevoked: true });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: '847291', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_REVOKED');
  });

  it('401 — Authorization: Bearer artık işe yaramaz (eski davranış kaldırıldı)', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .post('/api/otp')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: '847291', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('400 — senderRaw eksik (artık zorunlu — VALIDATION_ERROR)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: '847291', source: Source.ANDROID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — code eksik (artık zorunlu — VALIDATION_ERROR)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — code 6 haneli rakam değil (VALIDATION_ERROR)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: '12ab', source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — smsText artık kabul edilmiyor (code yok → VALIDATION_ERROR)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    // Eski body şekli: yalnızca smsText. code/senderRaw eksik olduğundan reddedilir.
    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DB`de kod şifreli saklanır ve doğru cihaza (deviceId) bağlanır', async () => {
    const { deviceSecret, project, device } = await getDeviceSecret();
    const plain = '847291';

    await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: plain, source: Source.ANDROID, senderRaw: 'TESTSENDER' });

    const stored = await prisma.oTPLog.findFirst({
      where: { projectId: project.id },
    });

    expect(stored).not.toBeNull();
    expect(stored?.encryptedCode).not.toContain(plain);
    // base64(iv):base64(authTag):base64(ciphertext) → 3 bileşen, çözülünce orijinal.
    expect(stored?.encryptedCode.split(CONSTANTS.OTP.SEPARATOR)).toHaveLength(3);
    expect(encryptor.decrypt(stored!.encryptedCode)).toBe(plain);
    // Kaynak izleme: kayıt doğru cihaza işaret eder.
    expect(stored?.deviceId).toBe(device.id);
  });

  it('429 — rate limit aşılınca', async () => {
    const limit = CONSTANTS.RATE_LIMIT.OTP_MAX;
    let lastStatus = 0;

    // Boş gövde + secret yok → 401; ama her istek rate limiter'da sayılır (auth'tan önce).
    for (let i = 0; i < limit + 1; i++) {
      const res = await request(app).post('/api/otp').send({});
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('POST /api/otp — servis çözümleme + routing (FAZ 8)', () => {
  it('tanınan senderRaw → serviceId çözülür ve hedef developer\'a iletilir (deliveredTo=1)', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    const service = await createMatchingService(ctx.project.id, 'BINANCE');
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: developer.id,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, senderRaw: 'BINANCE' });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(1);

    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored?.serviceId).toBe(service.id);
  });

  it('serviceHint yedek sinyali → keywordPattern ile çözülür', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    const service = await createTestService({
      projectId: ctx.project.id,
      name: 'Garanti',
      keywordPattern: 'garanti',
    });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: developer.id,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({
        code: '123456',
        source: Source.ANDROID,
        senderRaw: '+905551112233', // gönderici tanınmaz
        serviceHint: 'garanti girişiniz', // yedek sinyal eşleşir
      });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(1);
    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored?.serviceId).toBe(service.id);
  });

  it('hedeflenmeyen developer bildirim almaz — deliveredTo yalnızca kuraldaki hedefi sayar', async () => {
    const ctx = await getDeviceSecret();
    const { user: targeted } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    // Kurala dahil OLMAYAN ikinci developer — bildirim almamalı.
    await createTestUser({ projectId: ctx.project.id, role: Role.DEVELOPER });
    const service = await createMatchingService(ctx.project.id, 'BINANCE');
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: targeted.id,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, senderRaw: 'BINANCE' });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(1);
  });

  it('tanınmayan senderRaw → serviceId null, kimseye gitmez, kova satırı oluşur', async () => {
    const ctx = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, senderRaw: 'UNKNOWNCO' });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(0);

    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored?.serviceId).toBeNull();

    // Kova satırı fire-and-forget yazılır → belirmesini bekle.
    const bucket = await waitFor(() =>
      prisma.serviceRegistry.findFirst({
        where: {
          projectId: ctx.project.id,
          isActive: false,
          lastSeenSender: 'UNKNOWNCO',
        },
      }),
    );
    expect(bucket.name).toBeNull();
    expect(bucket.unmatchedCount).toBe(1);
  });

  it('aynı tanınmayan senderRaw tekrar → yeni satır açılmaz, sayaç artar', async () => {
    const ctx = await getDeviceSecret();

    await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '111111', source: Source.ANDROID, senderRaw: 'REPEATCO' });

    // İlk kova kaydının yazılmasını bekle (yarışı önler — ikinci POST mevcut satırı bulmalı).
    await waitFor(() =>
      prisma.serviceRegistry.findFirst({
        where: { projectId: ctx.project.id, lastSeenSender: 'REPEATCO' },
      }),
    );

    await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '222222', source: Source.ANDROID, senderRaw: 'REPEATCO' });

    // Sayaç 2'ye çıkana kadar bekle.
    const bucket = await waitFor(async () => {
      const row = await prisma.serviceRegistry.findFirst({
        where: { projectId: ctx.project.id, lastSeenSender: 'REPEATCO' },
      });
      return row && row.unmatchedCount >= 2 ? row : null;
    });
    expect(bucket.unmatchedCount).toBe(2);

    // Tek satır olmalı — tekrar eden sinyal yeni satır açmaz.
    const count = await prisma.serviceRegistry.count({
      where: { projectId: ctx.project.id, lastSeenSender: 'REPEATCO' },
    });
    expect(count).toBe(1);
  });

  it('aktif kural yoksa (servis çözülse bile) iletilmez (deliveredTo=0)', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    const service = await createMatchingService(ctx.project.id, 'BINANCE');
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: developer.id,
      isActive: false,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, senderRaw: 'BINANCE' });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(0);
    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored?.serviceId).toBe(service.id);
  });
});

describe('GET /api/otp/history', () => {
  it('200 — DEVELOPER kendi projesinin geçmişini görür', async () => {
    const { accessToken, project } = await getDeveloperToken();
    await createTestOtpLog({ projectId: project.id, code: '111111' });
    await createTestOtpLog({ projectId: project.id, code: '222222' });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    // Kodlar şifresi çözülmüş olarak döner.
    const codes = (res.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['111111', '222222']));
    expect(res.body.pagination.total).toBe(2);
  });

  it('401 — token yok', async () => {
    const res = await request(app).get('/api/otp/history');
    expect(res.status).toBe(401);
  });

  it('süresi dolmuş OTP geçmişte görünmez', async () => {
    const { accessToken, project } = await getDeveloperToken();
    await createTestOtpLog({ projectId: project.id, code: '111111' });
    await createTestOtpLog({
      projectId: project.id,
      code: '999999',
      expiresAt: new Date(Date.now() - 1000), // süresi geçmiş
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
  });

  it('proje izolasyonu — başka projenin OTP`leri görünmez', async () => {
    const dev = await getDeveloperToken();
    const other = await getReceiverToken();
    await createTestOtpLog({ projectId: other.project.id, code: '777777' });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${dev.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/otp/history — RECEIVER rol-duyarlı (kendi geçmişi)', () => {
  it('200 — RECEIVER artık kendi kayıtlarını görür (403 değil)', async () => {
    const ctx = await getReceiverToken();
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      code: '111111',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
  });

  it('yalnızca kendi kayıtları — başka receiver\'ın OTP\'si asla dönmez', async () => {
    const me = await getReceiverToken();
    // Aynı projede ikinci bir receiver + onun OTP'si.
    const { user: other } = await createTestUser({
      projectId: me.project.id,
      role: Role.RECEIVER,
    });
    await createTestOtpLog({
      projectId: me.project.id,
      receiverId: me.user.id,
      code: '111111',
    });
    await createTestOtpLog({
      projectId: me.project.id,
      receiverId: other.id,
      code: '222222',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
  });

  it('süresi dolmuş VE sharingActive:false kayıtlar da görünür', async () => {
    const ctx = await getReceiverToken();
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      code: '333333',
      sharingActive: false,
      expiresAt: new Date(Date.now() - 1000), // süresi geçmiş
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('333333');
    expect(res.body.data[0].sharingActive).toBe(false);
  });

  it('zengin alanlar — serviceName + deviceName çözümlenir', async () => {
    const ctx = await getReceiverToken();
    const service = await createTestService({
      projectId: ctx.project.id,
      name: 'Binance',
    });
    const { device } = await createTestDevice({
      userId: ctx.user.id,
      projectId: ctx.project.id,
    });
    await prisma.device.update({
      where: { id: device.id },
      data: { deviceName: 'İş Telefonum' },
    });
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      serviceId: service.id,
      deviceId: device.id,
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].serviceName).toBe('Binance');
    expect(res.body.data[0].deviceName).toBe('İş Telefonum');
  });

  it('çözülemeyen servis/cihaz → serviceName ve deviceName null', async () => {
    const ctx = await getReceiverToken();
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].serviceName).toBeNull();
    expect(res.body.data[0].deviceName).toBeNull();
  });
});

describe('PATCH /api/otp/:id/sharing', () => {
  it('200 — sahibi paylaşımı durdurabilir', async () => {
    const ctx = await getReceiverToken();
    const { otpLog } = await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
    });

    const res = await request(app)
      .patch(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ sharingActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.sharingActive).toBe(false);
    const stored = await prisma.oTPLog.findUnique({ where: { id: otpLog.id } });
    expect(stored?.sharingActive).toBe(false);
  });

  it('403 — başka receiver\'ın OTP\'sinde toggle denemesi', async () => {
    const owner = await getReceiverToken();
    const intruder = await getReceiverToken();
    const { otpLog } = await createTestOtpLog({
      projectId: owner.project.id,
      receiverId: owner.user.id,
    });

    const res = await request(app)
      .patch(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${intruder.accessToken}`)
      .send({ sharingActive: false });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('sharingActive=false → history\'de görünmez', async () => {
    const { projectId, receiver, developer } = await projectWithReceiverAndDeveloper();
    const { otpLog } = await createTestOtpLog({ projectId, receiverId: receiver.id });

    const before = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);
    expect(before.body.data).toHaveLength(1);

    await request(app)
      .patch(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ sharingActive: false });

    const after = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('device silinmiş receiver bile eski OTP\'sinin paylaşımını durdurabilir', async () => {
    const ctx = await getDeviceSecret();
    const { otpLog } = await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      deviceId: ctx.device.id,
    });
    // Cihaz silinir → OTPLog.deviceId SetNull olur ama receiverId kalır.
    await prisma.device.delete({ where: { id: ctx.device.id } });

    const res = await request(app)
      .patch(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ sharingActive: false });

    expect(res.status).toBe(200);
    const stored = await prisma.oTPLog.findUnique({ where: { id: otpLog.id } });
    expect(stored?.deviceId).toBeNull();
    expect(stored?.sharingActive).toBe(false);
  });
});

describe('GET /api/otp/:id/sharing', () => {
  it('200 — sahibi OTP\'nin kimlerle paylaşıldığını salt-okunur görür', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    const service = await createTestService({ projectId: ctx.project.id });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: developer.id,
    });
    const { otpLog } = await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      serviceId: service.id,
    });

    const res = await request(app)
      .get(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.targets).toHaveLength(1);
    expect(res.body.data.targets[0].id).toBe(developer.id);
  });

  it('403 — başka receiver\'ın OTP paylaşım hedefi görülemez', async () => {
    const owner = await getReceiverToken();
    const intruder = await getReceiverToken();
    const { otpLog } = await createTestOtpLog({
      projectId: owner.project.id,
      receiverId: owner.user.id,
    });

    const res = await request(app)
      .get(`/api/otp/${otpLog.id}/sharing`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);

    expect(res.status).toBe(403);
  });
});
