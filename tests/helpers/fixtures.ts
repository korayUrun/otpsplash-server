import { randomUUID } from 'node:crypto';
import {
  Platform,
  Role,
  RoutingTarget,
  Source,
  type Device,
  type Group,
  type OTPLog,
  type Project,
  type RoutingRule,
  type ServiceRegistry,
  type User,
} from '@prisma/client';
import { prisma } from '@config/prisma';
import { CONSTANTS } from '@config/constants';
import { Argon2PasswordService } from '@modules/auth/password.service';
import { SecretService } from '@modules/device/secret.service';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';

const passwordService = new Argon2PasswordService();
const secretService = new SecretService();
const otpEncryptor = new AesGcmOtpEncryptor();

/** Varsayılan güçlü test parolası (politikayı karşılar). */
export const DEFAULT_PASSWORD = 'Password123';

/**
 * Test projesi oluşturur. `isDefault: true` verilirse self-register'ın bağlanacağı
 * varsayılan projeyi işaretler (setup her testte projeleri sildiğinden tekil kalır).
 */
export async function createTestProject(
  name = 'Test Project',
  isDefault = false,
): Promise<Project> {
  return prisma.project.create({ data: { name, isDefault } });
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

interface CreateDeviceOptions {
  userId: string;
  projectId: string;
  platform?: Platform;
  isRevoked?: boolean;
}

/**
 * Test cihazı oluşturur (secret gerçek argon2id ile hashlenir).
 * @returns Oluşturulan device ve düz secret'ı (Device Secret auth testleri için).
 */
export async function createTestDevice(
  opts: CreateDeviceOptions,
): Promise<{ device: Device; secret: string }> {
  const secret = secretService.generate();
  const secretHash = await secretService.hash(secret);
  const device = await prisma.device.create({
    data: {
      secretHash,
      platform: opts.platform ?? Platform.ANDROID,
      userId: opts.userId,
      projectId: opts.projectId,
      isRevoked: opts.isRevoked ?? false,
    },
  });
  return { device, secret };
}

interface CreateOtpLogOptions {
  projectId: string;
  /** Düz OTP kodu; gerçek encryptor ile şifrelenir (history decrypt edebilsin). */
  code?: string;
  source?: Source;
  deviceId?: string;
  /** Sahip receiver; verilmezse projede yeni bir RECEIVER otomatik oluşturulur. */
  receiverId?: string;
  serviceId?: string;
  /** Servis çözülemezse gösterilecek ham gönderici fallback etiketi. */
  senderRaw?: string;
  sharingActive?: boolean;
  /** Süresi geçmiş kayıt testi için override edilir. */
  expiresAt?: Date;
}

/**
 * Test OTP kaydı oluşturur (kod gerçek AES-256-GCM ile şifrelenir).
 * `receiverId` verilmezse sahiplik için projede hafif bir RECEIVER üretilir
 * (argon2 maliyetinden kaçınmak için parola placeholder'dır — login amaçlı değildir).
 * @returns Oluşturulan OTPLog ve şifrelenen düz kod.
 */
export async function createTestOtpLog(
  opts: CreateOtpLogOptions,
): Promise<{ otpLog: OTPLog; code: string }> {
  const code = opts.code ?? '123456';
  // Fixture varsayılanı üretim TTL'inden (90 sn) bağımsız, testler için geniş (1 gün);
  // süresi dolmuş kayıt senaryoları expiresAt override'ı ile kurulur.
  const expiresAt =
    opts.expiresAt ?? new Date(Date.now() + CONSTANTS.TIME.DAY_MS);

  const receiverId = opts.receiverId ?? (await createPlaceholderReceiver(opts.projectId));

  const otpLog = await prisma.oTPLog.create({
    data: {
      encryptedCode: otpEncryptor.encrypt(code),
      source: opts.source ?? Source.ANDROID,
      projectId: opts.projectId,
      deviceId: opts.deviceId,
      receiverId,
      serviceId: opts.serviceId,
      senderRaw: opts.senderRaw,
      sharingActive: opts.sharingActive ?? true,
      expiresAt,
    },
  });
  return { otpLog, code };
}

/** OTP fixture'ları için hafif RECEIVER (parola placeholder — login için kullanılmaz). */
async function createPlaceholderReceiver(projectId: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `receiver_${randomUUID()}@test.com`,
      password: 'placeholder-not-a-real-hash',
      role: Role.RECEIVER,
      projectId,
    },
  });
  return user.id;
}

interface CreateServiceOptions {
  projectId: string;
  name?: string | null;
  isActive?: boolean;
  senderPattern?: string;
  keywordPattern?: string;
}

/** Test servis kayıt defteri satırı oluşturur (FAZ 7'de routing hedefi için). */
export async function createTestService(
  opts: CreateServiceOptions,
): Promise<ServiceRegistry> {
  return prisma.serviceRegistry.create({
    data: {
      name: opts.name === undefined ? 'Test Service' : opts.name,
      isActive: opts.isActive ?? true,
      senderPattern: opts.senderPattern,
      keywordPattern: opts.keywordPattern,
      projectId: opts.projectId,
    },
  });
}

/** Test grubu oluşturur. */
export async function createTestGroup(opts: {
  projectId: string;
  name?: string;
}): Promise<Group> {
  return prisma.group.create({
    data: { name: opts.name ?? 'Test Group', projectId: opts.projectId },
  });
}

interface CreateRoutingRuleOptions {
  receiverId: string;
  serviceId: string;
  targetType: RoutingTarget;
  developerId?: string;
  groupId?: string;
  isActive?: boolean;
}

/** Test yönlendirme kuralı oluşturur (DB seviyesi — servis katmanını bypass eder). */
export async function createTestRoutingRule(
  opts: CreateRoutingRuleOptions,
): Promise<RoutingRule> {
  return prisma.routingRule.create({
    data: {
      receiverId: opts.receiverId,
      serviceId: opts.serviceId,
      targetType: opts.targetType,
      developerId: opts.developerId ?? null,
      groupId: opts.groupId ?? null,
      isActive: opts.isActive ?? true,
    },
  });
}
