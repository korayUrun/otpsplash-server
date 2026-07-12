import type { Device, User } from '@prisma/client';
import { AppError } from '@errors/AppError';
import { AuthorizationError, NotFoundError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { PaginatedResult } from '@app-types/index';
import type { IRoutingResolver } from '@modules/routing/routing.interfaces';
import type {
  DismissOtpsResult,
  GetAllOtpDTO,
  GetHistoryDTO,
  GetReceiverHistoryDTO,
  IOtpEncryptor,
  IOtpNotifier,
  IOtpRepository,
  IOtpService,
  OtpDeviceInfo,
  OtpHistoryItem,
  OtpLogWithRelations,
  OtpNotification,
  OtpReceiverInfo,
  ProcessOtpDTO,
  ProcessOtpResult,
  ReceiverOtpHistoryItem,
  SharingTargetsResult,
  ToggleSharingResult,
} from './otp.interfaces';

/**
 * OTP iş mantığı.
 * Akış: encrypt (SYNC) → DB kaydet (AWAIT) → routing çöz (AWAIT) → emit (SYNC).
 * DB hatasında emit YAPILMAZ (kayıt → bildirim sırası garanti). Servis çözümleme YOKTUR —
 * kural artık receiver bazlıdır. Parse/validate adımı da YOKTUR — `code` cihazda parse edilir,
 * format Zod'da doğrulanır (DRY). Bağımlılıklar interface üzerinden enjekte edilir (DIP).
 */
export class OtpService implements IOtpService {
  constructor(
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
      // 1) Şifrele (SYNC) — DB'ye asla düz kod yazılmaz. Format Zod'da doğrulandı, tekrar etme.
      const encryptedCode = this.encryptor.encrypt(dto.code);

      // 2) Kalıcılaştır (AWAIT). receiverId sahiplik kaynağıdır (deviceId'den bağımsız).
      //    OTP SÜRESİZDİR — expiresAt yok, otomatik silme yok. Kayıt receiver + device
      //    ilişkileriyle döner (emit payload'ı için).
      const saved = await this.repository.save({
        encryptedCode,
        source: dto.source,
        projectId: dto.projectId,
        deviceId: dto.deviceId,
        receiverId: dto.receiverId,
        senderRaw: dto.senderRaw,
        context: dto.context,
      });

      // 3) Routing: hedef developer'ları çöz (AWAIT). Kural yoksa boş liste → kimseye gitmez.
      const targetUserIds = await this.routingResolver.resolveTargets(
        dto.receiverId,
      );

      // 4) Yalnızca kayıt başarılıysa anlık yayınla (SYNC). Payload bir kez kurulur:
      //    düz kod + senderRaw etiketi + createdAt (ne zaman geldi) + receiver/device kimliği.
      const payload: OtpNotification = {
        id: saved.id,
        code: dto.code,
        source: saved.source,
        createdAt: saved.createdAt,
        sharingActive: saved.sharingActive,
        senderRaw: dto.senderRaw,
        context: saved.context,
        receiver: this.toReceiverInfo(saved.receiver),
        device: this.toDeviceInfo(saved.device),
      };
      // 4a) Routing hedefi developer'lara yayınla — dönen sayı "deliveredTo".
      const deliveredTo = this.notifier.notify(targetUserIds, payload);
      // 4b) Sahibi receiver'ın kendi odasına da yayınla (routing'den bağımsız, deliveredTo'yu
      //     etkilemez) — receiver kendi geçmişinde yeni kodu anında, refresh'siz görür.
      this.notifier.notifyReceiver(dto.receiverId, payload);
      // 4c) Projenin admin odasına da yayınla — admin Özet ekranı canlı güncellenir
      //     (deliveredTo'yu etkilemez; admin özeti routing'den bağımsız ve filtresizdir).
      this.notifier.notifyAdmins(dto.projectId, payload);

      this.logger.info(
        {
          otpId: saved.id,
          projectId: dto.projectId,
          source: dto.source,
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
      // Canlı emit'le aynı routing çözümü: developer yalnızca kendisine (doğrudan) veya
      // üye olduğu gruba yönlendirilen aktif kuralların kapsadığı receiver'ların kodlarını görür
      // — ve her receiver için yalnızca LINK'ten (`linkedAt`) sonra gelen kodları (sonradan
      // bağlanan developer geçmişi göremez). Kural yoksa → boş kapsam → DB'ye gitmeden boş feed.
      const receivers = await this.routingResolver.resolveVisibleReceivers(
        dto.developerId,
      );
      if (receivers.length === 0) {
        return ok(this.emptyPage(dto.page, dto.limit));
      }

      const page = await this.repository.findForDeveloper(
        dto.projectId,
        dto.developerId,
        receivers,
        { page: dto.page, limit: dto.limit },
      );

      return ok({
        items: page.items.map((log) => this.toHistoryItem(log)),
        pagination: page.pagination,
      });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async getAllForProject(
    dto: GetAllOtpDTO,
  ): Promise<Result<PaginatedResult<OtpHistoryItem>>> {
    try {
      // Admin özeti: projedeki tüm receiver'lardan gelen tüm OTP'ler (filtresiz, en yeni önce).
      const page = await this.repository.findAllForProject(dto.projectId, {
        page: dto.page,
        limit: dto.limit,
      });
      return ok({
        items: page.items.map((log) => this.toHistoryItem(log)),
        pagination: page.pagination,
      });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async dismissForDeveloper(
    developerId: string,
    projectId: string,
    otpIds: string[],
  ): Promise<Result<DismissOtpsResult>> {
    try {
      const dismissed = await this.repository.dismissForDeveloper(
        projectId,
        developerId,
        otpIds,
      );
      this.logger.info(
        { developerId, requested: otpIds.length, dismissed },
        'developer OTP\'leri kendi feed\'inden kaldırdı',
      );
      return ok({ dismissed });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async getReceiverHistory(
    dto: GetReceiverHistoryDTO,
  ): Promise<Result<PaginatedResult<ReceiverOtpHistoryItem>>> {
    try {
      // findForDeveloper'ın AKSİNE: expired + sharing-off DAHİL — receiver kendi kodlarını yönetir.
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
        sharingActive: log.sharingActive,
        senderRaw: log.senderRaw,
        context: log.context,
        receiver: this.toReceiverInfo(log.receiver),
        device: this.toDeviceInfo(log.device),
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
      );
      return ok({ targets });
    } catch (error) {
      return this.toResult(error);
    }
  }

  /** OTPLog satırını client görünümüne çevirir (kod çözülür; developer + admin ortak kullanır). */
  private toHistoryItem(log: OtpLogWithRelations): OtpHistoryItem {
    return {
      id: log.id,
      code: this.encryptor.decrypt(log.encryptedCode),
      source: log.source,
      createdAt: log.createdAt,
      senderRaw: log.senderRaw,
      context: log.context,
      receiver: this.toReceiverInfo(log.receiver),
      device: this.toDeviceInfo(log.device),
    };
  }

  /** OTP'yi üreten receiver'ın kimlik görünümü (developer'a "kimden geldi"). */
  private toReceiverInfo(receiver: User): OtpReceiverInfo {
    return {
      name: receiver.name,
      email: receiver.email,
      phoneNumber: receiver.phoneNumber,
    };
  }

  /** Cihaz bilgisi; cihaz silinmişse (deviceId null) `null` — sahiplik korunur, ad kaybolur. */
  private toDeviceInfo(device: Device | null): OtpDeviceInfo | null {
    return device ? { name: device.deviceName } : null;
  }

  /** Hiç routing kapsamı olmayan developer için boş sayfa (DB'ye gidilmez). */
  private emptyPage<T>(page: number, limit: number): PaginatedResult<T> {
    return {
      items: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
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
