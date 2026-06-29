import type { OTPLog, PrismaClient } from '@prisma/client';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type { CreateOtpLogData, IOtpRepository } from './otp.interfaces';

/**
 * Prisma tabanlı OTP repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaOtpRepository implements IOtpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(data: CreateOtpLogData): Promise<OTPLog> {
    return this.prisma.oTPLog.create({ data });
  }

  /**
   * Projeye ait, süresi DOLMAMIŞ kayıtları sayfalı döner (en yeni önce).
   * Toplam sayım ve veri çekme tek round-trip'te paralel (Promise.all).
   */
  async findByProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OTPLog>> {
    const where = { projectId, expiresAt: { gt: new Date() } };
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      this.prisma.oTPLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: options.limit,
      }),
      this.prisma.oTPLog.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.oTPLog.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
