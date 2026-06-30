import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import { AppError } from '@errors/AppError';
import {
  AuthorizationError,
  NotFoundError,
  OtpParseError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { PaginatedResult } from '@app-types/index';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  GetHistoryDTO,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpParser,
  IOtpRepository,
  IOtpService,
  OtpHistoryItem,
  ProcessOtpDTO,
  ProcessOtpResult,
  SharingTargetsResult,
  ToggleSharingResult,
} from './otp.interfaces';

/**
 * OTP iş mantığı.
 * Akış: parse (SYNC) → encrypt (SYNC) → DB kaydet (AWAIT) → routing çöz (AWAIT) → emit (SYNC).
 * DB hatasında emit YAPILMAZ (kayıt → bildirim sırası garanti).
 * FAZ 7: hedef kitle artık tüm proje değil, routing resolver'ın belirlediği developer'lardır.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP).
 */
export class OtpService implements IOtpService {
  constructor(
    private readonly parser: IOtpParser,
    private readonly encryptor: IOtpEncryptor,
    private readonly repository: IOtpRepository,
    private readonly notifier: IOtpNotifier,
    private readonly routingResolver: IRoutingResolver,
    private readonly logger: ILogger,
  ) {}

  async processAndDeliver(
    dto: ProcessOtpDTO,
  ): Promise<Result<ProcessOtpResult>> {
    try {
      const code = this.resolveCode(dto);
      if (!code) {
        return fail(new OtpParseError());
      }

      // 1) Şifrele (SYNC) — DB'ye asla düz kod yazılmaz.
      const encryptedCode = this.encryptor.encrypt(code);

      // 2) Kalıcılaştır (AWAIT). receiverId sahiplik kaynağıdır (deviceId'den bağımsız).
      const expiresAt = new Date(
        Date.now() + env.OTP_TTL_DAYS * CONSTANTS.TIME.DAY_MS,
      );
      const saved = await this.repository.save({
        encryptedCode,
        source: dto.source,
        projectId: dto.projectId,
        deviceId: dto.deviceId,
        receiverId: dto.receiverId,
        serviceId: dto.serviceId,
        expiresAt,
      });

      // 3) Routing: hedef developer'ları çöz (AWAIT). Kural yoksa boş liste → kimseye gitmez.
      const targetUserIds = await this.routingResolver.resolveTargets(
        dto.receiverId,
        dto.serviceId ?? null,
      );

      // 4) Yalnızca kayıt başarılıysa hedeflere anlık yayınla (SYNC).
      const deliveredTo = this.notifier.notify(targetUserIds, {
        id: saved.id,
        code,
        source: saved.source,
        createdAt: saved.createdAt,
      });

      this.logger.info(
        {
          otpId: saved.id,
          projectId: dto.projectId,
          source: dto.source,
          serviceId: dto.serviceId ?? null,
          deliveredTo,
        },
        'OTP işlendi ve iletildi',
      );

      return ok({ message: 'OTP iletildi', deliveredTo });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async getHistory(
    dto: GetHistoryDTO,
  ): Promise<Result<PaginatedResult<OtpHistoryItem>>> {
    try {
      const page = await this.repository.findByProject(dto.projectId, {
        page: dto.page,
        limit: dto.limit,
      });

      // Şifre çözme SYNC — map içinde her kayıt için uygulanır.
      const items: OtpHistoryItem[] = page.items.map((log) => ({
        id: log.id,
        code: this.encryptor.decrypt(log.encryptedCode),
        source: log.source,
        createdAt: log.createdAt,
        expiresAt: log.expiresAt,
      }));

      return ok({ items, pagination: page.pagination });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async toggleSharing(
    otpId: string,
    receiverId: string,
    isActive: boolean,
  ): Promise<Result<ToggleSharingResult>> {
    try {
      const otp = await this.repository.findById(otpId);
      if (!otp) {
        return fail(
          new NotFoundError('OTP bulunamadı', ErrorCode.NOT_FOUND),
        );
      }
      // Sahiplik doğrudan receiverId üzerinden — cihaz silinmiş (deviceId null) olsa bile geçerli.
      if (otp.receiverId !== receiverId) {
        return fail(new AuthorizationError('Bu OTP üzerinde yetkiniz yok'));
      }

      await this.repository.updateSharingActive(otpId, isActive);

      // Paylaşım durdurulduysa: hedefleri yeniden çöz ve developer ekranına revoked sinyali gönder.
      // Fire-and-forget (SYNC) — response'u bekletmez; geçmişe etkimez, yalnızca UI senkronizasyonu.
      if (!isActive) {
        const targetUserIds = await this.routingResolver.resolveTargets(
          otp.receiverId,
          otp.serviceId,
        );
        this.notifier.notifyRevoked(otpId, targetUserIds);
      }

      this.logger.info(
        { otpId, receiverId, sharingActive: isActive },
        'OTP paylaşım durumu güncellendi',
      );
      return ok({ sharingActive: isActive });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async getSharingTargets(
    otpId: string,
    receiverId: string,
  ): Promise<Result<SharingTargetsResult>> {
    try {
      const otp = await this.repository.findById(otpId);
      if (!otp) {
        return fail(
          new NotFoundError('OTP bulunamadı', ErrorCode.NOT_FOUND),
        );
      }
      if (otp.receiverId !== receiverId) {
        return fail(new AuthorizationError('Bu OTP üzerinde yetkiniz yok'));
      }

      const targets = await this.routingResolver.resolveTargetDetails(
        otp.receiverId,
        otp.serviceId,
      );
      return ok({ targets });
    } catch (error) {
      return this.toResult(error);
    }
  }

  /**
   * Giriş kodunu belirler: açık `code` öncelikli (doğrulanır), yoksa `smsText`'ten
   * parse edilir. Geçerli kod yoksa `null`.
   *
   * @remarks FAZ 8'de parse cihaza taşınınca bu adım kalkar; FAZ 7'de hâlâ backend parse eder.
   */
  private resolveCode(dto: ProcessOtpDTO): string | null {
    if (dto.code !== undefined) {
      return this.parser.validate(dto.code) ? dto.code : null;
    }
    if (dto.smsText !== undefined) {
      return this.parser.extract(dto.smsText);
    }
    return null;
  }

  /**
   * Beklenen AppError'ları Result.fail'e çevirir; beklenmeyen (DB vb.) hataları
   * errorHandler'a iletmek için yeniden fırlatır (auth.service ile aynı desen).
   */
  private toResult(error: unknown): Result<never> {
    if (error instanceof AppError) {
      return fail(error);
    }
    throw error;
  }
}
