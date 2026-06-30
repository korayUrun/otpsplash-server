import rateLimit, { type RateLimitRequestHandler, MemoryStore } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { CONSTANTS } from '@config/constants';
import { ErrorCode } from '@errors/ErrorCode';

/**
 * Standart hata zarfıyla 429 döner (errorHandler'ı bypass eder ama aynı formatı korur).
 */
function rateLimitHandler(req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    error: {
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message: 'Çok fazla istek gönderildi, lütfen daha sonra tekrar deneyin',
    },
    requestId: req.id,
  });
}

/**
 * Store referansını ayrı tutarız ki testlerde `resetRateLimiters()` ile
 * sayaçlar temizlenebilsin (deterministik integration testleri).
 */
function buildLimiter(max: number): {
  limiter: RateLimitRequestHandler;
  store: MemoryStore;
} {
  const store = new MemoryStore();
  const limiter = rateLimit({
    windowMs: CONSTANTS.RATE_LIMIT.WINDOW_MS,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    handler: rateLimitHandler,
  });
  return { limiter, store };
}

const otp = buildLimiter(CONSTANTS.RATE_LIMIT.OTP_MAX);
const login = buildLimiter(CONSTANTS.RATE_LIMIT.LOGIN_MAX);
const register = buildLimiter(CONSTANTS.RATE_LIMIT.REGISTER_MAX);
const deviceRegister = buildLimiter(CONSTANTS.RATE_LIMIT.DEVICE_REGISTER_MAX);

/** POST /api/otp — 60/dk. */
export const otpRateLimit: RateLimitRequestHandler = otp.limiter;
/** POST /api/auth/login — 10/dk. */
export const loginRateLimit: RateLimitRequestHandler = login.limiter;
/** POST /api/auth/register — 5/dk. */
export const registerRateLimit: RateLimitRequestHandler = register.limiter;
/** POST /api/devices/register — 5/dk (auth register'dan ayrı sayaç). */
export const deviceRegisterRateLimit: RateLimitRequestHandler = deviceRegister.limiter;

/**
 * Tüm rate limit sayaçlarını sıfırlar. Yalnızca testlerde (beforeEach) kullanılır.
 */
export function resetRateLimiters(): void {
  otp.store.resetAll();
  login.store.resetAll();
  register.store.resetAll();
  deviceRegister.store.resetAll();
}
