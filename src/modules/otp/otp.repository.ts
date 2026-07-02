import type { OTPLog, Prisma, PrismaClient } from '@prisma/client';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type {
  CreateOtpLogData,
  IOtpRepository,
  OtpLogWithRelations,
} from './otp.interfaces';

/** save/history sorgularının paylaştığı include seti (receiver kimliği + cihaz adı). */
const WITH_RELATIONS = { receiver: true, device: true } as const;

/**
 * Prisma tabanlı OTP repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaOtpRepository implements IOtpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(data: CreateOtpLogData): Promise<OtpLogWithRelations> {
    return this.prisma.oTPLog.create({ data, include: WITH_RELATIONS });
  }

  async findById(id: string): Promise<OTPLog | null> {
    return this.prisma.oTPLog.findUnique({ where: { id } });
  }

  /**
   * Bir developer'a aktif kuralla yönlendirilen kayıtları sayfalı döner (en yeni önce).
   * Görünürlük filtreleri: `sharingActive` açık + süresi dolmamış; ek olarak yalnızca
   * verilen receiver'lara ait kayıtlar (`receiverId IN receiverIds`). Böylece geçmiş,
   * canlı emit'in `resolveTargets` çözümüyle hizalanır (receiver bazlı erişim).
   */
  async findForDeveloper(
    projectId: string,
    receiverIds: string[],
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
    const where: Prisma.OTPLogWhereInput = {
      projectId,
      sharingActive: true,
      expiresAt: { gt: new Date() },
      receiverId: { in: receiverIds },
    };
    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      this.prisma.oTPLog.findMany({
        where,
        include: WITH_RELATIONS,
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
   * findForDeveloper'ın AKSİNE filtre YOKTUR: süresi dolmuş + sharingActive=false kayıtlar da
   * GELİR — receiver kendi kodlarını görüp paylaşımı yönetebilmeli.
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
        include: WITH_RELATIONS,
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
