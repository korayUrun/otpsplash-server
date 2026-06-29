import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import { tokenService } from '@modules/auth/token.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Access token doğrulama middleware'i.
 * `Authorization: Bearer <token>` başlığını okur, access token'ı doğrular
 * ve `req.user`'ı doldurur. Başlık yoksa/biçimsizse veya token geçersizse
 * `AuthenticationError` (401) ile reddeder.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(new AuthenticationError('Yetkilendirme başlığı eksik veya geçersiz'));
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  // verifyAccessToken süresi dolmuş/geçersiz token'da AuthenticationError fırlatır.
  req.user = tokenService.verifyAccessToken(token);
  next();
}
