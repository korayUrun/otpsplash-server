import { randomUUID } from 'node:crypto';
import { RefreshTokenStatus, Role, type User } from '@prisma/client';
import { prisma } from '@config/prisma';
import { RefreshTokenRepository } from '@modules/auth/refreshToken.repository';
import { createTestProject, createTestUser } from '../helpers/fixtures';

const store = new RefreshTokenRepository(prisma);

/** FK için proje + DEVELOPER kullanıcı üretir. */
async function makeUser(): Promise<User> {
  const project = await createTestProject();
  const { user } = await createTestUser({
    projectId: project.id,
    role: Role.DEVELOPER,
  });
  return user;
}

const future = (): Date => new Date(Date.now() + 60_000);

describe('RefreshTokenRepository', () => {
  it('create + findByJti round-trip (ACTIVE)', async () => {
    const user = await makeUser();
    const jti = randomUUID();
    const familyId = randomUUID();
    await store.create({ jti, familyId, userId: user.id, expiresAt: future() });

    const rec = await store.findByJti(jti);
    expect(rec).not.toBeNull();
    expect(rec?.status).toBe(RefreshTokenStatus.ACTIVE);
    expect(rec?.familyId).toBe(familyId);
    expect(rec?.userId).toBe(user.id);
    expect(rec?.rotatedAt).toBeNull();
  });

  it('markRotated bir kez true, ikinci kez false döner (atomik sahiplenme)', async () => {
    const user = await makeUser();
    const jti = randomUUID();
    await store.create({ jti, familyId: randomUUID(), userId: user.id, expiresAt: future() });

    expect(await store.markRotated(jti, new Date())).toBe(true);
    // Aynı token'ı ikinci kez rotate etmek — yarış kaybeden istek — false almalı.
    expect(await store.markRotated(jti, new Date())).toBe(false);

    const rec = await store.findByJti(jti);
    expect(rec?.status).toBe(RefreshTokenStatus.ROTATED);
    expect(rec?.rotatedAt).toBeInstanceOf(Date);
  });

  it('revokeFamily ailedeki tüm kayıtları REVOKED yapar', async () => {
    const user = await makeUser();
    const familyId = randomUUID();
    const a = randomUUID();
    const b = randomUUID();
    await store.create({ jti: a, familyId, userId: user.id, expiresAt: future() });
    await store.create({ jti: b, familyId, userId: user.id, expiresAt: future() });

    await store.revokeFamily(familyId);

    expect((await store.findByJti(a))?.status).toBe(RefreshTokenStatus.REVOKED);
    expect((await store.findByJti(b))?.status).toBe(RefreshTokenStatus.REVOKED);
  });

  it('revokeAllForUser kullanıcının tüm ailelerini REVOKED yapar', async () => {
    const user = await makeUser();
    const a = randomUUID();
    const b = randomUUID();
    await store.create({ jti: a, familyId: randomUUID(), userId: user.id, expiresAt: future() });
    await store.create({ jti: b, familyId: randomUUID(), userId: user.id, expiresAt: future() });

    await store.revokeAllForUser(user.id);

    expect((await store.findByJti(a))?.status).toBe(RefreshTokenStatus.REVOKED);
    expect((await store.findByJti(b))?.status).toBe(RefreshTokenStatus.REVOKED);
  });

  it('deleteExpired yalnızca süresi geçmiş kayıtları siler', async () => {
    const user = await makeUser();
    const expired = randomUUID();
    const fresh = randomUUID();
    await store.create({
      jti: expired,
      familyId: randomUUID(),
      userId: user.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.create({ jti: fresh, familyId: randomUUID(), userId: user.id, expiresAt: future() });

    await store.deleteExpired(user.id);

    expect(await store.findByJti(expired)).toBeNull();
    expect(await store.findByJti(fresh)).not.toBeNull();
  });
});
