import { z } from 'zod';
import { Source } from '@prisma/client';
import { CONSTANTS } from '@config/constants';

/** İstek gövdesi üst sınırı (req body limiti 10kb; metin alanı için makul tavan). */
const MAX_SMS_LENGTH = 1000;

/**
 * `POST /api/otp` gövdesi.
 * `smsText` veya `code`'dan en az biri zorunlu (refine). `projectId`/`receiverId` body'de
 * YOKTUR — doğrulanmış cihazdan alınır (proje izolasyonu + sahiplik).
 *
 * `serviceId` FAZ 7'de geçici opsiyonel alandır (routing'in çalışabilmesi için). FAZ 8'de
 * kalkar ve yerini `senderRaw`/`serviceHint` alır; servis backend'de çözümlenir.
 */
export const processOtpSchema = z
  .object({
    smsText: z.string().min(1).max(MAX_SMS_LENGTH).optional(),
    code: z.string().min(1).optional(),
    source: z.nativeEnum(Source),
    serviceId: z.string().uuid().optional(),
  })
  .refine((data) => data.smsText !== undefined || data.code !== undefined, {
    message: 'smsText veya code alanlarından en az biri zorunlu',
    path: ['smsText'],
  });

/** `PATCH /api/otp/:id/sharing` ve `GET /api/otp/:id/sharing` path parametresi. */
export const sharingParamsSchema = z.object({
  id: z.string().uuid(),
});

/** `PATCH /api/otp/:id/sharing` gövdesi. */
export const toggleSharingSchema = z.object({
  sharingActive: z.boolean(),
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
export type SharingParams = z.infer<typeof sharingParamsSchema>;
export type ToggleSharingBody = z.infer<typeof toggleSharingSchema>;
