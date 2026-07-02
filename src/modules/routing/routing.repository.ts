import {
  RoutingTarget,
  type Group,
  type PrismaClient,
  type RoutingRule,
  type User,
} from '@prisma/client';
import type {
  CreateRoutingRuleData,
  IRoutingRepository,
  RoutingRuleWithRelations,
  RoutingRuleWithTargets,
} from './routing.interfaces';

/**
 * Prisma tabanlı yönlendirme kuralı repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaRoutingRepository implements IRoutingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateRoutingRuleData): Promise<RoutingRule> {
    return this.prisma.routingRule.create({ data });
  }

  async findById(id: string): Promise<RoutingRule | null> {
    return this.prisma.routingRule.findUnique({ where: { id } });
  }

  async listByProject(projectId: string): Promise<RoutingRuleWithRelations[]> {
    return this.prisma.routingRule.findMany({
      where: { receiver: { projectId } },
      include: { receiver: true, group: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByReceiver(receiverId: string): Promise<RoutingRuleWithRelations[]> {
    return this.prisma.routingRule.findMany({
      where: { receiverId },
      include: { receiver: true, group: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findDeveloperRule(
    receiverId: string,
    developerId: string,
  ): Promise<RoutingRule | null> {
    return this.prisma.routingRule.findFirst({
      where: {
        receiverId,
        targetType: RoutingTarget.DEVELOPER,
        developerId,
      },
    });
  }

  async findGroupRule(
    receiverId: string,
    groupId: string,
  ): Promise<RoutingRule | null> {
    return this.prisma.routingRule.findFirst({
      where: {
        receiverId,
        targetType: RoutingTarget.GROUP,
        groupId,
      },
    });
  }

  /**
   * Resolver girdisi: yalnızca AKTİF kurallar. GROUP kuralları için `group.members.user`
   * join'lenir; DEVELOPER kuralları için `developerId` doğrudan kullanılır. Flatten resolver'da.
   */
  async findActiveTargets(
    receiverId: string,
  ): Promise<RoutingRuleWithTargets[]> {
    return this.prisma.routingRule.findMany({
      where: { receiverId, isActive: true },
      include: {
        group: { include: { members: { include: { user: true } } } },
      },
    });
  }

  /**
   * `findActiveTargets`'in TERSİ: developer'a doğrudan (`developerId`) VEYA üye olduğu bir
   * grup üzerinden (`group.members.some`) yönlendirilen AKTİF kuralların benzersiz `receiverId`
   * listesini döner. Grup üyeliği DB'de `some` ile çözülür — bellekte flatten gerekmez.
   */
  async findReceiverIdsForDeveloper(developerId: string): Promise<string[]> {
    const rules = await this.prisma.routingRule.findMany({
      where: {
        isActive: true,
        OR: [
          { targetType: RoutingTarget.DEVELOPER, developerId },
          {
            targetType: RoutingTarget.GROUP,
            group: { members: { some: { userId: developerId } } },
          },
        ],
      },
      select: { receiverId: true },
      distinct: ['receiverId'],
    });
    return rules.map((rule) => rule.receiverId);
  }

  async toggle(id: string, isActive: boolean): Promise<RoutingRule> {
    return this.prisma.routingRule.update({
      where: { id },
      data: { isActive },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.routingRule.delete({ where: { id } });
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findUsersByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.prisma.user.findMany({ where: { id: { in: ids } } });
  }

  async findGroupById(groupId: string): Promise<Group | null> {
    return this.prisma.group.findUnique({ where: { id: groupId } });
  }
}
