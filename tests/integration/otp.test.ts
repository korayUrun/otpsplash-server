import request from 'supertest';
import { Role, RoutingTarget, Source } from '@prisma/client';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';
import { tokenService } from '@modules/auth/token.service';
import { createApp } from '../../src/app';
import {
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

const SECRET_HEADER_NAME = 'X-Device-Secret';

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

const { app, io } = createApp();
const encryptor = new AesGcmOtpEncryptor();

/** Device Secret başlığı (CLAUDE.md API kontratı: X-Device-Secret). */
const SECRET_HEADER = 'X-Device-Secret';

afterAll(() => {
  io.close();
});

describe('POST /api/otp', () => {
  it('200 — geçerli X-Device-Secret + smsText', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toEqual(expect.any(String));
    expect(res.body.data.deliveredTo).toBe(0); // bağlı developer yok
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('200 — geçerli X-Device-Secret + code', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ code: '654321', source: Source.IOS_SHORTCUT });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toEqual(expect.any(Number));
  });

  it('401 — X-Device-Secret yok (DEVICE_SECRET_INVALID)', async () => {
    const res = await request(app)
      .post('/api/otp')
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('401 — geçersiz X-Device-Secret (DEVICE_SECRET_INVALID)', async () => {
    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, 'deadbeef'.repeat(8))
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('401 — revoke edilmiş cihaz (DEVICE_REVOKED)', async () => {
    const { deviceSecret } = await getDeviceSecret({ isRevoked: true });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_REVOKED');
  });

  it('401 — Authorization: Bearer artık işe yaramaz (eski davranış kaldırıldı)', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .post('/api/otp')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ smsText: 'Kodunuz: 847291', source: Source.ANDROID });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SECRET_INVALID');
  });

  it('422 — OTP içermeyen smsText (OTP_NOT_FOUND)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ smsText: 'Bu mesajda kod yok', source: Source.ANDROID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTP_NOT_FOUND');
  });

  it('400 — smsText ve code ikisi de yok (VALIDATION_ERROR)', async () => {
    const { deviceSecret } = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ source: Source.ANDROID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('DB`de kod şifreli saklanır ve doğru cihaza (deviceId) bağlanır', async () => {
    const { deviceSecret, project, device } = await getDeviceSecret();
    const plain = '847291';

    await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER, deviceSecret)
      .send({ smsText: `Kodunuz: ${plain}`, source: Source.ANDROID });

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

  it('403 — RECEIVER geçmişe erişemez', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
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

describe('POST /api/otp — routing dağıtımı (FAZ 7)', () => {
  it('kuralı olan receiver+servis → hedef developer\'a iletilir (deliveredTo=1)', async () => {
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

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER_NAME, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, serviceId: service.id });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(1);

    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored?.serviceId).toBe(service.id);
    expect(stored?.receiverId).toBe(ctx.user.id);
  });

  it('hedeflenmeyen developer bildirim almaz — deliveredTo yalnızca kuraldaki hedefi sayar', async () => {
    const ctx = await getDeviceSecret();
    const { user: targeted } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    // Aynı projede kurala dahil OLMAYAN ikinci developer — bildirim almamalı.
    await createTestUser({ projectId: ctx.project.id, role: Role.DEVELOPER });
    const service = await createTestService({ projectId: ctx.project.id });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      serviceId: service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: targeted.id,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER_NAME, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, serviceId: service.id });

    expect(res.status).toBe(200);
    // Projede 2 developer olmasına rağmen yalnızca kuraldaki tek hedefe iletilir.
    expect(res.body.data.deliveredTo).toBe(1);
  });

  it('kuralı olmayan receiver+servis → kimseye gitmez (deliveredTo=0), serviceId null', async () => {
    const ctx = await getDeviceSecret();

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER_NAME, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(0);

    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored).not.toBeNull();
    expect(stored?.serviceId).toBeNull();
  });

  it('pasif kural → iletilmez (deliveredTo=0), DB kaydı yine de oluşur', async () => {
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
      isActive: false,
    });

    const res = await request(app)
      .post('/api/otp')
      .set(SECRET_HEADER_NAME, ctx.deviceSecret)
      .send({ code: '123456', source: Source.ANDROID, serviceId: service.id });

    expect(res.status).toBe(200);
    expect(res.body.data.deliveredTo).toBe(0);
    const stored = await prisma.oTPLog.findFirst({
      where: { receiverId: ctx.user.id },
    });
    expect(stored).not.toBeNull();
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
