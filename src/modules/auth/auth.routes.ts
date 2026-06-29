import { Router } from 'express';
import { prisma } from '@config/prisma';
import { logger } from '@infrastructure/logger';
import { asyncHandler } from '@middleware/asyncHandler';
import { authenticate } from '@middleware/authenticate';
import { loginRateLimit, registerRateLimit } from '@middleware/rateLimiter';
import { validate } from '@middleware/validate';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Argon2PasswordService } from './password.service';
import { tokenService } from './token.service';
import { loginSchema, refreshSchema, registerSchema } from './auth.schemas';

// ── Modül kompozisyon kökü ──
// Concrete bağımlılıklar burada kurulur; service'ler interface'lere bağlıdır (DIP).
const passwordService = new Argon2PasswordService();
const authService = new AuthService(prisma, passwordService, tokenService, logger);
const controller = new AuthController(authService);

export const authRouter: Router = Router();

authRouter.post(
  '/register',
  registerRateLimit,
  validate(registerSchema),
  asyncHandler(controller.register),
);

authRouter.post(
  '/login',
  loginRateLimit,
  validate(loginSchema),
  asyncHandler(controller.login),
);

authRouter.post('/refresh', validate(refreshSchema), asyncHandler(controller.refresh));

authRouter.post('/logout', authenticate, asyncHandler(controller.logout));
