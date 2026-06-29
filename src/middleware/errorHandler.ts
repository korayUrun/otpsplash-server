import type { NextFunction, Request, Response } from 'express';
import { AppError } from '@errors/AppError';
import { ErrorCode } from '@errors/ErrorCode';
import { logger } from '@infrastructure/logger';

/**
 * Global hata yöneticisi. Tüm hatalar standart zarfla döner:
 * `{ success: false, error: { code, message }, requestId }`.
 *
 * - `AppError` (beklenen): kendi statusCode/errorCode/message'ı ile döner.
 *   isOperational=false ise error, true ise warn seviyesinde loglanır.
 * - Diğer (beklenmeyen) hatalar: 500 INTERNAL_ERROR; mesaj/stack client'a sızdırılmaz.
 *
 * @remarks 4 parametreli imza Express'in bunu error handler olarak tanıması için zorunlu.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.id;

  if (err instanceof AppError) {
    if (err.isOperational) {
      logger.warn(
        { requestId, code: err.errorCode, msg: err.message },
        'işlenmiş hata',
      );
    } else {
      logger.error(
        { requestId, code: err.errorCode, err },
        'operasyonel olmayan hata',
      );
    }

    res.status(err.statusCode).json({
      success: false,
      error: { code: err.errorCode, message: err.message },
      requestId,
    });
    return;
  }

  // Beklenmeyen hata: detay loglanır, client'a genel mesaj döner.
  logger.error({ requestId, err }, 'beklenmeyen hata');
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Beklenmeyen bir hata oluştu',
    },
    requestId,
  });
}
