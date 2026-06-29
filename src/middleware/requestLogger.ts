import type { NextFunction, Request, Response } from 'express';
import { logger } from '@infrastructure/logger';

/** Nanosaniyeyi milisaniyeye çevirip 2 ondalığa yuvarlar. */
function toMs(nanoseconds: bigint): number {
  return Math.round(Number(nanoseconds) / 1e4) / 100;
}

/**
 * Tamamlanan her request'i tek satırda loglar:
 * method, path, status, responseTime (ms), requestId.
 * Hassas alanlar pino redact ile zaten maskelenir.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    logger.info(
      {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        responseTime: toMs(process.hrtime.bigint() - start),
      },
      'request tamamlandı',
    );
  });

  next();
}
