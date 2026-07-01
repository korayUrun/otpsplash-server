import type { OTPLog, PrismaClient } from '@prisma/client';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type {
  CreateOtpLogData,
  IOtpRepository,
  OtpLogWithRelations,
} from './otp.interfaces';

/**
 * Prisma tabanlı OTP repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaOtpRepository implements IOtpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(data: CreateOtpLogData): Promise<OTPLog> {
    return this.prisma.oTPLog.create({ data });
  }

  async findById(id: string): Promise<OTPLog | null> {
    return this.prisma.oTPLog.findUnique({ where: { id } });
  }

  /**
   * Projeye ait, süresi DOLMAMIŞ ve paylaşımı AÇIK kayıtları sayfalı döner (en yeni önce).
   * `sharingActive: false` (receiver durdurmuş) kayıtlar history'den düşer (FAZ 7).
   * Toplam sayım ve veri çekme tek round-trip'te paralel (Promise.all).
   */
  async findByProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OTPLog>> {
    const where = {
      projectId,
      sharingActive: true,
      expiresAt: { gt: new Date() },
    };
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

  /**
   * Bir receiver'ın KENDİ kayıtlarını sayfalı döner (en yeni önce).
   * findByProject'in AKSİNE filtre YOKTUR: süresi dolmuş + sharingActive=false kayıtlar da GELİR
   * — receiver kendi kodlarını görüp paylaşımı yönetebilmeli. service + device include edilir.
   */
  async findByReceiver(
    receiverId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
    const where = { receiverId };
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      this.prisma.oTPLog.findMany({
        where,
        include: { service: true, device: true },
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

  async updateSharingActive(otpId: string, isActive: boolean): Promise<OTPLog> {
    return this.prisma.oTPLog.update({
      where: { id: otpId },
      data: { sharingActive: isActive },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.oTPLog.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
