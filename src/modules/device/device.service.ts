import type { Device } from '@prisma/client';
import { prisma } from '@config/prisma';
import { AppError } from '@errors/AppError';
import { AuthorizationError, DeviceAuthError, NotFoundError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import { logger, type ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type { DevicePayload } from '@app-types/index';
import type {
  DeviceMutationResult,
  DeviceResult,
  IDeviceRepository,
  IDeviceService,
  ISecretService,
  RegisterDeviceDto,
  SafeDevice,
} from './device.interfaces';
import { PrismaDeviceRepository } from './device.repository';
import { secretService } from './secret.service';

/**
 * Cihaz iş mantığı.
 * Bağımlılıklar interface üzerinden enjekte edilir (DIP) — concrete değil.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 */
export class DeviceService implements IDeviceService {
  constructor(
    private readonly secretService: ISecretService,
    private readonly repository: IDeviceRepository,
    private readonly logger: ILogger,
  ) {}

  async register(dto: RegisterDeviceDto): Promise<Result<DeviceResult>> {
    try {
      // 1) Secret üret (SYNC) → 2) hash'le (AWAIT) → 3) yalnızca hash'i kalıcılaştır.
      const plainSecret = this.secretService.generate();
      const secretHash = await this.secretService.hash(plainSecret);
      const device = await this.repository.create({
        secretHash,
        platform: dto.platform,
        userId: dto.userId,
        projectId: dto.projectId,
        deviceName: dto.deviceName,
        phoneNumber: dto.phoneNumber,
      });

      this.logger.info(
        { deviceId: device.id, userId: dto.userId, platform: dto.platform },
        'yeni cihaz kaydedildi',
      );

      // Düz secret yalnızca burada döner — DB'de sadece hash var, bir daha gösterilmez.
      return ok({ deviceId: device.id, deviceSecret: plainSecret });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async verify(plainSecret: string): Promise<Result<DevicePayload>> {
    try {
      // Tüm cihazları gez; secret hash'i eşleşeni bul (5-10 cihaz için yeterli).
      const devices = await this.repository.findAllForVerification();
      for (const device of devices) {
        const matches = await this.secretService.verify(
          plainSecret,
          device.secretHash,
        );
        if (!matches) {
          continue;
        }
        // Eşleşen cihaz revoke ise farklı hata kodu (DEVICE_REVOKED).
        if (device.isRevoked) {
          return fail(
            new DeviceAuthError('Cihaz iptal edilmiş', ErrorCode.DEVICE_REVOKED),
          );
        }
        return ok(this.toPayload(device));
      }
      // Hiçbir cihazla eşleşmedi → geçersiz secret.
      return fail(new DeviceAuthError());
    } catch (error) {
      return this.toResult(error);
    }
  }

  async revoke(
    deviceId: string,
    requestingUserId: string,
  ): Promise<Result<DeviceMutationResult>> {
    try {
      const device = await this.repository.findById(deviceId);
      if (!device) {
        return fail(
          new NotFoundError('Cihaz bulunamadı', ErrorCode.DEVICE_NOT_FOUND),
        );
      }
      // Sahiplik kontrolü: yalnızca cihazın sahibi iptal edebilir.
      if (device.userId !== requestingUserId) {
        return fail(new AuthorizationError('Bu cihaza erişim yetkiniz yok'));
      }

      await this.repository.revoke(deviceId);
      this.logger.info({ deviceId, userId: requestingUserId }, 'cihaz iptal edildi');
      return ok({ message: 'Cihaz iptal edildi' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async list(userId: string): Promise<Result<SafeDevice[]>> {
    try {
      const devices = await this.repository.findByUser(userId);
      return ok(devices.map((device) => this.toSafeDevice(device)));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async touch(deviceId: string): Promise<void> {
    await this.repository.updateLastUsed(deviceId);
  }

  /** Cihazı `req.device` yüküne çevirir (auth bağlamı). */
  private toPayload(device: Device): DevicePayload {
    return {
      id: device.id,
      userId: device.userId,
      projectId: device.projectId,
      platform: device.platform,
    };
  }

  /** Cihazı dışarı dönülebilir güvenli görünüme çevirir (secretHash sızdırılmaz). */
  private toSafeDevice(device: Device): SafeDevice {
    return {
      id: device.id,
      platform: device.platform,
      deviceName: device.deviceName,
      phoneNumber: device.phoneNumber,
      isRevoked: device.isRevoked,
      lastUsedAt: device.lastUsedAt,
      createdAt: device.createdAt,
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

/**
 * Paylaşılan singleton (tokenService deseni).
 * Hem `device.routes` hem de `deviceAuth` middleware'i aynı örneği kullanır —
 * cihaz doğrulaması tek bir kompozisyon noktasından beslenir.
 */
export const deviceService: IDeviceService = new DeviceService(
  secretService,
  new PrismaDeviceRepository(prisma),
  logger,
);
