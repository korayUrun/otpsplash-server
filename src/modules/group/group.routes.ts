import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { GroupController } from './group.controller';
import { PrismaGroupRepository } from './group.repository';
import { GroupService } from './group.service';
import {
  addMemberSchema,
  createGroupSchema,
  groupIdParamsSchema,
  removeMemberParamsSchema,
} from './group.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service interface'lere bağlıdır (DIP).
const repository = new PrismaGroupRepository(prisma);
const groupService = new GroupService(repository, logger);
const controller = new GroupController(groupService);

export const groupRouter: Router = Router();

// Grup oluşturma yalnızca ADMIN'e açık.
groupRouter.post(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validate(createGroupSchema),
  asyncHandler(controller.create),
);

// Grup listesi: kimliği doğrulanmış herkes görebilir (salt-okunur, proje bazlı).
groupRouter.get('/', authenticate, asyncHandler(controller.list));

// Gruba üye ekleme yalnızca ADMIN'e açık.
groupRouter.post(
  '/:id/members',
  authenticate,
  authorize(Role.ADMIN),
  validate(groupIdParamsSchema, 'params'),
  validate(addMemberSchema),
  asyncHandler(controller.addMember),
);

// Gruptan üye çıkarma yalnızca ADMIN'e açık.
groupRouter.delete(
  '/:id/members/:uid',
  authenticate,
  authorize(Role.ADMIN),
  validate(removeMemberParamsSchema, 'params'),
  asyncHandler(controller.removeMember),
);

// Grup silme yalnızca ADMIN'e açık. FK cascade üyelikleri ve bu grubu hedefleyen
// yönlendirme kurallarını da temizler (dangling kural kalmaz).
groupRouter.delete(
  '/:id',
  authenticate,
  authorize(Role.ADMIN),
  validate(groupIdParamsSchema, 'params'),
  asyncHandler(controller.delete),
);
