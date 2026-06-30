import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { deviceRegisterRateLimit } from '@middleware/rateLimiter';
import { validate } from '@middleware/validate';
import { DeviceController } from './device.controller';
import { deviceService } from './device.service';
import { deviceIdParamsSchema, registerDeviceSchema } from './device.schemas';

// ── Modül kompozisyon kökü ──
// Paylaşılan `deviceService` singleton'ı kullanılır (deviceAuth middleware'i ile aynı örnek).
const controller = new DeviceController(deviceService);

export const deviceRouter: Router = Router();

// Cihaz kaydı yalnızca RECEIVER'a açık (OTP gönderen cihazı o kaydeder).
deviceRouter.post(
  '/register',
  deviceRegisterRateLimit,
  authenticate,
  authorize(Role.RECEIVER),
  validate(registerDeviceSchema),
  asyncHandler(controller.register),
);

// Cihaz iptali: sahiplik kontrolü service'te (başkası → 403, olmayan → 404).
deviceRouter.delete(
  '/:id',
  authenticate,
  authorize(Role.RECEIVER),
  validate(deviceIdParamsSchema, 'params'),
  asyncHandler(controller.revoke),
);

// Kullanıcının kendi cihazları (secretHash içermez).
deviceRouter.get(
  '/',
  authenticate,
  authorize(Role.RECEIVER),
  asyncHandler(controller.list),
);
