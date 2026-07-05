import { RefreshTokenStatus, type PrismaClient } from '@prisma/client';
import type {
  IRefreshTokenStore,
  RefreshTokenRecord,
} from './auth.interfaces';

/**
 * Prisma tabanlı refresh token deposu (rotasyon + reuse tespiti).
 * Tüm işlemler I/O olduğundan ASYNC (CLAUDE.md async kuralı).
 */
export class RefreshTokenRepository implements IRefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(record: {
    jti: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: record.jti,
        familyId: record.familyId,
        userId: record.userId,
        expiresAt: record.expiresAt,
        status: RefreshTokenStatus.ACTIVE,
      },
    });
  }

  async findByJti(jti: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({
      where: { id: jti },
      select: {
        id: true,
        familyId: true,
        userId: true,
        status: true,
        rotatedAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Koşullu update ile ACTIVE→ROTATED geçişi — aynı token'la gelen eşzamanlı iki yenileme
   * yarışında yalnızca biri satırı günceller (`count === 1`), diğeri `false` alır.
   */
  async markRotated(jti: string, rotatedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: jti, status: RefreshTokenStatus.ACTIVE },
      data: { status: RefreshTokenStatus.ROTATED, rotatedAt },
    });
    return count === 1;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, status: { not: RefreshTokenStatus.REVOKED } },
      data: { status: RefreshTokenStatus.REVOKED },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, status: { not: RefreshTokenStatus.REVOKED } },
      data: { status: RefreshTokenStatus.REVOKED },
    });
  }

  async deleteExpired(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    });
  }
}
