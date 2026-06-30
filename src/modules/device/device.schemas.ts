import { z } from 'zod';
import { Platform } from '@prisma/client';
import { CONSTANTS } from '@config/constants';

/**
 * `POST /api/devices/register` gövdesi.
 * `userId`/`projectId` body'de YOKTUR — kimliği doğrulanmış kullanıcıdan alınır.
 * `deviceName`/`phoneNumber` opsiyonel receiver beyanıdır (FAZ 8) — SMS'ten OTOMATİK
 * türetilmez, developer'a "cihaz bilgisi" olarak gösterilir.
 */
export const registerDeviceSchema = z.object({
  platform: z.nativeEnum(Platform),
  deviceName: z.string().min(1).max(CONSTANTS.DEVICE.NAME_MAX_LENGTH).optional(),
  phoneNumber: z.string().min(1).max(CONSTANTS.DEVICE.PHONE_MAX_LENGTH).optional(),
});

/** `DELETE /api/devices/:id` path parametreleri. */
export const deviceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>;
export type DeviceIdParams = z.infer<typeof deviceIdParamsSchema>;
