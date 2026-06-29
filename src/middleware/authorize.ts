import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AuthenticationError, AuthorizationError } from '@errors/errors';

/**
 * Rol tabanlı yetkilendirme. `authenticate`'ten sonra kullanılır.
 * `req.user` yoksa 401, rolü izinli listede değilse 403 döner.
 *
 * @param roles İzin verilen roller
 */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AuthorizationError());
      return;
    }

    next();
  };
}
