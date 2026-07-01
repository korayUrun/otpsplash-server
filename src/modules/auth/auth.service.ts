import type { PrismaClient, User } from '@prisma/client';
import { AppError } from '@errors/AppError';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type {
  AuthTokens,
  IAuthService,
  IPasswordService,
  ITokenService,
  LoginDTO,
  LogoutResult,
  RefreshDTO,
  RefreshResult,
  RegisterDTO,
  SafeUser,
} from './auth.interfaces';

/**
 * Kimlik doğrulama iş mantığı.
 * Bağımlılıklar constructor injection ile geçer (DIP) — concrete değil interface.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 */
export class AuthService implements IAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwordService: IPasswordService,
    private readonly tokenService: ITokenService,
    private readonly logger: ILogger,
  ) {}

  async register(dto: RegisterDTO): Promise<Result<AuthTokens>> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });
      if (!project) {
        return fail(
          new NotFoundError('Proje bulunamadı', ErrorCode.PROJECT_NOT_FOUND),
        );
      }

      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing) {
        return fail(new ConflictError('Bu e-posta zaten kayıtlı'));
      }

      const hashed = await this.passwordService.hash(dto.password);
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name ?? null,
          password: hashed,
          role: dto.role,
          projectId: dto.projectId,
        },
      });

      this.logger.info(
        { userId: user.id, projectId: user.projectId, role: user.role },
        'yeni kullanıcı kaydedildi',
      );

      return ok(this.issueTokens(user));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async login(dto: LoginDTO): Promise<Result<AuthTokens>> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      // Bilgi sızdırma yok: olmayan e-posta ve yanlış şifre aynı hatayı döner.
      if (!user) {
        return fail(new AuthenticationError());
      }

      const valid = await this.passwordService.verify(
        user.password,
        dto.password,
      );
      if (!valid) {
        return fail(new AuthenticationError());
      }

      return ok(this.issueTokens(user));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async refresh(dto: RefreshDTO): Promise<Result<RefreshResult>> {
    try {
      const payload = this.tokenService.verifyRefreshToken(dto.refreshToken);

      // Token geçerli olsa da kullanıcı silinmiş olabilir → tekrar doğrula.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) {
        return fail(new AuthenticationError());
      }

      const accessToken = this.tokenService.generateAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        projectId: user.projectId,
      });

      return ok({ accessToken });
    } catch (error) {
      return this.toResult(error);
    }
  }

  async logout(userId: string): Promise<Result<LogoutResult>> {
    // Refresh token blacklist henüz yok (CLAUDE.md "İleride").
    // Stateless: client token'ları atar. İz için loglanır.
    this.logger.info({ userId }, 'kullanıcı çıkış yaptı');
    return Promise.resolve(ok({ message: 'Çıkış yapıldı' }));
  }

  /** User → access + refresh token + parolasız kullanıcı görünümü. */
  private issueTokens(user: User): AuthTokens {
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      projectId: user.projectId,
    });
    const refreshToken = this.tokenService.generateRefreshToken({
      sub: user.id,
    });
    return { accessToken, refreshToken, user: this.toSafeUser(user) };
  }

  /** Parola alanını ayıklar. */
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      projectId: user.projectId,
      createdAt: user.createdAt,
    };
  }

  /**
   * Beklenen AppError'ları Result.fail'e çevirir; beklenmeyen hataları
   * (DB bağlantısı vb.) errorHandler'a iletmek için yeniden fırlatır.
   */
  private toResult(error: unknown): Result<never> {
    if (error instanceof AppError) {
      return fail(error);
    }
    throw error;
  }
}
