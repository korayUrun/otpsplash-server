import type { Request, Response } from 'express';
import { CONSTANTS } from '@config/constants';
import { isProduction } from '@config/env';
import type { ISenderPatternProvider } from './sender-pattern.provider';

/**
 * `GET /api/otp/sender-patterns` HTTP katmanı (SRP: yalnızca request/response).
 *
 * SÖZLEŞME NOTU: Yanıt BARE bir dizidir (`[{ name, pattern }, ...]`) — standart
 * `{ success, data, requestId }` zarfı KULLANILMAZ. Tüketici iOS Shortcut'ın JSON işleme
 * yeteneği minimaldir; düz dizi en kolay okunandır. Bu kasıtlı bir sapmadır.
 *
 * Handler saf SYNC'tir (I/O yok) — `asyncHandler` gerekmez; olası senkron throw'ları Express
 * kendisi global errorHandler'a iletir.
 */
export class SenderPatternController {
  constructor(private readonly provider: ISenderPatternProvider) {}

  list = (_req: Request, res: Response): void => {
    const patterns = this.provider.list();
    // PROD'da kısa cache; DEV/TEST'te no-store — Shortcut eski listeyi cache'leyip
    // pattern değişikliklerini gizlemesin (bkz. CONSTANTS.SENDER_PATTERN).
    res.set(
      'Cache-Control',
      isProduction()
        ? CONSTANTS.SENDER_PATTERN.CACHE_CONTROL_PROD
        : CONSTANTS.SENDER_PATTERN.CACHE_CONTROL_DEV,
    );
    res.status(200).json(patterns);
  };
}
