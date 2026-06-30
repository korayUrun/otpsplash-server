import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { tokenService } from '@modules/auth/token.service';
import { createApp } from '../../src/app';
import { createTestGroup, createTestUser } from '../helpers/fixtures';
import {
  getAdminToken,
  getDeveloperToken,
  type AuthContext,
} from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

const RANDOM_UUID = '99999999-9999-9999-9999-999999999999';

/** Admin'in projesinde verilen rolde bir kullanıcı + token üretir (aynı proje izolasyonu). */
async function userInProject(
  admin: AuthContext,
  role: Role,
): Promise<{ id: string; token: string }> {
  const { user } = await createTestUser({ projectId: admin.project.id, role });
  const token = tokenService.generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    projectId: user.projectId,
  });
  return { id: user.id, token };
}

describe('POST /api/groups', () => {
  it('201 — ADMIN grup oluşturur', async () => {
    const { accessToken } = await getAdminToken();

    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Banka Ekibi' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data.name).toBe('Banka Ekibi');
  });

  it('403 — DEVELOPER grup oluşturamaz', async () => {
    const { accessToken } = await getDeveloperToken();

    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Yetkisiz' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('401 — token yok', async () => {
    const res = await request(app).post('/api/groups').send({ name: 'Anonim' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/groups/:id/members', () => {
  it('200 — ADMIN DEVELOPER ekler', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({ projectId: admin.project.id });
    const dev = await userInProject(admin, Role.DEVELOPER);

    const res = await request(app)
      .post(`/api/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: dev.id });

    expect(res.status).toBe(200);
    const member = await prisma.groupMember.findFirst({
      where: { groupId: group.id, userId: dev.id },
    });
    expect(member).not.toBeNull();
  });

  it('400 — DEVELOPER olmayan kullanıcı eklenemez (ValidationError)', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({ projectId: admin.project.id });
    const receiver = await userInProject(admin, Role.RECEIVER);

    const res = await request(app)
      .post(`/api/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: receiver.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('409 — zaten üye', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({ projectId: admin.project.id });
    const dev = await userInProject(admin, Role.DEVELOPER);

    await request(app)
      .post(`/api/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: dev.id });

    const res = await request(app)
      .post(`/api/groups/${group.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: dev.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404 — olmayan grup (GROUP_NOT_FOUND)', async () => {
    const admin = await getAdminToken();
    const dev = await userInProject(admin, Role.DEVELOPER);

    const res = await request(app)
      .post(`/api/groups/${RANDOM_UUID}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ userId: dev.id });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GROUP_NOT_FOUND');
  });
});

describe('DELETE /api/groups/:id/members/:uid', () => {
  it('200 — ADMIN üyeyi çıkarır', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({ projectId: admin.project.id });
    const dev = await userInProject(admin, Role.DEVELOPER);
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: dev.id },
    });

    const res = await request(app)
      .delete(`/api/groups/${group.id}/members/${dev.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    const member = await prisma.groupMember.findFirst({
      where: { groupId: group.id, userId: dev.id },
    });
    expect(member).toBeNull();
  });

  it('404 — üye değil (USER_NOT_FOUND)', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({ projectId: admin.project.id });
    const dev = await userInProject(admin, Role.DEVELOPER);

    const res = await request(app)
      .delete(`/api/groups/${group.id}/members/${dev.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('GET /api/groups', () => {
  it('200 — RECEIVER grup isimlerini salt-okunur görebilir', async () => {
    const admin = await getAdminToken();
    const group = await createTestGroup({
      projectId: admin.project.id,
      name: 'Görünür Grup',
    });
    const dev = await userInProject(admin, Role.DEVELOPER);
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: dev.id },
    });
    const receiver = await userInProject(admin, Role.RECEIVER);

    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${receiver.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Görünür Grup');
    expect(res.body.data[0].members[0].userId).toBe(dev.id);
  });

  it('200 — proje izolasyonu: başka projenin grupları görünmez', async () => {
    const admin = await getAdminToken();
    await createTestGroup({ projectId: admin.project.id });
    const other = await getDeveloperToken(); // farklı proje

    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
