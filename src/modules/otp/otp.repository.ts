import type { OTPLog, Prisma, PrismaClient } from '@prisma/client';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type {
  CreateOtpLogData,
  IOtpRepository,
  OtpLogWithRelations,
} from './otp.interfaces';
import type { VisibleReceiver } from '@modules/routing/routing.interfaces';

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
   * Görünürlük filtreleri: `sharingActive` açık + bu developer'ın KENDİ feed'inden kaldırMADIĞı
   * (dismissal yok) + receiver başına yalnızca LINK'ten SONRAKİ kayıtlar
   * (`createdAt >= linkedAt` — sonradan bağlanan developer geçmiş kodları göremez).
   * OTP süresiz — expiry filtresi yok. `linkedAt` ve `OTPLog.createdAt` aynı DB
   * saatinin `now()` değerleridir; karşılaştırma saat kaymasından etkilenmez.
   */
  async findForDeveloper(
    projectId: string,
    developerId: string,
    receivers: VisibleReceiver[],
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
    const where: Prisma.OTPLogWhereInput = {
      projectId,
      sharingActive: true,
      dismissals: { none: { userId: developerId } },
      OR: receivers.map((receiver) => ({
        receiverId: receiver.receiverId,
        createdAt: { gte: receiver.linkedAt },
      })),
    };
    return this.paginate(where, options);
  }

  /**
   * Projedeki TÜM OTP'leri sayfalı döner (en yeni önce) — admin özet ekranı.
   * Filtre YOKTUR: her receiver'dan, sharing/dismissal durumundan bağımsız hepsi gelir.
   */
  async findAllForProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
    return this.paginate({ projectId }, options);
  }

  /**
   * Bir receiver'ın KENDİ kayıtlarını sayfalı döner (en yeni önce).
   * findForDeveloper'ın AKSİNE filtre YOKTUR: sharingActive=false kayıtlar da GELİR
   * — receiver kendi kodlarını görüp paylaşımı yönetebilmeli.
   */
  async findByReceiver(
    receiverId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
    return this.paginate({ receiverId }, options);
  }

  async updateSharingActive(otpId: string, isActive: boolean): Promise<OTPLog> {
    return this.prisma.oTPLog.update({
      where: { id: otpId },
      data: { sharingActive: isActive },
    });
  }

  async dismissForDeveloper(
    projectId: string,
    developerId: string,
    otpIds: string[],
  ): Promise<number> {
    // Yalnızca projede gerçekten var olan id'ler için dismissal yazılır (geçersiz id sessizce atlanır).
    const existing = await this.prisma.oTPLog.findMany({
      where: { id: { in: otpIds }, projectId },
      select: { id: true },
    });
    if (existing.length === 0) {
      return 0;
    }
    // skipDuplicates: zaten kaldırılmış OTP tekrar kaldırılmaya çalışılırsa no-op (unique index).
    const result = await this.prisma.otpDismissal.createMany({
      data: existing.map((otp) => ({ otpId: otp.id, userId: developerId })),
      skipDuplicates: true,
    });
    return result.count;
  }

  /** Ortak sayfalama sorgusu (createdAt desc, receiver+device include). */
  private async paginate(
    where: Prisma.OTPLogWhereInput,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>> {
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
}
