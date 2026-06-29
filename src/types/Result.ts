import type { AppError } from '@errors/AppError';

/**
 * Service katmanı sonuç tipi.
 * Beklenen hata yolları exception yerine `fail()` ile döner;
 * controller `success` ayrımıyla ya `res.json` ya `next(error)` yapar.
 */
export type Result<T, E extends AppError = AppError> =
  | { success: true; data: T }
  | { success: false; error: E };

/** Başarılı sonuç sarmalayıcı. */
export const ok = <T>(data: T): Result<T> => ({ success: true, data });

/** Başarısız sonuç sarmalayıcı. */
export const fail = <E extends AppError = AppError>(
  error: E,
): Result<never, E> => ({ success: false, error });
