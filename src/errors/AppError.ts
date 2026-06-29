import type { ErrorCode } from './ErrorCode';

/**
 * Tüm uygulama hatalarının soyut tabanı.
 *
 * Her somut hata şu üçünü tanımlar:
 * - `statusCode`  → HTTP yanıt kodu.
 * - `errorCode`   → makine-okunur `ErrorCode` enum değeri.
 * - `isOperational` → beklenen/işlenmiş hata (true) ya da bug/beklenmeyen (false).
 *
 * Stack trace asla client'a sızdırılmaz; yalnızca sunucu tarafında loglanır.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: ErrorCode;
  readonly isOperational: boolean;

  protected constructor(message: string, isOperational = true) {
    super(message);
    // V8: prototip zincirini düzelt (extends Error TS sınırlaması).
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, new.target);
  }
}
