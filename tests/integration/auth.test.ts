import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { createApp } from '../../src/app';
import { createTestProject, createTestUser, DEFAULT_PASSWORD } from '../helpers/fixtures';
import { getReceiverToken } from '../helpers/auth.helper';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

const RANDOM_UUID = '99999999-9999-9999-9999-999999999999';

describe('POST /api/auth/register', () => {
  it('201 — self-register kullanıcıyı varsayılan projeye bağlar', async () => {
    const project = await createTestProject('Default', true);

    const res = await request(app).post('/api/auth/register').send({
      email: 'new@test.com',
      password: DEFAULT_PASSWORD,
      name: 'Yeni Kullanıcı',
      phoneNumber: '+905551112233',
      role: Role.DEVELOPER,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe('new@test.com');
    expect(res.body.data.user.name).toBe('Yeni Kullanıcı');
    expect(res.body.data.user.phoneNumber).toBe('+905551112233');
    // projectId body'de gönderilmedi; backend varsayılan projeye bağladı.
    expect(res.body.data.user.projectId).toBe(project.id);
    expect(res.body.data.user).not.toHaveProperty('password');
    expect(res.body.requestId).toEqual(expect.any(String));

    // DB'de parola düz metin değil, argon2id hash olarak saklanır.
    const stored = await prisma.user.findUnique({ where: { email: 'new@test.com' } });
    expect(stored?.projectId).toBe(project.id);
    expect(stored?.password).not.toBe(DEFAULT_PASSWORD);
    expect(stored?.password.startsWith('$argon2id$')).toBe(true);
  });

  it('201 — phoneNumber opsiyonel (verilmezse null)', async () => {
    await createTestProject('Default', true);

    const res = await request(app).post('/api/auth/register').send({
      email: 'nophone@test.com',
      password: DEFAULT_PASSWORD,
      name: 'Telefonsuz',
      role: Role.RECEIVER,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.phoneNumber).toBeNull();
  });

  it('400 — zayıf şifre (VALIDATION_ERROR)', async () => {
    await createTestProject('Default', true);

    const res = await request(app).post('/api/auth/register').send({
      email: 'weak@test.com',
      password: 'weak',
      name: 'Zayıf',
      role: Role.DEVELOPER,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('400 — isim eksik (VALIDATION_ERROR)', async () => {
    await createTestProject('Default', true);

    const res = await request(app).post('/api/auth/register').send({
      email: 'noname@test.com',
      password: DEFAULT_PASSWORD,
      role: Role.DEVELOPER,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 — ADMIN rolüyle kayıt reddedilir (VALIDATION_ERROR)', async () => {
    await createTestProject('Default', true);

    const res = await request(app).post('/api/auth/register').send({
      email: 'admin-signup@test.com',
      password: DEFAULT_PASSWORD,
      name: 'Sahte Admin',
      role: Role.ADMIN,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 — varsayılan proje tanımlı değilse (PROJECT_NOT_FOUND)', async () => {
    // Proje var ama hiçbiri isDefault değil → self-register bağlanacak proje bulamaz.
    await createTestProject('Non-default', false);

    const res = await request(app).post('/api/auth/register').send({
      email: 'nodefault@test.com',
      password: DEFAULT_PASSWORD,
      name: 'Varsayılansız',
      role: Role.DEVELOPER,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('409 — e-posta çakışması (CONFLICT)', async () => {
    const project = await createTestProject('Default', true);
    await createTestUser({ projectId: project.id, email: 'dup@test.com' });

    const res = await request(app).post('/api/auth/register').send({
      email: 'dup@test.com',
      password: DEFAULT_PASSWORD,
      name: 'Kopya',
      role: Role.DEVELOPER,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  it('200 — doğru bilgilerle giriş', async () => {
    const project = await createTestProject();
    await createTestUser({ projectId: project.id, email: 'login@test.com' });

    const res = await request(app).post('/api/auth/login').send({
      email: 'login@test.com',
      password: DEFAULT_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  it('401 — yanlış şifre (AUTHENTICATION_FAILED)', async () => {
    const project = await createTestProject();
    await createTestUser({ projectId: project.id, email: 'login@test.com' });

    const res = await request(app).post('/api/auth/login').send({
      email: 'login@test.com',
      password: 'WrongPassword1',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_FAILED');
  });

  it('401 — olmayan e-posta aynı hatayı döner (bilgi sızdırma yok)', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'ghost@test.com',
      password: DEFAULT_PASSWORD,
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_FAILED');
  });
});

describe('POST /api/auth/refresh', () => {
  it('200 — geçerli refresh token yeni access token döner', async () => {
    const project = await createTestProject();
    await createTestUser({ projectId: project.id, email: 'refresh@test.com' });

    const login = await request(app).post('/api/auth/login').send({
      email: 'refresh@test.com',
      password: DEFAULT_PASSWORD,
    });
    const { refreshToken } = login.body.data;

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it('401 — geçersiz refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'garbage.token.value' });

    expect(res.status).toBe(401);
  });

  it('401 — süresi dolmuş refresh token', async () => {
    const expired = jwt.sign({}, env.JWT_REFRESH_SECRET, {
      subject: RANDOM_UUID,
      expiresIn: -10,
    });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: expired });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('POST /api/auth/logout', () => {
  it('200 — geçerli access token ile', async () => {
    const { accessToken } = await getReceiverToken();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toEqual(expect.any(String));
  });

  it('401 — token yok', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('login 10/dk aşılınca 429 döner', async () => {
    const limit = CONSTANTS.RATE_LIMIT.LOGIN_MAX;
    let lastStatus = 0;

    // İlk `limit` istek geçer (401), bir fazlası 429 olmalı.
    for (let i = 0; i < limit + 1; i++) {
      const res = await request(app).post('/api/auth/login').send({
        email: 'ghost@test.com',
        password: DEFAULT_PASSWORD,
      });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
