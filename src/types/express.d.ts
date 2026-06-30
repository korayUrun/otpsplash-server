import type { DevicePayload, JwtPayload } from './index';

/**
 * Express `Request` augmentation.
 * - `id`     → requestId middleware tarafından atanan request UUID'si.
 * - `user`   → authenticate middleware'inden sonra dolu olan kullanıcı kimliği (JWT).
 * - `device` → deviceAuth middleware'inden sonra dolu olan cihaz kimliği (Device Secret).
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: JwtPayload;
      device?: DevicePayload;
    }
  }
}

export {};
