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

/**
 * Kayıt şeması. `projectId` YOKTUR — self-register kullanıcıyı backend'in varsayılan
 * projesine bağlar (kullanıcı proje seçmez/id girmez). Rol yalnızca RECEIVER veya
 * DEVELOPER olabilir; ADMIN self-register edemez (backend zorlar).
 */
export const registerSchema = z.object({
  email: z.string().email('Geçerli bir e-posta giriniz'),
  name: z
    .string()
    .trim()
    .min(1, 'İsim boş olamaz')
    .max(100, 'İsim en fazla 100 karakter olabilir'),
  phoneNumber: z
    .string()
    .trim()
    .min(1, 'Telefon numarası boş olamaz')
    .max(32, 'Telefon numarası en fazla 32 karakter olabilir')
    .optional(),
  password: passwordSchema,
  role: z.nativeEnum(Role).refine((role) => role !== Role.ADMIN, {
    message: 'Rol yalnızca RECEIVER veya DEVELOPER olabilir',
  }),
});

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta giriniz'),
  password: z.string().min(1, 'Şifre gerekli'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken gerekli'),
});
