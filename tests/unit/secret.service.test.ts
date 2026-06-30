import { SecretService } from '@modules/device/secret.service';
import { env } from '@config/env';

/**
 * SecretService birim testi.
 * generate() saf crypto (SYNC); hash/verify argon2id (ASYNC).
 * verify yanlış secret'ta exception fırlatmaz, `false` döner (çok cihaz gezilir).
 */

const service = new SecretService();
const HEX_RE = /^[0-9a-f]+$/;

describe('SecretService.generate', () => {
  it('256-bit (DEVICE_SECRET_BYTES) hex secret üretir', () => {
    const secret = service.generate();
    // 32 byte → 64 hex karakter.
    expect(secret).toHaveLength(env.DEVICE_SECRET_BYTES * 2);
    expect(secret).toMatch(HEX_RE);
  });

  it('her çağrıda farklı değer üretir (rastgelelik)', () => {
    const a = service.generate();
    const b = service.generate();
    expect(a).not.toBe(b);
  });
});

describe('SecretService.hash / verify', () => {
  it('hash() → verify() aynı secret için true döner', async () => {
    const secret = service.generate();
    const hash = await service.hash(secret);
    await expect(service.verify(secret, hash)).resolves.toBe(true);
  });

  it('verify() yanlış secret için false döner (exception değil)', async () => {
    const hash = await service.hash(service.generate());
    await expect(service.verify(service.generate(), hash)).resolves.toBe(false);
  });

  it('verify() bozuk hash için false döner (exception değil)', async () => {
    await expect(service.verify('whatever', 'not-a-valid-argon2-hash')).resolves.toBe(
      false,
    );
  });

  it('hash() her çağrıda farklı hash üretir (salt rastgeleliği)', async () => {
    const secret = service.generate();
    const h1 = await service.hash(secret);
    const h2 = await service.hash(secret);
    expect(h1).not.toBe(h2);
    // Yine de ikisi de aynı secret'ı doğrular.
    await expect(service.verify(secret, h1)).resolves.toBe(true);
    await expect(service.verify(secret, h2)).resolves.toBe(true);
  });
});
