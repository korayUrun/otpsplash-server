import type { Device, PrismaClient } from '@prisma/client';
import type { CreateDeviceData, IDeviceRepository } from './device.interfaces';

/**
 * Prisma tabanlı cihaz repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaDeviceRepository implements IDeviceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateDeviceData): Promise<Device> {
    return this.prisma.device.create({ data });
  }

  async findById(id: string): Promise<Device | null> {
    return this.prisma.device.findUnique({ where: { id } });
  }

  async findByUser(userId: string): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Doğrulama adayları: tüm cihazlar (revoke edilmişler dahil). Secret hash'i
   * eşleşen cihaz bulunduktan sonra revoke durumu kontrol edilir.
   * 5-10 cihaz için yeterli; ölçek büyürse lookup-prefix optimizasyonu (CLAUDE.md "İleride").
   */
  async findAllForVerification(): Promise<Device[]> {
    return this.prisma.device.findMany();
  }

  async revoke(id: string): Promise<Device> {
    return this.prisma.device.update({
      where: { id },
      data: { isRevoked: true },
    });
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.prisma.device.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
