import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { RoutingController } from './routing.controller';
import { PrismaRoutingRepository } from './routing.repository';
import { RoutingResolver } from './routing.resolver';
import { RoutingService } from './routing.service';
import type { IRoutingResolver } from './routing.interfaces';
import {
  createRoutingRuleSchema,
  routingIdParamsSchema,
  toggleRuleSchema,
} from './routing.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service/resolver interface'lere bağlıdır (DIP).
const repository = new PrismaRoutingRepository(prisma);
const routingService = new RoutingService(repository, logger);
const controller = new RoutingController(routingService);

/**
 * Paylaşılan resolver singleton'ı.
 * OTP modülü (otp.service) bu somut nesneyi değil `IRoutingResolver` interface'ini bilir;
 * kompozisyon kökünde (otp.routes) enjekte edilir.
 */
export const routingResolver: IRoutingResolver = new RoutingResolver(repository);

export const routingRouter: Router = Router();

// Tüm yönlendirme kuralı yönetimi yalnızca ADMIN'e açık.
routingRouter.post(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validate(createRoutingRuleSchema),
  asyncHandler(controller.create),
);

routingRouter.get(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  asyncHandler(controller.list),
);

routingRouter.patch(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validate(routingIdParamsSchema, 'params'),
  validate(toggleRuleSchema),
  asyncHandler(controller.toggle),
);

routingRouter.delete(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validate(routingIdParamsSchema, 'params'),
  asyncHandler(controller.remove),
);
