import { z } from 'zod';
import { Source } from '@prisma/client';
import { CONSTANTS } from '@config/constants';

/**
 * `POST /api/otp` gövdesi.
 * Parse cihazda yapılır; backend ham SMS metni (`smsText`) almaz. `code` cihazda parse
 * edilmiş 6 haneli koddur ve zorunludur; format kontrolü TEK YERDE burada (Zod) yapılır —
 * `otp.service` artık ayrıca `validate()` çağırmaz (DRY). `senderRaw` developer'a gösterilecek
 * gönderici etiketidir (zorunlu; SMS gövdesi değildir). `context` opsiyonel serbest metin
 * bağlam etiketidir — gelmezse/null gelirse `null` olarak normalize edilir (tipi `string | null`).
 * `projectId`/`receiverId` body'de YOKTUR — doğrulanmış cihazdan alınır (proje izolasyonu + sahiplik).
 */
export const processOtpSchema = z.object({
  code: z
    .string()
    .length(CONSTANTS.OTP.CODE_LENGTH)
    .regex(/^\d+$/, 'code yalnızca rakamlardan oluşmalı'),
  source: z.nativeEnum(Source),
  senderRaw: z.string().min(1).max(CONSTANTS.OTP.SENDER_MAX_LENGTH),
  context: z
    .string()
    .max(CONSTANTS.OTP.CONTEXT_MAX_LENGTH)
    .nullish()
    .transform((value) => value ?? null),
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

/**
 * `POST /api/otp/dismiss` gövdesi — developer'ın kendi feed'inden kaldıracağı OTP id listesi.
 * Çoklu seçim desteklenir; en az bir id zorunlu, aşırı büyük istekler sayfa boyutuyla sınırlı.
 */
export const dismissOtpsSchema = z.object({
  otpIds: z
    .array(z.string().uuid())
    .min(1, 'en az bir OTP id gerekli')
    .max(CONSTANTS.PAGINATION.MAX_LIMIT),
});

export type ProcessOtpBody = z.infer<typeof processOtpSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type SharingParams = z.infer<typeof sharingParamsSchema>;
export type ToggleSharingBody = z.infer<typeof toggleSharingSchema>;
export type DismissOtpsBody = z.infer<typeof dismissOtpsSchema>;
