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
import { OtpController } from './otp.controller';
import { AesGcmOtpEncryptor } from './otp.encryptor';
import { OtpParser } from './otp.parser';
import { PrismaOtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { historyQuerySchema, processOtpSchema } from './otp.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service interface'lere bağlıdır (DIP).
const parser = new OtpParser();
const encryptor = new AesGcmOtpEncryptor();
const repository = new PrismaOtpRepository(prisma);
const otpService = new OtpService(parser, encryptor, repository, socketNotifier, logger);
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
