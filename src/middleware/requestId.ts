import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Yanıt başlığında dönen request id alanı. */
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Her request'e benzersiz bir UUID atar (`req.id`) ve aynı değeri
 * `x-request-id` yanıt başlığında döner. İlk middleware olmalı ki
 * sonraki loglar ve hata yanıtları requestId taşıyabilsin.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.id = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
