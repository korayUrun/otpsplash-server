import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import { AppError } from '@errors/AppError';
import { AuthorizationError, NotFoundError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { PaginatedResult } from '@app-types/index';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  IServiceResolver,
  IUnmatchedRecorder,
} from '@modules/service-registry/registry.interfaces';
import type {
  GetHistoryDTO,
  GetReceiverHistoryDTO,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpRepository,
  IOtpService,
  OtpHistoryItem,
  ProcessOtpDTO,
  ProcessOtpResult,
  ReceiverOtpHistoryItem,
  SharingTargetsResult,
  ToggleSharingResult,
} from './otp.interfaces';

/**
 * OTP iş mantığı.
 * Akış (FAZ 8): servis çözümle (AWAIT, cache'li) → encrypt (SYNC) → DB kaydet (AWAIT) →
 * routing çöz (AWAIT) → emit (SYNC). DB hatasında emit YAPILMAZ (kayıt → bildirim sırası garanti).
 * Parse/validate adımı YOKTUR — `code` cihazda parse edilir, format Zod'da doğrulanır (DRY).
 * Hedef kitle routing resolver'ın belirlediği developer'lardır (FAZ 7).
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP).
 */
export class OtpService implements IOtpService {
  constructor(
    private readonly encryptor: IOtpEncryptor,
    private readonly repository: IOtpRepository,
    private readonly notifier: IOtpNotifier,
    private readonly routingResolver: IRoutingResolver,
    private readonly serviceResolver: IServiceResolver,
    private readonly unmatchedRecorder: IUnmatchedRecorder,
    private readonly logger: ILogger,
  ) {}

  async processAndDeliver(
    dto: ProcessOtpDTO,
  ): Promise<Result<ProcessOtpResult>> {
    try {
      // 1) Servis çözümle (cache'li — dışarıdan her zaman await). Çözülemezse kova'ya
      //    fire-and-forget yaz ve serviceId: null ile devam et (OTP yine kaydedilir).
      const serviceId = await this.serviceResolver.resolve(
        dto.projectId,
        dto.senderRaw,
        dto.serviceHint,
      );
      if (serviceId === null) {
        this.recordUnmatchedSafely(dto.projectId, dto.senderRaw);
      }

      // 2) Şifrele (SYNC) — DB'ye asla düz kod yazılmaz. Format Zod'da doğrulandı, tekrar etme.
      const encryptedCode = this.encryptor.encrypt(dto.code);

      // 3) Kalıcılaştır (AWAIT). receiverId sahiplik kaynağıdır (deviceId'den bağımsız).
      const expiresAt = new Date(
        Date.now() + env.OTP_TTL_DAYS * CONSTANTS.TIME.DAY_MS,
      );
      const saved = await this.repository.save({
        encryptedCode,
        source: dto.source,
        projectId: dto.projectId,
        deviceId: dto.deviceId,
        receiverId: dto.receiverId,
        serviceId: serviceId ?? undefined,
        expiresAt,
      });

      // 4) Routing: hedef developer'ları çöz (AWAIT). Kural/servis yoksa boş liste → kimseye gitmez.
      const targetUserIds = await this.routingResolver.resolveTargets(
        dto.receiverId,
        serviceId,
      );

      // 5) Yalnızca kayıt başarılıysa hedeflere anlık yayınla (SYNC).
      const deliveredTo = this.notifier.notify(targetUserIds, {
        id: saved.id,
        code: dto.code,
        source: saved.source,
        createdAt: saved.createdAt,
      });

      this.logger.info(
        {
          otpId: saved.id,
          projectId: dto.projectId,
          source: dto.source,
          serviceId,
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

  async getReceiverHistory(
    dto: GetReceiverHistoryDTO,
  ): Promise<Result<PaginatedResult<ReceiverOtpHistoryItem>>> {
    try {
      // findByProject'in AKSİNE: expired + sharing-off DAHİL — receiver kendi kodlarını yönetir.
      const page = await this.repository.findByReceiver(dto.receiverId, {
        page: dto.page,
        limit: dto.limit,
      });

      // Şifre çözme SYNC — her kayıt için map içinde.
      const items: ReceiverOtpHistoryItem[] = page.items.map((log) => ({
        id: log.id,
        code: this.encryptor.decrypt(log.encryptedCode),
        source: log.source,
        createdAt: log.createdAt,
        expiresAt: log.expiresAt,
        sharingActive: log.sharingActive,
        serviceName: log.service?.name ?? null,
        deviceName: log.device?.deviceName ?? null,
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
   * Eşleşmeyen `senderRaw`'ı kova satırına fire-and-forget yazar.
   * OTP işleme yolunu BLOKLAMAZ (response'u bekletmez); hata yalnızca loglanır,
   * OTP'nin kendisinin kaydedilmesini/iletilmesini etkilemez.
   */
  private recordUnmatchedSafely(projectId: string, senderRaw: string): void {
    void this.unmatchedRecorder
      .recordUnmatched(projectId, senderRaw)
      .catch((error: unknown) => {
        this.logger.error(
          { error, projectId },
          'eşleşmeyen sinyal kova kaydı başarısız',
        );
      });
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
