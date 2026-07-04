import { Prisma, Role, RoutingTarget, type RoutingRule } from '@prisma/client';
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
  CreateRoutingRuleDTO,
  DeleteRuleDTO,
  IRoutingRepository,
  IRoutingService,
  RoutingMutationResult,
  RoutingRuleView,
  RoutingRuleWithRelations,
  ToggleRuleDTO,
} from './routing.interfaces';

/** PostgreSQL unique violation kodu (partial unique index DB seviyesi koruma). */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Yönlendirme kuralı iş mantığı.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP) — concrete değil.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 */
export class RoutingService implements IRoutingService {
  constructor(
    private readonly repository: IRoutingRepository,
    private readonly logger: ILogger,
  ) {}

  async createRule(dto: CreateRoutingRuleDTO): Promise<Result<RoutingRule>> {
    try {
      // 1) Receiver gerçekten RECEIVER mı ve projede mi?
      const receiver = await this.repository.findUserById(dto.receiverId);
      if (!receiver || receiver.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Receiver bulunamadı', ErrorCode.USER_NOT_FOUND),
        );
      }
      if (receiver.role !== Role.RECEIVER) {
        return fail(
          new ValidationError('Kural hedefi yalnızca RECEIVER olabilir'),
        );
      }

      // 2) Hedef doğrulama + çakışma kontrolü (hedef tipine göre).
      const targetCheck = await this.validateTarget(dto);
      if (!targetCheck.success) {
        return targetCheck;
      }

      // 3) Oluştur — DB partial unique index P2002 da yakalanır (çift katmanlı koruma).
      const rule = await this.repository.create({
        receiverId: dto.receiverId,
        targetType: dto.targetType,
        developerId:
          dto.targetType === RoutingTarget.DEVELOPER ? dto.developerId ?? null : null,
        groupId: dto.targetType === RoutingTarget.GROUP ? dto.groupId ?? null : null,
      });

      this.logger.info(
        {
          ruleId: rule.id,
          receiverId: dto.receiverId,
          targetType: dto.targetType,
        },
        'yönlendirme kuralı oluşturuldu',
      );
      return ok(rule);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        return fail(
          new ConflictError(
            'Bu kural zaten mevcut',
            ErrorCode.ROUTING_RULE_CONFLICT,
          ),
        );
      }
      return this.toResult(error);
    }
  }

  async toggleRule(dto: ToggleRuleDTO): Promise<Result<RoutingRule>> {
    try {
      const owned = await this.findOwnedRule(dto.id, dto.projectId);
      if (!owned.success) {
        return owned;
      }
      const updated = await this.repository.toggle(dto.id, dto.isActive);
      this.logger.info(
        { ruleId: dto.id, isActive: dto.isActive },
        'yönlendirme kuralı güncellendi',
      );
      return ok(updated);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async deleteRule(dto: DeleteRuleDTO): Promise<Result<RoutingMutationResult>> {
    try {
      const owned = await this.findOwnedRule(dto.id, dto.projectId);
      if (!owned.success) {
        return owned;
      }
      await this.repository.delete(dto.id);
      this.logger.info({ ruleId: dto.id }, 'yönlendirme kuralı silindi');
      return ok({ message: 'Kural silindi' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async listByProject(projectId: string): Promise<Result<RoutingRuleView[]>> {
    try {
      const rules = await this.repository.listByProject(projectId);
      return ok(await this.buildViews(rules));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async listForReceiver(receiverId: string): Promise<Result<RoutingRuleView[]>> {
    try {
      const rules = await this.repository.listByReceiver(receiverId);
      return ok(await this.buildViews(rules));
    } catch (error) {
      return this.toResult(error);
    }
  }

  /**
   * Hedef (developer/grup) doğrulaması + servis katmanı çakışma kontrolü.
   * Başarılıysa `ok` (boş), aksi halde uygun hatayı taşıyan `fail` döner.
   */
  private async validateTarget(
    dto: CreateRoutingRuleDTO,
  ): Promise<Result<true>> {
    if (dto.targetType === RoutingTarget.DEVELOPER) {
      // Zod zaten developerId zorunluluğunu garanti eder; defansif kontrol.
      if (!dto.developerId) {
        return fail(new ValidationError('developerId zorunlu'));
      }
      const developer = await this.repository.findUserById(dto.developerId);
      if (!developer || developer.projectId !== dto.projectId) {
        return fail(
          new NotFoundError('Developer bulunamadı', ErrorCode.USER_NOT_FOUND),
        );
      }
      if (developer.role !== Role.DEVELOPER) {
        return fail(
          new ValidationError('Hedef yalnızca DEVELOPER rolünde olabilir'),
        );
      }
      const existing = await this.repository.findDeveloperRule(
        dto.receiverId,
        dto.developerId,
      );
      if (existing) {
        return fail(
          new ConflictError(
            'Bu (receiver, developer) kuralı zaten mevcut',
            ErrorCode.ROUTING_RULE_CONFLICT,
          ),
        );
      }
      return ok(true);
    }

    // GROUP
    if (!dto.groupId) {
      return fail(new ValidationError('groupId zorunlu'));
    }
    const group = await this.repository.findGroupById(dto.groupId);
    if (!group || group.projectId !== dto.projectId) {
      return fail(
        new NotFoundError('Grup bulunamadı', ErrorCode.GROUP_NOT_FOUND),
      );
    }
    const existing = await this.repository.findGroupRule(
      dto.receiverId,
      dto.groupId,
    );
    if (existing) {
      return fail(
        new ConflictError(
          'Bu (receiver, grup) kuralı zaten mevcut',
          ErrorCode.ROUTING_RULE_CONFLICT,
        ),
      );
    }
    return ok(true);
  }

  /**
   * Kuralı getirir ve admin'in projesine ait olduğunu doğrular.
   * Yoksa veya başka projedeyse → ROUTING_RULE_NOT_FOUND (sızdırma yok).
   */
  private async findOwnedRule(
    id: string,
    projectId: string,
  ): Promise<Result<RoutingRule>> {
    const rule = await this.repository.findById(id);
    if (!rule) {
      return fail(
        new NotFoundError('Kural bulunamadı', ErrorCode.ROUTING_RULE_NOT_FOUND),
      );
    }
    // Kuralın projesi receiver üzerinden belirlenir.
    const receiver = await this.repository.findUserById(rule.receiverId);
    if (!receiver || receiver.projectId !== projectId) {
      return fail(
        new NotFoundError('Kural bulunamadı', ErrorCode.ROUTING_RULE_NOT_FOUND),
      );
    }
    return ok(rule);
  }

  /**
   * Kuralları görünüme çevirir. `developerId` düz kolon olduğundan (Prisma ilişkisi yok),
   * developer e-postaları tek bir toplu sorguyla çekilip id→email haritasına bağlanır.
   */
  private async buildViews(
    rules: RoutingRuleWithRelations[],
  ): Promise<RoutingRuleView[]> {
    const developerIds = rules
      .map((rule) => rule.developerId)
      .filter((id): id is string => id !== null);
    const developers = await this.repository.findUsersByIds(developerIds);
    const emailById = new Map(developers.map((dev) => [dev.id, dev.email]));

    return rules.map((rule) => ({
      id: rule.id,
      receiverId: rule.receiverId,
      receiverEmail: rule.receiver.email,
      targetType: rule.targetType,
      developerId: rule.developerId,
      developerEmail: rule.developerId
        ? emailById.get(rule.developerId) ?? null
        : null,
      groupId: rule.groupId,
      groupName: rule.group?.name ?? null,
      isActive: rule.isActive,
      createdAt: rule.createdAt,
    }));
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
