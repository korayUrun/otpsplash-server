import type { JwtPayload } from './index';

/**
 * Express `Request` augmentation.
 * - `id`   → requestId middleware tarafından atanan request UUID'si.
 * - `user` → authenticate middleware'inden sonra dolu olan kimlik bilgisi.
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: JwtPayload;
    }
  }
}

export {};
