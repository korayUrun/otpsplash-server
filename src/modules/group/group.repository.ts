import type { Group, GroupMember, PrismaClient, User } from '@prisma/client';
import type {
  CreateGroupData,
  GroupWithMembers,
  IGroupRepository,
} from './group.interfaces';

/**
 * Prisma tabanlı grup repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaGroupRepository implements IGroupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateGroupData): Promise<Group> {
    return this.prisma.group.create({ data });
  }

  async findById(id: string): Promise<Group | null> {
    return this.prisma.group.findUnique({ where: { id } });
  }

  async findByProject(projectId: string): Promise<GroupWithMembers[]> {
    return this.prisma.group.findMany({
      where: { projectId },
      include: { members: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findMember(groupId: string, userId: string): Promise<GroupMember | null> {
    return this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  async addMember(groupId: string, userId: string): Promise<GroupMember> {
    return this.prisma.groupMember.create({ data: { groupId, userId } });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } },
    });
  }

  /**
   * Grubu siler. `group_members` ve `routing_rules` FK'leri `ON DELETE CASCADE` olduğundan
   * üyelikler ve bu grubu hedefleyen kurallar DB tarafından otomatik temizlenir.
   */
  async delete(groupId: string): Promise<void> {
    await this.prisma.group.delete({ where: { id: groupId } });
  }
}
