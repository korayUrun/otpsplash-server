import type { ServiceRegistry } from '@prisma/client';
import { AppError } from '@errors/AppError';
import { NotFoundError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type {
  ActivateServiceRuleDTO,
  CreateServiceRuleDTO,
  IServiceRegistryRepository,
  IServiceRegistryService,
  ServiceMutationResult,
} from './registry.interfaces';

/**
 * Servis kayıt defteri iş mantığı.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP) — concrete değil.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 *
 * Not: `senderPattern`/`keywordPattern` ReDoS + uzunluk + derlenebilirlik kontrolü
 * `registry.schemas.ts`'teki Zod katmanında yapılır (hem POST hem PATCH route'unda) —
 * format doğrulaması tek yerde tutulur (DRY).
 */
export class ServiceRegistryService implements IServiceRegistryService {
  constructor(
    private readonly repository: IServiceRegistryRepository,
    private readonly logger: ILogger,
  ) {}

  async createRule(dto: CreateServiceRuleDTO): Promise<Result<ServiceRegistry>> {
    try {
      const rule = await this.repository.create({
        projectId: dto.projectId,
        name: dto.name,
        isActive: true,
        senderPattern: dto.senderPattern ?? null,
        keywordPattern: dto.keywordPattern ?? null,
        iconUrl: dto.iconUrl ?? null,
      });
      this.logger.info(
        { serviceId: rule.id, projectId: dto.projectId },
        'servis kuralı oluşturuldu',
      );
      return ok(rule);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async activateFromUnmatched(
    dto: ActivateServiceRuleDTO,
  ): Promise<Result<ServiceRegistry>> {
    try {
      const existing = await this.repository.findById(dto.id);
      // Proje sahipliği doğrulanır — başka projenin satırı sızdırılmaz.
      if (!existing || existing.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Servis kaydı bulunamadı', ErrorCode.SERVICE_NOT_FOUND),
        );
      }
      const rule = await this.repository.activate(dto.id, {
        name: dto.name,
        senderPattern: dto.senderPattern ?? null,
        keywordPattern: dto.keywordPattern ?? null,
        iconUrl: dto.iconUrl ?? existing.iconUrl,
      });
      this.logger.info(
        { serviceId: rule.id, projectId: dto.projectId },
        'kova satırı aktive edildi',
      );
      return ok(rule);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async recordUnmatched(projectId: string, senderRaw: string): Promise<void> {
    await this.repository.upsertUnmatched(projectId, senderRaw);
  }

  async deleteRule(
    id: string,
    projectId: string,
  ): Promise<Result<ServiceMutationResult>> {
    try {
      const existing = await this.repository.findById(id);
      if (!existing || existing.projectId !== projectId) {
        return fail(
          new NotFoundError('Servis kaydı bulunamadı', ErrorCode.SERVICE_NOT_FOUND),
        );
      }
      await this.repository.delete(id);
      this.logger.info({ serviceId: id, projectId }, 'servis kaydı silindi');
      return ok({ message: 'Servis kaydı silindi' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async listAll(projectId: string): Promise<Result<ServiceRegistry[]>> {
    try {
      return ok(await this.repository.findAll(projectId));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async listUnmatched(projectId: string): Promise<Result<ServiceRegistry[]>> {
    try {
      return ok(await this.repository.findUnmatched(projectId));
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
