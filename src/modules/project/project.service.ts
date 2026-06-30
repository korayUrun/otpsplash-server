import type { Project } from '@prisma/client';
import { AppError } from '@errors/AppError';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { JwtPayload } from '@app-types/index';
import type {
  AddUserDTO,
  CreateProjectDTO,
  IProjectRepository,
  IProjectService,
  ProjectDetail,
  ProjectMutationResult,
  ProjectWithUsers,
  RemoveUserDTO,
} from './project.interfaces';

/**
 * Proje iş mantığı.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP) — concrete değil.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 */
export class ProjectService implements IProjectService {
  constructor(
    private readonly repository: IProjectRepository,
    private readonly logger: ILogger,
  ) {}

  async create(dto: CreateProjectDTO): Promise<Result<Project>> {
    try {
      const project = await this.repository.create({ name: dto.name });
      this.logger.info({ projectId: project.id }, 'yeni proje oluşturuldu');
      return ok(project);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async getById(
    projectId: string,
    requester: JwtPayload,
  ): Promise<Result<ProjectDetail>> {
    try {
      const project = await this.repository.findById(projectId);
      // Önce varlık (404), sonra üyelik (403): "olmayan → 404, başka proje → 403".
      if (!project) {
        return fail(
          new NotFoundError('Proje bulunamadı', ErrorCode.PROJECT_NOT_FOUND),
        );
      }
      // Proje izolasyonu: yalnızca projenin üyesi görebilir.
      if (requester.projectId !== projectId) {
        return fail(new AuthorizationError('Bu projeye erişim yetkiniz yok'));
      }
      return ok(this.toDetail(project));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async addUser(dto: AddUserDTO): Promise<Result<ProjectMutationResult>> {
    try {
      const project = await this.repository.findById(dto.projectId);
      if (!project) {
        return fail(
          new NotFoundError('Proje bulunamadı', ErrorCode.PROJECT_NOT_FOUND),
        );
      }

      const user = await this.repository.findUserById(dto.userId);
      if (!user) {
        return fail(
          new NotFoundError('Kullanıcı bulunamadı', ErrorCode.USER_NOT_FOUND),
        );
      }
      if (user.projectId === dto.projectId) {
        return fail(new ConflictError('Kullanıcı zaten bu projenin üyesi'));
      }

      await this.repository.assignUserToProject(dto.userId, dto.projectId);
      this.logger.info(
        { projectId: dto.projectId, userId: dto.userId },
        'kullanıcı projeye eklendi',
      );
      return ok({ message: 'Kullanıcı projeye eklendi' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async removeUser(dto: RemoveUserDTO): Promise<Result<ProjectMutationResult>> {
    try {
      const user = await this.repository.findUserById(dto.userId);
      // Kullanıcı yoksa veya bu projeye ait değilse → "projede yok" (404).
      if (!user || user.projectId !== dto.projectId) {
        return fail(
          new NotFoundError(
            'Kullanıcı bu projede bulunamadı',
            ErrorCode.USER_NOT_FOUND,
          ),
        );
      }

      await this.repository.removeUser(dto.userId);
      this.logger.info(
        { projectId: dto.projectId, userId: dto.userId },
        'kullanıcı projeden çıkarıldı',
      );
      return ok({ message: 'Kullanıcı projeden çıkarıldı' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  /** Prisma projesini parolasız client görünümüne çevirir (password sızdırılmaz). */
  private toDetail(project: ProjectWithUsers): ProjectDetail {
    return {
      id: project.id,
      name: project.name,
      apiKey: project.apiKey,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      users: project.users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      })),
    };
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
