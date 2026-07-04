import request from 'supertest';
import { CONSTANTS } from '@config/constants';
import { createApp } from '../../src/app';

const { app, io } = createApp();

afterAll(() => {
  io.close();
});

describe('GET /api/otp/sender-patterns', () => {
  it('auth olmadan 200 döner (PUBLIC uç)', async () => {
    const res = await request(app).get('/api/otp/sender-patterns');
    expect(res.status).toBe(200);
  });

  it('standart zarf DEĞİL, BARE dizi döner ({name,pattern} satırları)', async () => {
    const res = await request(app).get('/api/otp/sender-patterns');

    expect(Array.isArray(res.body)).toBe(true);
    // Standart { success, data } zarfı kullanılmamalı — shortcut sözleşmesi.
    expect(res.body).not.toHaveProperty('success');
    for (const item of res.body as unknown[]) {
      expect(Object.keys(item as object).sort()).toEqual(['name', 'pattern']);
    }
  });

  it('iç alanları (isActive/order) sızdırmaz', async () => {
    const res = await request(app).get('/api/otp/sender-patterns');

    for (const item of res.body as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty('isActive');
      expect(item).not.toHaveProperty('order');
    }
  });

  it('DEV/TEST ortamında Cache-Control: no-store döner (Shortcut cache gizlemesin)', async () => {
    const res = await request(app).get('/api/otp/sender-patterns');
    // NODE_ENV=test → isProduction() false → no-store beklenir.
    expect(res.headers['cache-control']).toBe(
      CONSTANTS.SENDER_PATTERN.CACHE_CONTROL_DEV,
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
