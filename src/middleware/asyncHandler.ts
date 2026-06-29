import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Async controller'ları sarmalar: reddedilen promise'leri yakalayıp
 * `next(error)` ile global errorHandler'a iletir.
 * Express 4 async rejection'ları otomatik yakalamadığı için gereklidir.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
