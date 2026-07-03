import request from 'supertest';
import { Role, RoutingTarget, Source } from '@prisma/client';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';
import { tokenService } from '@modules/auth/token.service';
import { createApp } from '../../src/app';
import {
  createTestDevice,
  createTestGroup,
  createTestOtpLog,
  createTestProject,
  createTestRoutingRule,
  createTestUser,
} from '../helpers/fixtures';
import {
  getAdminToken,
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

/**
 * Aynı projede receiver + developer (token'lı) kurar ve receiver'ın kodlarını developer'a
 * yönlendiren AKTİF bir DEVELOPER kuralı ekler (servis kavramı yok — kural receiver bazlıdır).
 * Developer history'si canlı emit ile aynı routing çözümüne göre süzülür (kural yoksa boş feed).
 */
async function projectWithRoutedDeveloper(): Promise<{
  projectId: string;
  receiver: { id: string; token: string };
  developer: { id: string; token: string };
}> {
  const project = await createTestProject();
  const { user: receiver } = await createTestUser({
    projectId: project.id,
    role: Role.RECEIVER,
    name: 'Alice',
    phoneNumber: '+905550001122',
  });
  const { user: developer } = await createTestUser({
    projectId: project.id,
    role: Role.DEVELOPER,
  });
  await createTestRoutingRule({
    receiverId: receiver.id,
    targetType: RoutingTarget.DEVELOPER,
    developerId: developer.id,
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
    // Receiver'a kural yok → kimseye gitmez.
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
    // Ham gönderici etiketi olarak kalıcılaştırılır.
    expect(stored?.senderRaw).toBe('TESTSENDER');
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

describe('POST /api/otp — receiver bazlı routing', () => {
  it('receiver\'ın kuralı varsa hedef developer\'a iletilir (deliveredTo=1)', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
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
    expect(stored?.senderRaw).toBe('BINANCE');
  });

  it('hedeflenmeyen developer bildirim almaz — deliveredTo yalnızca kuraldaki hedefi sayar', async () => {
    const ctx = await getDeviceSecret();
    const { user: targeted } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    // Kurala dahil OLMAYAN ikinci developer — bildirim almamalı.
    await createTestUser({ projectId: ctx.project.id, role: Role.DEVELOPER });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
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

  it('receiver\'ın kuralı yoksa kimseye gitmez ama OTP kaydedilir (deliveredTo=0)', async () => {
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
    expect(stored).not.toBeNull();
    expect(stored?.senderRaw).toBe('UNKNOWNCO');
  });

  it('pasif kural → iletilmez (deliveredTo=0), OTP yine kaydedilir', async () => {
    const ctx = await getDeviceSecret();
    const { user: developer } = await createTestUser({
      projectId: ctx.project.id,
      role: Role.DEVELOPER,
    });
    await createTestRoutingRule({
      receiverId: ctx.user.id,
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
    expect(stored).not.toBeNull();
  });
});

describe('GET /api/otp/history — DEVELOPER routing-süzülü feed', () => {
  it('200 — developer yalnızca kendisine yönlendirilen receiver\'ların kodlarını görür', async () => {
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      code: '111111',
    });
    await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      code: '222222',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    // Kodlar şifresi çözülmüş olarak döner.
    const codes = (res.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(['111111', '222222']));
    expect(res.body.pagination.total).toBe(2);
  });

  it('kural yok → boş feed (kod başka developer\'a yönlendirilmiş olsa bile)', async () => {
    const { projectId, receiver } = await projectWithRoutedDeveloper();
    // Aynı projede, hiçbir kurala dahil OLMAYAN ikinci developer.
    const { user: outsider } = await createTestUser({
      projectId,
      role: Role.DEVELOPER,
    });
    const outsiderToken = tokenService.generateAccessToken({
      sub: outsider.id,
      email: outsider.email,
      role: outsider.role,
      projectId: outsider.projectId,
    });
    // Kod, kuraldaki developer'a yönlendirilir — outsider'ın kapsamında değil.
    await createTestOtpLog({ projectId, receiverId: receiver.id });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('grup üyeliğiyle yönlendirilen developer da görür', async () => {
    const project = await createTestProject();
    const { user: receiver } = await createTestUser({
      projectId: project.id,
      role: Role.RECEIVER,
    });
    const { user: developer } = await createTestUser({
      projectId: project.id,
      role: Role.DEVELOPER,
    });
    const group = await createTestGroup({ projectId: project.id });
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: developer.id },
    });
    await createTestRoutingRule({
      receiverId: receiver.id,
      targetType: RoutingTarget.GROUP,
      groupId: group.id,
    });
    await createTestOtpLog({
      projectId: project.id,
      receiverId: receiver.id,
      code: '111111',
    });

    const token = tokenService.generateAccessToken({
      sub: developer.id,
      email: developer.email,
      role: developer.role,
      projectId: developer.projectId,
    });
    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
  });

  it('developer "kimden geldi"yi görür: receiver{name,email,phoneNumber} + device{name} + senderRaw', async () => {
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    const { device } = await createTestDevice({
      userId: receiver.id,
      projectId,
      deviceName: 'İş Telefonum',
    });
    await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      deviceId: device.id,
      code: '111111',
      senderRaw: 'BINANCE',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item.senderRaw).toBe('BINANCE');
    expect(item.receiver).toEqual({
      name: 'Alice',
      email: expect.any(String),
      phoneNumber: '+905550001122',
    });
    expect(item.device).toEqual({ name: 'İş Telefonum' });
  });

  it('401 — token yok', async () => {
    const res = await request(app).get('/api/otp/history');
    expect(res.status).toBe(401);
  });

  it('OTP süresiz — createdAt eski olsa bile feed\'de kalır (otomatik düşmez)', async () => {
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    // createdAt'i günler öncesine çek — eskiden expiry ile düşerdi, artık kalmalı.
    const { otpLog } = await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      code: '111111',
    });
    await prisma.oTPLog.update({
      where: { id: otpLog.id },
      data: { createdAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
  });

  it('proje izolasyonu — developer başka projenin kodlarını asla görmez', async () => {
    const own = await projectWithRoutedDeveloper();
    await createTestOtpLog({
      projectId: own.projectId,
      receiverId: own.receiver.id,
      code: '111111',
    });
    // Başka bir projede tamamen ayrı bir routed kurulum + kod.
    const foreign = await projectWithRoutedDeveloper();
    await createTestOtpLog({
      projectId: foreign.projectId,
      receiverId: foreign.receiver.id,
      code: '777777',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${own.developer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('111111');
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

  it('sharingActive:false kayıtlar da kendi geçmişinde görünür', async () => {
    const ctx = await getReceiverToken();
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      code: '333333',
      sharingActive: false,
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].code).toBe('333333');
    expect(res.body.data[0].sharingActive).toBe(false);
  });

  it('zengin alanlar — receiver + device bilgisi döner', async () => {
    const ctx = await getReceiverToken({ name: 'Bob', phoneNumber: '+905559998877' });
    const { device } = await createTestDevice({
      userId: ctx.user.id,
      projectId: ctx.project.id,
      deviceName: 'İş Telefonum',
    });
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
      deviceId: device.id,
      senderRaw: 'BINANCE',
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item.senderRaw).toBe('BINANCE');
    expect(item.receiver).toEqual({
      name: 'Bob',
      email: expect.any(String),
      phoneNumber: '+905559998877',
    });
    expect(item.device).toEqual({ name: 'İş Telefonum' });
  });

  it('cihaz bağlı değilse → device null (sahiplik yine de korunur)', async () => {
    const ctx = await getReceiverToken();
    await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${ctx.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].device).toBeNull();
    expect(res.body.data[0].receiver.email).toEqual(expect.any(String));
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
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    const { otpLog } = await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
    });

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
    await createTestRoutingRule({
      receiverId: ctx.user.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: developer.id,
    });
    const { otpLog } = await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
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

describe('POST /api/otp/dismiss — developer kendi feed\'inden kaldırır', () => {
  it('kaldırılan OTP developer feed\'inden düşer ama receiver\'da kalır (kalıcı silme değil)', async () => {
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    const { otpLog: keep } = await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      code: '111111',
    });
    const { otpLog: drop } = await createTestOtpLog({
      projectId,
      receiverId: receiver.id,
      code: '222222',
    });

    const dismissRes = await request(app)
      .post('/api/otp/dismiss')
      .set('Authorization', `Bearer ${developer.token}`)
      .send({ otpIds: [drop.id] });

    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.data.dismissed).toBe(1);

    // Developer feed'inde artık yalnızca kaldırılmayan kod var.
    const devFeed = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${developer.token}`);
    const devCodes = (devFeed.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(devCodes).toEqual(['111111']);

    // Receiver kendi geçmişinde HER İKİSİNİ de görmeye devam eder (dismissal per-developer).
    const rcvFeed = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${receiver.token}`);
    const rcvCodes = (rcvFeed.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(rcvCodes.sort()).toEqual(['111111', '222222']);
    // OTP tabloda duruyor (kalıcı silinmedi).
    expect(await prisma.oTPLog.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(await prisma.oTPLog.findUnique({ where: { id: drop.id } })).not.toBeNull();
  });

  it('aynı OTP tekrar kaldırılırsa idempotent (dismissed:0)', async () => {
    const { projectId, receiver, developer } = await projectWithRoutedDeveloper();
    const { otpLog } = await createTestOtpLog({ projectId, receiverId: receiver.id });

    await request(app)
      .post('/api/otp/dismiss')
      .set('Authorization', `Bearer ${developer.token}`)
      .send({ otpIds: [otpLog.id] });

    const again = await request(app)
      .post('/api/otp/dismiss')
      .set('Authorization', `Bearer ${developer.token}`)
      .send({ otpIds: [otpLog.id] });

    expect(again.status).toBe(200);
    expect(again.body.data.dismissed).toBe(0);
  });

  it('403 — RECEIVER dismiss edemez (yalnızca DEVELOPER)', async () => {
    const ctx = await getReceiverToken();
    const { otpLog } = await createTestOtpLog({
      projectId: ctx.project.id,
      receiverId: ctx.user.id,
    });

    const res = await request(app)
      .post('/api/otp/dismiss')
      .set('Authorization', `Bearer ${ctx.accessToken}`)
      .send({ otpIds: [otpLog.id] });

    expect(res.status).toBe(403);
  });

  it('400 — boş otpIds (VALIDATION_ERROR)', async () => {
    const { developer } = await projectWithRoutedDeveloper();
    const res = await request(app)
      .post('/api/otp/dismiss')
      .set('Authorization', `Bearer ${developer.token}`)
      .send({ otpIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/otp/history — ADMIN özeti (tüm receiver\'lar)', () => {
  it('projedeki tüm receiver\'lardan gelen tüm OTP\'ler sıralanır', async () => {
    const admin = await getAdminToken();
    const { user: r1 } = await createTestUser({
      projectId: admin.project.id,
      role: Role.RECEIVER,
    });
    const { user: r2 } = await createTestUser({
      projectId: admin.project.id,
      role: Role.RECEIVER,
    });
    await createTestOtpLog({ projectId: admin.project.id, receiverId: r1.id, code: '111111' });
    await createTestOtpLog({ projectId: admin.project.id, receiverId: r2.id, code: '222222' });
    // Paylaşımı kapalı olan bile admin özetinde görünür (filtre yok).
    await createTestOtpLog({
      projectId: admin.project.id,
      receiverId: r1.id,
      code: '333333',
      sharingActive: false,
    });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const codes = (res.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(codes.sort()).toEqual(['111111', '222222', '333333']);
    expect(res.body.pagination.total).toBe(3);
  });

  it('proje izolasyonu — admin başka projenin OTP\'lerini görmez', async () => {
    const admin = await getAdminToken();
    const { user: mine } = await createTestUser({
      projectId: admin.project.id,
      role: Role.RECEIVER,
    });
    await createTestOtpLog({ projectId: admin.project.id, receiverId: mine.id, code: '111111' });
    // Başka projede bir OTP.
    const other = await getReceiverToken();
    await createTestOtpLog({ projectId: other.project.id, receiverId: other.user.id, code: '999999' });

    const res = await request(app)
      .get('/api/otp/history')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const codes = (res.body.data as Array<{ code: string }>).map((d) => d.code);
    expect(codes).toEqual(['111111']);
  });
});
