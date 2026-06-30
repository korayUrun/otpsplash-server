import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Platform } from '@prisma/client';
import { prisma } from '@config/prisma';
import { createApp } from '../../src/app';
import { createTestDevice } from '../helpers/fixtures';
import { getDeveloperToken, getReceiverToken } from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

describe('POST /api/devices/register', () => {
  it('201 — RECEIVER deviceId + deviceSecret alır', async () => {
    const { accessToken, user } = await getReceiverToken();

    const res = await request(app)
      .post('/api/devices/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platform: Platform.ANDROID });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deviceId).toEqual(expect.any(String));
    expect(res.body.data.deviceSecret).toEqual(expect.any(String));
    // 32 byte → 64 hex karakter.
    expect(res.body.data.deviceSecret).toHaveLength(64);

    // DB'de düz secret değil hash saklanır, cihaz kullanıcıya bağlanır.
    const stored = await prisma.device.findUnique({
      where: { id: res.body.data.deviceId },
    });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(user.id);
    expect(stored?.secretHash).not.toBe(res.body.data.deviceSecret);
    expect(stored?.secretHash.startsWith('$argon2id$')).toBe(true);
  });

  it('403 — DEVELOPER cihaz kaydedemez', async () => {
    const { accessToken } = await getDeveloperToken();

    const res = await request(app)
      .post('/api/devices/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platform: Platform.IOS });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('401 — token yok', async () => {
    const res = await request(app)
      .post('/api/devices/register')
      .send({ platform: Platform.ANDROID });

    expect(res.status).toBe(401);
  });

  it('400 — geçersiz platform (VALIDATION_ERROR)', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .post('/api/devices/register')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ platform: 'WINDOWS' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/devices/:id', () => {
  it('200 — sahibi cihazı iptal eder', async () => {
    const owner = await getReceiverToken();
    const { device } = await createTestDevice({
      userId: owner.user.id,
      projectId: owner.project.id,
    });

    const res = await request(app)
      .delete(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    const stored = await prisma.device.findUnique({ where: { id: device.id } });
    expect(stored?.isRevoked).toBe(true);
  });

  it('403 — sahibi olmayan iptal edemez', async () => {
    const owner = await getReceiverToken();
    const other = await getReceiverToken();
    const { device } = await createTestDevice({
      userId: owner.user.id,
      projectId: owner.project.id,
    });

    const res = await request(app)
      .delete(`/api/devices/${device.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // İptal edilmemiş kalır.
    const stored = await prisma.device.findUnique({ where: { id: device.id } });
    expect(stored?.isRevoked).toBe(false);
  });

  it('404 — olmayan cihaz (DEVICE_NOT_FOUND)', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .delete(`/api/devices/${randomUUID()}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DEVICE_NOT_FOUND');
  });
});

describe('GET /api/devices', () => {
  it('200 — yalnızca kendi cihazlarını döner, secretHash içermez', async () => {
    const owner = await getReceiverToken();
    const other = await getReceiverToken();
    await createTestDevice({ userId: owner.user.id, projectId: owner.project.id });
    await createTestDevice({ userId: owner.user.id, projectId: owner.project.id });
    // Başka kullanıcının cihazı listede görünmemeli.
    await createTestDevice({ userId: other.user.id, projectId: other.project.id });

    const res = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const device of res.body.data as Array<Record<string, unknown>>) {
      expect(device).not.toHaveProperty('secretHash');
      expect(device.id).toEqual(expect.any(String));
      expect(device.platform).toEqual(expect.any(String));
    }
  });
});
