import { Role, type Group } from '@prisma/client';
import { AppError } from '@errors/AppError';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type {
  AddMemberDTO,
  CreateGroupDTO,
  GroupMutationResult,
  GroupView,
  IGroupRepository,
  IGroupService,
  RemoveMemberDTO,
} from './group.interfaces';

/**
 * Grup iş mantığı.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP) — concrete değil.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 */
export class GroupService implements IGroupService {
  constructor(
    private readonly repository: IGroupRepository,
    private readonly logger: ILogger,
  ) {}

  async create(dto: CreateGroupDTO): Promise<Result<Group>> {
    try {
      const group = await this.repository.create({
        name: dto.name,
        projectId: dto.projectId,
      });
      this.logger.info(
        { groupId: group.id, projectId: dto.projectId },
        'yeni grup oluşturuldu',
      );
      return ok(group);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async addMember(dto: AddMemberDTO): Promise<Result<GroupMutationResult>> {
    try {
      // Grup admin'in projesinde mi? (yoksa/başka projede → 404, sızdırma yok)
      const group = await this.repository.findById(dto.groupId);
      if (!group || group.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Grup bulunamadı', ErrorCode.GROUP_NOT_FOUND),
        );
      }

      const user = await this.repository.findUserById(dto.userId);
      if (!user || user.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Kullanıcı bulunamadı', ErrorCode.USER_NOT_FOUND),
        );
      }
      // Yalnızca DEVELOPER gruba eklenebilir (gruplar dağıtım hedefidir).
      if (user.role !== Role.DEVELOPER) {
        return fail(
          new ValidationError('Yalnızca DEVELOPER rolü gruba eklenebilir'),
        );
      }

      const existing = await this.repository.findMember(dto.groupId, dto.userId);
      if (existing) {
        return fail(new ConflictError('Kullanıcı zaten bu grubun üyesi'));
      }

      await this.repository.addMember(dto.groupId, dto.userId);
      this.logger.info(
        { groupId: dto.groupId, userId: dto.userId },
        'gruba üye eklendi',
      );
      return ok({ message: 'Üye gruba eklendi' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async removeMember(
    dto: RemoveMemberDTO,
  ): Promise<Result<GroupMutationResult>> {
    try {
      const group = await this.repository.findById(dto.groupId);
      if (!group || group.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Grup bulunamadı', ErrorCode.GROUP_NOT_FOUND),
        );
      }

      const member = await this.repository.findMember(dto.groupId, dto.userId);
      if (!member) {
        return fail(
          new NotFoundError(
            'Kullanıcı bu grubun üyesi değil',
            ErrorCode.USER_NOT_FOUND,
          ),
        );
      }

      await this.repository.removeMember(dto.groupId, dto.userId);
      this.logger.info(
        { groupId: dto.groupId, userId: dto.userId },
        'gruptan üye çıkarıldı',
      );
      return ok({ message: 'Üye gruptan çıkarıldı' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async listForProject(projectId: string): Promise<Result<GroupView[]>> {
    try {
      const groups = await this.repository.findByProject(projectId);
      const views: GroupView[] = groups.map((group) => ({
        id: group.id,
        name: group.name,
        createdAt: group.createdAt,
        members: group.members.map((member) => ({
          userId: member.userId,
          email: member.user.email,
          name: member.user.name,
        })),
      }));
      return ok(views);
    } catch (error) {
      return this.toResult(error);
    }
  }

  /**
   * Beklenen AppError'ları Result.fail'e çevirir; beklenmeyen hataları
   * (DB bağlantısı vb.) errorHandler'a iletmek için yeniden fırlatır.
   */
  private toResult(error: unknown): Result<never> {
    if (error instanceof AppError) {
      return fail(error);
    }
    throw error;
  }
}
