import { Role, type Project, type User } from '@prisma/client';
import { tokenService } from '@modules/auth/token.service';
import { createTestProject, createTestUser } from './fixtures';

export interface AuthContext {
  project: Project;
  user: User;
  password: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Verilen rolde proje + kullanıcı oluşturur ve geçerli token çifti üretir.
 * Token'lar HTTP'ye gitmeden token servisiyle imzalanır (hızlı, deterministik).
 */
export async function createAuthContext(role: Role): Promise<AuthContext> {
  const project = await createTestProject();
  const { user, password } = await createTestUser({ projectId: project.id, role });

  const accessToken = tokenService.generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    projectId: user.projectId,
  });
  const refreshToken = tokenService.generateRefreshToken({ sub: user.id });

  return { project, user, password, accessToken, refreshToken };
}

export const getReceiverToken = (): Promise<AuthContext> =>
  createAuthContext(Role.RECEIVER);
export const getDeveloperToken = (): Promise<AuthContext> =>
  createAuthContext(Role.DEVELOPER);
export const getAdminToken = (): Promise<AuthContext> =>
  createAuthContext(Role.ADMIN);
