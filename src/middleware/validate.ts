import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '@errors/errors';

/** Doğrulanacak request bölümü. */
type RequestPart = 'body' | 'query' | 'params';

/**
 * Generic Zod doğrulama middleware'i.
 * Verilen şemaya göre `req[part]`'ı parse eder; başarısızsa tüm sorun
 * mesajlarını birleştirip `ValidationError` (400) ile reddeder.
 * Başarılıysa parse edilmiş (tip-güvenli, default'ları uygulanmış) değeri geri yazar.
 *
 * @param schema Zod şeması
 * @param part   Doğrulanacak bölüm (varsayılan: body)
 */
export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      const message = result.error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      next(new ValidationError(message));
      return;
    }

    // Parse edilmiş değeri geri yaz (coercion + default'lar uygulanmış olur).
    req[part] = result.data;
    next();
  };
}
