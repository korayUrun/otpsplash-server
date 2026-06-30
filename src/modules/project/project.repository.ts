import type { PrismaClient, Project, User } from '@prisma/client';
import type {
  CreateProjectData,
  IProjectRepository,
  ProjectWithUsers,
} from './project.interfaces';

/**
 * Prisma tabanlı proje repository (DB katmanı — SRP).
 * Tüm işlemler I/O olduğu için ASYNC. Prisma örneği constructor injection ile geçer.
 */
export class PrismaProjectRepository implements IProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateProjectData): Promise<Project> {
    return this.prisma.project.create({ data });
  }

  async findById(id: string): Promise<ProjectWithUsers | null> {
    return this.prisma.project.findUnique({
      where: { id },
      include: { users: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async findUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async assignUserToProject(userId: string, projectId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { projectId },
    });
  }

  async removeUser(userId: string): Promise<void> {
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
