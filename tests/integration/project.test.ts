import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { createApp } from '../../src/app';
import { createTestProject, createTestUser } from '../helpers/fixtures';
import { getAdminToken, getDeveloperToken } from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

const RANDOM_UUID = '99999999-9999-9999-9999-999999999999';

describe('POST /api/projects', () => {
  it('201 — ADMIN proje oluşturur', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Banka Projesi' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data.name).toBe('Banka Projesi');
    expect(res.body.data.apiKey).toEqual(expect.any(String));
    expect(res.body.requestId).toEqual(expect.any(String));

    const stored = await prisma.project.findUnique({
      where: { id: res.body.data.id },
    });
    expect(stored).not.toBeNull();
  });

  it('403 — DEVELOPER proje oluşturamaz', async () => {
    const { accessToken } = await getDeveloperToken();

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Yetkisiz' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('401 — token yok', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Anonim' });

    expect(res.status).toBe(401);
  });

  it('400 — boş isim (VALIDATION_ERROR)', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/projects/:id', () => {
  it('200 — üye kendi projesini görür (parola sızdırılmaz)', async () => {
    const { accessToken, project, user } = await getDeveloperToken();

    const res = await request(app)
      .get(`/api/projects/${project.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(project.id);
    expect(res.body.data.users).toHaveLength(1);
    expect(res.body.data.users[0].id).toBe(user.id);
    expect(res.body.data.users[0]).not.toHaveProperty('password');
  });

  it('403 — başka projeye erişilemez', async () => {
    const { accessToken } = await getDeveloperToken();
    const other = await createTestProject('Başka Proje');

    const res = await request(app)
      .get(`/api/projects/${other.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('404 — olmayan proje', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .get(`/api/projects/${RANDOM_UUID}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('401 — token yok', async () => {
    const project = await createTestProject();
    const res = await request(app).get(`/api/projects/${project.id}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/projects/:id/users', () => {
  it('200 — ADMIN kullanıcıyı projeye ekler', async () => {
    const { accessToken } = await getAdminToken();
    const target = await createTestProject('Hedef Proje');
    const source = await createTestProject('Kaynak Proje');
    const { user } = await createTestUser({
      projectId: source.id,
      role: Role.DEVELOPER,
    });

    const res = await request(app)
      .post(`/api/projects/${target.id}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: user.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const moved = await prisma.user.findUnique({ where: { id: user.id } });
    expect(moved?.projectId).toBe(target.id);
  });

  it('404 — olmayan kullanıcı (USER_NOT_FOUND)', async () => {
    const { accessToken } = await getAdminToken();
    const target = await createTestProject('Hedef Proje');

    const res = await request(app)
      .post(`/api/projects/${target.id}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: RANDOM_UUID });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('409 — kullanıcı zaten projede (CONFLICT)', async () => {
    const { accessToken } = await getAdminToken();
    const target = await createTestProject('Hedef Proje');
    const { user } = await createTestUser({ projectId: target.id });

    const res = await request(app)
      .post(`/api/projects/${target.id}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: user.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404 — olmayan proje (PROJECT_NOT_FOUND)', async () => {
    const { accessToken } = await getAdminToken();
    const { user } = await createTestUser({
      projectId: (await createTestProject()).id,
    });

    const res = await request(app)
      .post(`/api/projects/${RANDOM_UUID}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: user.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('403 — DEVELOPER kullanıcı ekleyemez', async () => {
    const { accessToken, project } = await getDeveloperToken();
    const { user } = await createTestUser({ projectId: project.id });

    const res = await request(app)
      .post(`/api/projects/${project.id}/users`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId: user.id });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('DELETE /api/projects/:id/users/:uid', () => {
  it('200 — ADMIN kullanıcıyı projeden çıkarır', async () => {
    const { accessToken } = await getAdminToken();
    const project = await createTestProject('Silinecek Üye Projesi');
    const { user } = await createTestUser({ projectId: project.id });

    const res = await request(app)
      .delete(`/api/projects/${project.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const removed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(removed).toBeNull();
  });

  it('404 — kullanıcı bu projede yok (USER_NOT_FOUND)', async () => {
    const { accessToken } = await getAdminToken();
    const project = await createTestProject('Proje A');
    const otherProject = await createTestProject('Proje B');
    const { user } = await createTestUser({ projectId: otherProject.id });

    const res = await request(app)
      .delete(`/api/projects/${project.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('403 — DEVELOPER kullanıcı çıkaramaz', async () => {
    const { accessToken, project, user } = await getDeveloperToken();

    const res = await request(app)
      .delete(`/api/projects/${project.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
