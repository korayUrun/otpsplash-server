import request from 'supertest';
import { prisma } from '@config/prisma';
import { createApp } from '../../src/app';
import { createTestService } from '../helpers/fixtures';
import { getAdminToken, getDeveloperToken } from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

/** Bir projede kova (inaktif, adsız) satır oluşturur. */
async function createBucketRow(
  projectId: string,
  lastSeenSender = 'UNKNOWNCO',
): Promise<string> {
  const row = await prisma.serviceRegistry.create({
    data: {
      projectId,
      name: null,
      isActive: false,
      lastSeenSender,
      unmatchedCount: 3,
      lastSeenAt: new Date(),
    },
  });
  return row.id;
}

describe('POST /api/service-registry', () => {
  it('201 — ADMIN manuel servis kuralı oluşturur', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/service-registry')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Binance', senderPattern: '^BINANCE$' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Binance');
    expect(res.body.data.isActive).toBe(true);
  });

  it('400 — 200 karakterden uzun senderPattern', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/service-registry')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Uzun', senderPattern: 'a'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — tehlikeli iç içe quantifier pattern (ReDoS)', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/service-registry')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Tehlikeli', senderPattern: '(a+)+' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — hiç pattern verilmedi (en az biri zorunlu)', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/service-registry')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Patternsiz' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('403 — ADMIN olmayan oluşturamaz', async () => {
    const { accessToken } = await getDeveloperToken();

    const res = await request(app)
      .post('/api/service-registry')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Yetkisiz', senderPattern: '^X$' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/service-registry/:id (kova satırını aktive et)', () => {
  it('200 — inaktif satır isim+kural ile aktive edilir', async () => {
    const admin = await getAdminToken();
    const id = await createBucketRow(admin.project.id);

    const res = await request(app)
      .patch(`/api/service-registry/${id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Garanti', senderPattern: '^GARANTI$' });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
    expect(res.body.data.name).toBe('Garanti');

    const stored = await prisma.serviceRegistry.findUnique({ where: { id } });
    expect(stored?.isActive).toBe(true);
    expect(stored?.name).toBe('Garanti');
    expect(stored?.senderPattern).toBe('^GARANTI$');
  });

  it('404 — başka projenin satırı aktive edilemez (SERVICE_NOT_FOUND)', async () => {
    const admin = await getAdminToken();
    const other = await getAdminToken(); // farklı proje
    const id = await createBucketRow(other.project.id);

    const res = await request(app)
      .patch(`/api/service-registry/${id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Sızıntı', senderPattern: '^X$' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });
});

describe('GET /api/service-registry', () => {
  it('200 — /unmatched yalnızca inaktif (kova) satırları döner', async () => {
    const admin = await getAdminToken();
    await createTestService({ projectId: admin.project.id, name: 'Aktif' }); // isActive true
    await createBucketRow(admin.project.id, 'KOVACO');

    const res = await request(app)
      .get('/api/service-registry/unmatched')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isActive).toBe(false);
    expect(res.body.data[0].lastSeenSender).toBe('KOVACO');
  });

  it('200 — / hem aktif hem kova satırlarını döner', async () => {
    const admin = await getAdminToken();
    await createTestService({ projectId: admin.project.id, name: 'Aktif' });
    await createBucketRow(admin.project.id);

    const res = await request(app)
      .get('/api/service-registry')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('DELETE /api/service-registry/:id', () => {
  it('200 — ADMIN kaydı siler', async () => {
    const admin = await getAdminToken();
    const service = await createTestService({ projectId: admin.project.id });

    const res = await request(app)
      .delete(`/api/service-registry/${service.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const stored = await prisma.serviceRegistry.findUnique({
      where: { id: service.id },
    });
    expect(stored).toBeNull();
  });
});
