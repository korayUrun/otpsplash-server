import { z } from 'zod';
import { Source } from '@prisma/client';
import { CONSTANTS } from '@config/constants';

/** İstek gövdesi üst sınırı (req body limiti 10kb; metin alanı için makul tavan). */
const MAX_SMS_LENGTH = 1000;

/**
 * `POST /api/otp` gövdesi.
 * `smsText` veya `code`'dan en az biri zorunlu (refine). `projectId` body'de YOKTUR —
 * kimliği doğrulanmış kullanıcının projesinden alınır (proje izolasyonu).
 */
export const processOtpSchema = z
  .object({
    smsText: z.string().min(1).max(MAX_SMS_LENGTH).optional(),
    code: z.string().min(1).optional(),
    source: z.nativeEnum(Source),
  })
  .refine((data) => data.smsText !== undefined || data.code !== undefined, {
    message: 'smsText veya code alanlarından en az biri zorunlu',
    path: ['smsText'],
  });

/**
 * `GET /api/otp/history` query parametreleri. Sayfalama coerce + default'lu.
 */
export const historyQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive()
    .default(CONSTANTS.PAGINATION.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(CONSTANTS.PAGINATION.MAX_LIMIT)
    .default(CONSTANTS.PAGINATION.DEFAULT_LIMIT),
});

export type ProcessOtpBody = z.infer<typeof processOtpSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
