import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import { AppError } from '@errors/AppError';
import { OtpParseError } from '@errors/errors';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { PaginatedResult } from '@app-types/index';
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
} from './otp.interfaces';

/**
 * OTP iş mantığı.
 * Akış: parse (SYNC) → validate → encrypt (SYNC) → DB kaydet (AWAIT) → emit (SYNC).
 * DB hatasında emit YAPILMAZ (kayıt → bildirim sırası garanti).
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP).
 */
export class OtpService implements IOtpService {
  constructor(
    private readonly parser: IOtpParser,
    private readonly encryptor: IOtpEncryptor,
    private readonly repository: IOtpRepository,
    private readonly notifier: IOtpNotifier,
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

      // 2) Kalıcılaştır (AWAIT). Hata olursa aşağıdaki emit'e geçilmez.
      const expiresAt = new Date(
        Date.now() + env.OTP_TTL_DAYS * CONSTANTS.TIME.DAY_MS,
      );
      const saved = await this.repository.save({
        encryptedCode,
        source: dto.source,
        projectId: dto.projectId,
        deviceId: dto.deviceId,
        expiresAt,
      });

      // 3) Yalnızca kayıt başarılıysa anlık yayınla (SYNC).
      const deliveredTo = this.notifier.notify(dto.projectId, {
        id: saved.id,
        code,
        source: saved.source,
        createdAt: saved.createdAt,
      });

      this.logger.info(
        { otpId: saved.id, projectId: dto.projectId, source: dto.source, deliveredTo },
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

  /**
   * Giriş kodunu belirler: açık `code` öncelikli (doğrulanır), yoksa `smsText`'ten
   * parse edilir. Geçerli kod yoksa `null`.
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
