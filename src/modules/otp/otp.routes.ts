import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { socketNotifier } from '@infrastructure/socket';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { deviceAuth } from '@middleware/deviceAuth';
import { otpRateLimit } from '@middleware/rateLimiter';
import { validate } from '@middleware/validate';
import { routingResolver } from '@modules/routing/routing.routes';
import { OtpController } from './otp.controller';
import { AesGcmOtpEncryptor } from './otp.encryptor';
import { OtpParser } from './otp.parser';
import { PrismaOtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import {
  historyQuerySchema,
  processOtpSchema,
  sharingParamsSchema,
  toggleSharingSchema,
} from './otp.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service interface'lere bağlıdır (DIP).
const parser = new OtpParser();
const encryptor = new AesGcmOtpEncryptor();
const repository = new PrismaOtpRepository(prisma);
const otpService = new OtpService(
  parser,
  encryptor,
  repository,
  socketNotifier,
  routingResolver,
  logger,
);
const controller = new OtpController(otpService);

export const otpRouter: Router = Router();

// Rate limit en başta (IP bazlı, auth'tan önce).
// FAZ 6: JWT yerine Device Secret — `X-Device-Secret` başlığı ile doğrulanır.
// Android BroadcastReceiver / iOS Shortcut süresiz cihaz kimliğiyle gönderir.
otpRouter.post(
  '/',
  otpRateLimit,
  asyncHandler(deviceAuth),
  validate(processOtpSchema),
  asyncHandler(controller.process),
);

// Geçmiş yalnızca DEVELOPER'a açık; query sayfalama doğrulanır.
otpRouter.get(
  '/history',
  authenticate,
  authorize(Role.DEVELOPER),
  validate(historyQuerySchema, 'query'),
  asyncHandler(controller.history),
);

// Bir OTP'nin kimlerle paylaşıldığı (salt-okunur) — yalnızca OTP'nin sahibi RECEIVER.
otpRouter.get(
  '/:id/sharing',
  authenticate,
  authorize(Role.RECEIVER),
  validate(sharingParamsSchema, 'params'),
  asyncHandler(controller.getSharing),
);

// OTP paylaşımını aç/kapat — yalnızca OTP'nin sahibi RECEIVER (sahiplik service'te receiverId ile).
otpRouter.patch(
  '/:id/sharing',
  authenticate,
  authorize(Role.RECEIVER),
  validate(sharingParamsSchema, 'params'),
  validate(toggleSharingSchema),
  asyncHandler(controller.toggleSharing),
);
