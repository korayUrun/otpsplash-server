import { Role, type Device, type Project, type User } from '@prisma/client';
import { tokenService } from '@modules/auth/token.service';
import { createTestDevice, createTestProject, createTestUser } from './fixtures';

export interface AuthContext {
  project: Project;
  user: User;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export interface DeviceContext extends AuthContext {
  device: Device;
  /** Düz Device Secret (yalnızca testte; X-Device-Secret başlığı için). */
  deviceSecret: string;
}

/** createAuthContext'e verilebilecek opsiyonel kullanıcı alanları (payload assert'leri için). */
interface AuthUserOverrides {
  name?: string;
  phoneNumber?: string;
}

/**
 * Verilen rolde proje + kullanıcı oluşturur ve geçerli token çifti üretir.
 * Token'lar HTTP'ye gitmeden token servisiyle imzalanır (hızlı, deterministik).
 */
export async function createAuthContext(
  role: Role,
  overrides: AuthUserOverrides = {},
): Promise<AuthContext> {
  const project = await createTestProject();
  const { user, password } = await createTestUser({
    projectId: project.id,
    role,
    name: overrides.name,
    phoneNumber: overrides.phoneNumber,
  });

  const accessToken = tokenService.generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    projectId: user.projectId,
  });
  const refreshToken = tokenService.generateRefreshToken({ sub: user.id });

  return { project, user, password, accessToken, refreshToken };
}

export const getReceiverToken = (
  overrides: AuthUserOverrides = {},
): Promise<AuthContext> => createAuthContext(Role.RECEIVER, overrides);
export const getDeveloperToken = (): Promise<AuthContext> =>
  createAuthContext(Role.DEVELOPER);
export const getAdminToken = (): Promise<AuthContext> =>
  createAuthContext(Role.ADMIN);

/**
 * RECEIVER bağlamı + kayıtlı bir cihaz oluşturur ve düz Device Secret'ı döner.
 * `POST /api/otp` (X-Device-Secret) testleri için kullanılır.
 *
 * @param opts.isRevoked true ise cihaz iptal edilmiş kaydedilir (DEVICE_REVOKED testi).
 */
export async function getDeviceSecret(
  opts: { isRevoked?: boolean } = {},
): Promise<DeviceContext> {
  const ctx = await createAuthContext(Role.RECEIVER);
  const { device, secret } = await createTestDevice({
    userId: ctx.user.id,
    projectId: ctx.project.id,
    isRevoked: opts.isRevoked,
  });
  return { ...ctx, device, deviceSecret: secret };
}
