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
import { PrismaOtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import {
  dismissOtpsSchema,
  historyQuerySchema,
  processOtpSchema,
  sharingParamsSchema,
  toggleSharingSchema,
} from './otp.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service interface'lere bağlıdır (DIP).
// Parse cihazda yapılır (parser yok); dağıtım receiver bazlı routing resolver ile çözülür.
const encryptor = new AesGcmOtpEncryptor();
const repository = new PrismaOtpRepository(prisma);
const otpService = new OtpService(
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

// Geçmiş (rol-duyarlı, controller dallanır): DEVELOPER kendi feed'i, RECEIVER kendi kodları,
// ADMIN projedeki tüm receiver'lardan gelen tüm OTP'ler (özet ekranı).
otpRouter.get(
  '/history',
  authenticate,
  authorize(Role.DEVELOPER, Role.RECEIVER, Role.ADMIN),
  validate(historyQuerySchema, 'query'),
  asyncHandler(controller.history),
);

// DEVELOPER seçtiği OTP'leri KENDİ feed'inden kaldırır (yumuşak gizleme; receiver/admin görmeye devam eder).
otpRouter.post(
  '/dismiss',
  authenticate,
  authorize(Role.DEVELOPER),
  validate(dismissOtpsSchema),
  asyncHandler(controller.dismiss),
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
