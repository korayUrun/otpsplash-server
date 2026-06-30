import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { ServiceRegistryController } from './registry.controller';
import { PrismaServiceRegistryRepository } from './registry.repository';
import { ServiceRegistryResolver } from './registry.resolver';
import { ServiceRegistryService } from './registry.service';
import type {
  IServiceRegistryService,
  IServiceResolver,
} from './registry.interfaces';
import { serviceIdParamsSchema, serviceRuleSchema } from './registry.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service/resolver interface'lere bağlıdır (DIP).
// Resolver ve service AYNI repository örneğini paylaşır.
const repository = new PrismaServiceRegistryRepository(prisma);

/**
 * Paylaşılan singleton'lar.
 * OTP modülü (otp.service) bunları somut sınıf değil interface üzerinden bilir;
 * kompozisyon kökünde (otp.routes) enjekte edilir:
 *  - `serviceResolver`        → senderRaw/serviceHint → serviceId çözümleme (cache'li)
 *  - `serviceRegistryService` → eşleşmeyen sinyali kova'ya yazma (IUnmatchedRecorder)
 */
export const serviceResolver: IServiceResolver = new ServiceRegistryResolver(
  repository,
);
export const serviceRegistryService: IServiceRegistryService =
  new ServiceRegistryService(repository, logger);

const controller = new ServiceRegistryController(serviceRegistryService);

export const serviceRegistryRouter: Router = Router();

// Tüm servis kayıt defteri yönetimi yalnızca ADMIN'e açıktır.

// Manuel aktif kural oluştur.
serviceRegistryRouter.post(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validate(serviceRuleSchema),
  asyncHandler(controller.create),
);

// Tüm kayıtlar (aktif + kova).
serviceRegistryRouter.get(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  asyncHandler(controller.list),
);

// Yalnızca kova (inaktif) satırları. `/:id` PATCH/DELETE ile çakışmaz (farklı yol/metot).
serviceRegistryRouter.get(
  '/unmatched',
  authenticate,
  authorize(Role.ADMIN),
  asyncHandler(controller.listUnmatched),
);

// Kova satırını isim+kural vererek aktive et.
serviceRegistryRouter.patch(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validate(serviceIdParamsSchema, 'params'),
  validate(serviceRuleSchema),
  asyncHandler(controller.activate),
);

// Kaydı sil.
serviceRegistryRouter.delete(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validate(serviceIdParamsSchema, 'params'),
  asyncHandler(controller.remove),
);
