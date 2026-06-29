import { randomUUID } from 'node:crypto';
import { Role, Source, type OTPLog, type Project, type User } from '@prisma/client';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import { Argon2PasswordService } from '@modules/auth/password.service';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';

const passwordService = new Argon2PasswordService();
const otpEncryptor = new AesGcmOtpEncryptor();

/** Varsayılan güçlü test parolası (politikayı karşılar). */
export const DEFAULT_PASSWORD = 'Password123';

/** Test projesi oluşturur. */
export async function createTestProject(name = 'Test Project'): Promise<Project> {
  return prisma.project.create({ data: { name } });
}

interface CreateUserOptions {
  projectId: string;
  email?: string;
  password?: string;
  role?: Role;
}

/**
 * Test kullanıcısı oluşturur (parola argon2id ile hashlenir).
 * @returns Oluşturulan user ve düz parolası (login testleri için).
 */
export async function createTestUser(
  opts: CreateUserOptions,
): Promise<{ user: User; password: string }> {
  const password = opts.password ?? DEFAULT_PASSWORD;
  const hashed = await passwordService.hash(password);
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `user_${randomUUID()}@test.com`,
      password: hashed,
      role: opts.role ?? Role.RECEIVER,
      projectId: opts.projectId,
    },
  });
  return { user, password };
}

interface CreateOtpLogOptions {
  projectId: string;
  /** Düz OTP kodu; gerçek encryptor ile şifrelenir (history decrypt edebilsin). */
  code?: string;
  source?: Source;
  /** Süresi geçmiş kayıt testi için override edilir. */
  expiresAt?: Date;
}

/**
 * Test OTP kaydı oluşturur (kod gerçek AES-256-GCM ile şifrelenir).
 * @returns Oluşturulan OTPLog ve şifrelenen düz kod.
 */
export async function createTestOtpLog(
  opts: CreateOtpLogOptions,
): Promise<{ otpLog: OTPLog; code: string }> {
  const code = opts.code ?? '123456';
  const expiresAt =
    opts.expiresAt ??
    new Date(Date.now() + env.OTP_TTL_DAYS * CONSTANTS.TIME.DAY_MS);

  const otpLog = await prisma.oTPLog.create({
    data: {
      encryptedCode: otpEncryptor.encrypt(code),
      source: opts.source ?? Source.ANDROID,
      projectId: opts.projectId,
      expiresAt,
    },
  });
  return { otpLog, code };
}
