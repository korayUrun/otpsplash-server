import { z } from 'zod';
import { Platform } from '@prisma/client';

/**
 * `POST /api/devices/register` gövdesi.
 * `userId`/`projectId` body'de YOKTUR — kimliği doğrulanmış kullanıcıdan alınır.
 */
export const registerDeviceSchema = z.object({
  platform: z.nativeEnum(Platform),
});

/** `DELETE /api/devices/:id` path parametreleri. */
export const deviceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type RegisterDeviceBody = z.infer<typeof registerDeviceSchema>;
export type DeviceIdParams = z.infer<typeof deviceIdParamsSchema>;
