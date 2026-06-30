import type { NextFunction, Request, Response } from 'express';
import { CONSTANTS } from '@config/constants';
import { DeviceAuthError } from '@errors/errors';
import { logger } from '@infrastructure/logger';
import { deviceService } from '@modules/device/device.service';

/**
 * Device Secret doğrulama middleware'i (`POST /api/otp`).
 *
 * `X-Device-Secret` başlığını okur, `deviceService.verify` ile cihazı doğrular ve
 * `req.device`'ı doldurur. Başlık yoksa → DEVICE_SECRET_INVALID, eşleşme yoksa →
 * DEVICE_SECRET_INVALID, revoke edilmişse → DEVICE_REVOKED (hepsi 401).
 *
 * JWT'den bağımsızdır: arka planda aylarca çalışan Android/iOS otomasyonları içindir.
 * Beklenmeyen (DB) hatalar throw eder; route'ta `asyncHandler` ile errorHandler'a iletilir.
 */
export async function deviceAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers[CONSTANTS.DEVICE.SECRET_HEADER];
  const secret = Array.isArray(header) ? header[0] : header;

  if (typeof secret !== 'string' || secret.length === 0) {
    next(new DeviceAuthError('Cihaz secret başlığı eksik'));
    return;
  }

  const result = await deviceService.verify(secret);
  if (!result.success) {
    next(result.error);
    return;
  }

  req.device = result.data;

  // Son kullanım zamanını fire-and-forget güncelle — response'u bekletmesin.
  void deviceService.touch(result.data.id).catch((error: unknown) => {
    logger.error({ error, deviceId: result.data.id }, 'lastUsedAt güncellenemedi');
  });

  next();
}
