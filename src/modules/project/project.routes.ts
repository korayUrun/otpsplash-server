import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { ProjectController } from './project.controller';
import { PrismaProjectRepository } from './project.repository';
import { ProjectService } from './project.service';
import {
  addUserSchema,
  createProjectSchema,
  projectIdParamsSchema,
  removeUserParamsSchema,
} from './project.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service interface'lere bağlıdır (DIP).
const repository = new PrismaProjectRepository(prisma);
const projectService = new ProjectService(repository, logger);
const controller = new ProjectController(projectService);

export const projectRouter: Router = Router();

// Proje oluşturma yalnızca ADMIN'e açık.
projectRouter.post(
  '/',
  authenticate,
  authorize(Role.ADMIN),
  validate(createProjectSchema),
  asyncHandler(controller.create),
);

// Proje görüntüleme: kimliği doğrulanmış herkes; üyelik kontrolü service'te (403/404).
projectRouter.get(
  '/:id',
  authenticate,
  validate(projectIdParamsSchema, 'params'),
  asyncHandler(controller.getById),
);

// Projeye kullanıcı ekleme yalnızca ADMIN'e açık.
projectRouter.post(
  '/:id/users',
  authenticate,
  authorize(Role.ADMIN),
  validate(projectIdParamsSchema, 'params'),
  validate(addUserSchema),
  asyncHandler(controller.addUser),
);

// Projeden kullanıcı çıkarma yalnızca ADMIN'e açık.
projectRouter.delete(
  '/:id/users/:uid',
  authenticate,
  authorize(Role.ADMIN),
  validate(removeUserParamsSchema, 'params'),
  asyncHandler(controller.removeUser),
);
