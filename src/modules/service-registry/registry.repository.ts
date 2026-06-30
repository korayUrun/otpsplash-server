import type { PrismaClient, ServiceRegistry } from '@prisma/client';
import type {
  ActivateServiceData,
  CreateServiceRuleData,
  IServiceRegistryRepository,
} from './registry.interfaces';

/**
 * Prisma tabanlı servis kayıt defteri repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaServiceRegistryRepository
  implements IServiceRegistryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveRules(projectId: string): Promise<ServiceRegistry[]> {
    return this.prisma.serviceRegistry.findMany({
      where: { projectId, isActive: true },
    });
  }

  async findById(id: string): Promise<ServiceRegistry | null> {
    return this.prisma.serviceRegistry.findUnique({ where: { id } });
  }

  async create(data: CreateServiceRuleData): Promise<ServiceRegistry> {
    return this.prisma.serviceRegistry.create({ data });
  }

  async activate(
    id: string,
    data: ActivateServiceData,
  ): Promise<ServiceRegistry> {
    return this.prisma.serviceRegistry.update({
      where: { id },
      data: { ...data, isActive: true },
    });
  }

  /**
   * Kova upsert: `lastSeenSender` eşleşen inaktif satır varsa sayaç+zaman günceller,
   * yoksa `isActive: false, name: null` yeni satır açar. (projectId, lastSeenSender) üzerinde
   * unique constraint olmadığından `upsert` yerine bul-veya-oluştur kullanılır — bu ölçekte yeterli.
   */
  async upsertUnmatched(
    projectId: string,
    senderRaw: string,
  ): Promise<ServiceRegistry> {
    const existing = await this.prisma.serviceRegistry.findFirst({
      where: { projectId, isActive: false, lastSeenSender: senderRaw },
    });
    if (existing) {
      return this.prisma.serviceRegistry.update({
        where: { id: existing.id },
        data: { unmatchedCount: { increment: 1 }, lastSeenAt: new Date() },
      });
    }
    return this.prisma.serviceRegistry.create({
      data: {
        projectId,
        name: null,
        isActive: false,
        lastSeenSender: senderRaw,
        unmatchedCount: 1,
        lastSeenAt: new Date(),
      },
    });
  }

  async findUnmatched(projectId: string): Promise<ServiceRegistry[]> {
    return this.prisma.serviceRegistry.findMany({
      where: { projectId, isActive: false },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async findAll(projectId: string): Promise<ServiceRegistry[]> {
    return this.prisma.serviceRegistry.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.serviceRegistry.delete({ where: { id } });
  }
}
