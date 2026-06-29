import { z } from 'zod';
import { Role } from '@prisma/client';

/**
 * Parola politikası: min 8 karakter, en az 1 büyük harf, en az 1 rakam.
 * Yalnızca kayıtta uygulanır; login'de politika sızdırılmaz (sadece min 1).
 */
const passwordSchema = z
  .string()
  .min(8, 'Şifre en az 8 karakter olmalı')
  .regex(/[A-Z]/, 'Şifre en az 1 büyük harf içermeli')
  .regex(/[0-9]/, 'Şifre en az 1 rakam içermeli');

export const registerSchema = z.object({
  email: z.string().email('Geçerli bir e-posta giriniz'),
  password: passwordSchema,
  role: z.nativeEnum(Role),
  projectId: z.string().uuid('Geçerli bir proje id giriniz'),
});

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta giriniz'),
  password: z.string().min(1, 'Şifre gerekli'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken gerekli'),
});
