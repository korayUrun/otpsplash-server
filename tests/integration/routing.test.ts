import request from 'supertest';
import { Role, RoutingTarget, type ServiceRegistry } from '@prisma/client';
import { prisma } from '@config/prisma';
import { createApp } from '../../src/app';
import {
  createTestGroup,
  createTestRoutingRule,
  createTestService,
  createTestUser,
} from '../helpers/fixtures';
import {
  getAdminToken,
  getReceiverToken,
  type AuthContext,
} from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

const RANDOM_UUID = '99999999-9999-9999-9999-999999999999';

interface Scenario {
  admin: AuthContext;
  receiverId: string;
  developerId: string;
  service: ServiceRegistry;
}

/** Admin'in projesinde receiver + developer + servis kuran ortak senaryo. */
async function setupScenario(): Promise<Scenario> {
  const admin = await getAdminToken();
  const { user: receiver } = await createTestUser({
    projectId: admin.project.id,
    role: Role.RECEIVER,
  });
  const { user: developer } = await createTestUser({
    projectId: admin.project.id,
    role: Role.DEVELOPER,
  });
  const service = await createTestService({ projectId: admin.project.id });
  return {
    admin,
    receiverId: receiver.id,
    developerId: developer.id,
    service,
  };
}

describe('POST /api/routing-rules', () => {
  it('201 — ADMIN (receiver, servis) → developer kuralı oluşturur', async () => {
    const s = await setupScenario();

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data.targetType).toBe(RoutingTarget.DEVELOPER);
  });

  it('201 — (receiver, servis) → grup kuralı oluşturur', async () => {
    const s = await setupScenario();
    const group = await createTestGroup({ projectId: s.admin.project.id });

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.GROUP,
        groupId: group.id,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.targetType).toBe(RoutingTarget.GROUP);
  });

  it('201 — aynı (receiver, servis) hem developer hem gruba aynı anda bağlanabilir', async () => {
    const s = await setupScenario();
    const group = await createTestGroup({ projectId: s.admin.project.id });

    const devRes = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      });
    const groupRes = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.GROUP,
        groupId: group.id,
      });

    // Farklı hedef tipleri çakışmaz — partial unique index'ler ayrı (developer vs grup).
    expect(devRes.status).toBe(201);
    expect(groupRes.status).toBe(201);
    const count = await prisma.routingRule.count({
      where: { receiverId: s.receiverId, serviceId: s.service.id },
    });
    expect(count).toBe(2);
  });

  it('400 — receiver alanı RECEIVER rolünde değilse', async () => {
    const s = await setupScenario();

    // developer id'sini receiver olarak göndermek → rol kontrolü patlar.
    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.developerId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — DEVELOPER hedefte developerId eksik (Zod)', async () => {
    const s = await setupScenario();

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 — olmayan servis (SERVICE_NOT_FOUND)', async () => {
    const s = await setupScenario();

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: RANDOM_UUID,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('409 — aynı (receiver, servis, developer) tekrar (servis katmanı)', async () => {
    const s = await setupScenario();
    const body = {
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    };

    await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send(body);

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUTING_RULE_CONFLICT');
  });

  it('403 — DEVELOPER kural oluşturamaz', async () => {
    const s = await setupScenario();
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .post('/api/routing-rules')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      });

    expect(res.status).toBe(403);
  });
});

describe('Partial unique index (DB seviyesi koruma)', () => {
  it('servis katmanı bypass edilip doğrudan DB\'ye aynı kayıt yazılırsa hata fırlatır', async () => {
    const s = await setupScenario();

    await createTestRoutingRule({
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    });

    // Aynı (receiver, servis, developer) → routing_rule_developer_unique ihlali (P2002).
    await expect(
      createTestRoutingRule({
        receiverId: s.receiverId,
        serviceId: s.service.id,
        targetType: RoutingTarget.DEVELOPER,
        developerId: s.developerId,
      }),
    ).rejects.toThrow();
  });
});

describe('PATCH /api/routing-rules/:id', () => {
  it('200 — kuralı pasifleştirir', async () => {
    const s = await setupScenario();
    const rule = await createTestRoutingRule({
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    });

    const res = await request(app)
      .patch(`/api/routing-rules/${rule.id}`)
      .set('Authorization', `Bearer ${s.admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    const stored = await prisma.routingRule.findUnique({ where: { id: rule.id } });
    expect(stored?.isActive).toBe(false);
  });

  it('404 — başka projenin kuralına dokunulamaz (ROUTING_RULE_NOT_FOUND)', async () => {
    const s = await setupScenario();
    const rule = await createTestRoutingRule({
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    });
    const otherAdmin = await getAdminToken(); // farklı proje

    const res = await request(app)
      .patch(`/api/routing-rules/${rule.id}`)
      .set('Authorization', `Bearer ${otherAdmin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTING_RULE_NOT_FOUND');
  });
});

describe('DELETE /api/routing-rules/:id', () => {
  it('200 — kuralı siler', async () => {
    const s = await setupScenario();
    const rule = await createTestRoutingRule({
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    });

    const res = await request(app)
      .delete(`/api/routing-rules/${rule.id}`)
      .set('Authorization', `Bearer ${s.admin.accessToken}`);

    expect(res.status).toBe(200);
    const stored = await prisma.routingRule.findUnique({ where: { id: rule.id } });
    expect(stored).toBeNull();
  });
});

describe('GET /api/routing-rules', () => {
  it('200 — ADMIN proje kurallarını listeler (developer e-postası dahil)', async () => {
    const s = await setupScenario();
    await createTestRoutingRule({
      receiverId: s.receiverId,
      serviceId: s.service.id,
      targetType: RoutingTarget.DEVELOPER,
      developerId: s.developerId,
    });

    const res = await request(app)
      .get('/api/routing-rules')
      .set('Authorization', `Bearer ${s.admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].developerId).toBe(s.developerId);
    expect(res.body.data[0].developerEmail).toEqual(expect.any(String));
  });
});
