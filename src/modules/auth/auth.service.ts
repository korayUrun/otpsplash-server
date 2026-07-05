import { randomUUID } from 'node:crypto';
import { RefreshTokenStatus, Role, type PrismaClient, type User } from '@prisma/client';
import { CONSTANTS } from '@config/constants';
import { AppError } from '@errors/AppError';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { ILogger } from '@infrastructure/logger';
import { type Result, ok, fail } from '@app-types/Result';
import type {
  AuthTokens,
  IAuthService,
  IPasswordService,
  IRefreshTokenStore,
  ITokenService,
  LoginDTO,
  LogoutDTO,
  LogoutResult,
  RefreshDTO,
  RefreshResult,
  RefreshTokenRecord,
  RegisterDTO,
  SafeUser,
} from './auth.interfaces';

/**
 * Kimlik doğrulama iş mantığı.
 * Bağımlılıklar constructor injection ile geçer (DIP) — concrete değil interface.
 * Beklenen hatalar `Result.fail` ile, beklenmeyen (DB vb.) hatalar throw ile döner.
 *
 * Refresh token rotasyonu: her login/register yeni bir oturum ailesi açar; her yenilemede
 * eski token ROTATED işaretlenip aynı ailede yeni ACTIVE token üretilir. Rotate edilmiş bir
 * token grace penceresi dışında tekrar gelirse (reuse) tüm aile iptal edilir. Access token'lar
 * stateless kalır (bkz. CLAUDE.md "Refresh Token Rotasyonu" kararı).
 */
export class AuthService implements IAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwordService: IPasswordService,
    private readonly tokenService: ITokenService,
    private readonly refreshStore: IRefreshTokenStore,
    private readonly logger: ILogger,
  ) {}

  async register(dto: RegisterDTO): Promise<Result<AuthTokens>> {
    try {
      // ADMIN self-register edemez. Zod da reddeder; bu servis-katmanı savunmasıdır
      // (RegisterDTO.role tip olarak hâlâ ADMIN'i taşıyabildiği için — çift katman).
      if (dto.role === Role.ADMIN) {
        return fail(
          new ValidationError('Rol yalnızca RECEIVER veya DEVELOPER olabilir'),
        );
      }

      // Kullanıcı proje seçmez/id girmez — backend varsayılan projeye bağlar.
      // Varsayılan proje yoksa bu bir kurulum hatasıdır (seed/admin tanımlamalı).
      const project = await this.prisma.project.findFirst({
        where: { isDefault: true },
      });
      if (!project) {
        return fail(
          new NotFoundError(
            'Kayıt için varsayılan proje tanımlı değil',
            ErrorCode.PROJECT_NOT_FOUND,
          ),
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
          name: dto.name,
          phoneNumber: dto.phoneNumber ?? null,
          password: hashed,
          role: dto.role,
          projectId: project.id,
        },
      });

      this.logger.info(
        { userId: user.id, projectId: user.projectId, role: user.role },
        'yeni kullanıcı kaydedildi',
      );

      return ok(await this.issueTokens(user));
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

      return ok(await this.issueTokens(user));
    } catch (error) {
      return this.toResult(error);
    }
  }

  async refresh(dto: RefreshDTO): Promise<Result<RefreshResult>> {
    try {
      // Süresi dolmuş → TOKEN_EXPIRED (mobil sessizce yenilemeyi dener); geçersiz → TOKEN_INVALID.
      const { sub, jti, fam } = this.tokenService.verifyRefreshToken(
        dto.refreshToken,
      );
      const record = await this.refreshStore.findByJti(jti);

      // Bilinmeyen/yabancı token (kayıt yok ya da aile/sahip uyuşmuyor) → geçersiz.
      if (!record || record.familyId !== fam || record.userId !== sub) {
        return fail(this.invalidToken());
      }
      if (record.status === RefreshTokenStatus.REVOKED) {
        return fail(this.invalidToken());
      }
      if (record.status === RefreshTokenStatus.ROTATED) {
        return this.handleRotated(record);
      }

      // ACTIVE → atomik rotate dene. Yarışta yalnızca bir istek "sahiplenir".
      const claimed = await this.refreshStore.markRotated(jti, new Date());
      if (!claimed) {
        // Başka bir istek önce rotate etti → güncel durumu okuyup grace/reuse dalına gir.
        const latest = await this.refreshStore.findByJti(jti);
        if (!latest) {
          return fail(this.invalidToken());
        }
        return this.handleRotated(latest);
      }

      return this.rotateInFamily(sub, fam);
    } catch (error) {
      return this.toResult(error);
    }
  }

  async logout(dto: LogoutDTO): Promise<Result<LogoutResult>> {
    try {
      // Oturum-bazlı iptal: refresh token verildiyse ailesini iptal et (sahiplik doğrulanır).
      // Best-effort — bozuk/başkasına ait/süresi dolmuş token sessizce geçilir (istemci token'ları
      // zaten atar; kullanıcı bazında toplu iptal YAPILMAZ — telefon+tablet oturumları ayrık kalsın).
      if (dto.refreshToken) {
        try {
          const { sub, fam } = this.tokenService.verifyRefreshToken(
            dto.refreshToken,
          );
          if (sub === dto.userId) {
            await this.refreshStore.revokeFamily(fam);
          }
        } catch {
          // Geçersiz/süresi dolmuş refresh token → iptal edilecek belirli aile yok, yutulur.
        }
      }

      this.logger.info({ userId: dto.userId }, 'kullanıcı çıkış yaptı');
      return ok({ message: 'Çıkış yapıldı' });
    } catch (error) {
      return this.toResult(error);
    }
  }

  /**
   * ROTATED bir kaydın yeniden sunulması: grace penceresi içindeyse meşru ağ tekrarı/yarış kabul
   * edilip aynı ailede taze token üretilir; pencere dışındaysa token hırsızlığı (reuse) kabul
   * edilip tüm aile iptal edilir ve TOKEN_INVALID döner.
   */
  private async handleRotated(
    record: RefreshTokenRecord,
  ): Promise<Result<RefreshResult>> {
    if (record.status === RefreshTokenStatus.REVOKED) {
      return fail(this.invalidToken());
    }

    const withinGrace =
      record.rotatedAt !== null &&
      Date.now() - record.rotatedAt.getTime() <=
        CONSTANTS.AUTH.REFRESH_REUSE_GRACE_MS;

    if (withinGrace) {
      return this.rotateInFamily(record.userId, record.familyId);
    }

    await this.refreshStore.revokeFamily(record.familyId);
    this.logger.warn(
      { userId: record.userId, familyId: record.familyId },
      'refresh token reuse tespit edildi — oturum ailesi iptal edildi',
    );
    return fail(this.invalidToken());
  }

  /**
   * Verilen aile için yeni access + refresh token çifti üretir (yenileme çıktısı).
   * Kullanıcı silinmişse oturum yok sayılır (TOKEN_INVALID) — FK cascade kayıtları zaten temizler.
   */
  private async rotateInFamily(
    userId: string,
    familyId: string,
  ): Promise<Result<RefreshResult>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return fail(this.invalidToken());
    }
    return ok(await this.mintTokenPair(user, familyId));
  }

  /**
   * User → yeni oturum ailesi + token çifti + parolasız kullanıcı görünümü (login/register).
   * Fırsatçı temizlik: bu kullanıcının süresi geçmiş refresh kayıtları silinir (cron yok).
   */
  private async issueTokens(user: User): Promise<AuthTokens> {
    await this.refreshStore.deleteExpired(user.id);
    const familyId = randomUUID();
    const pair = await this.mintTokenPair(user, familyId);
    return { ...pair, user: this.toSafeUser(user) };
  }

  /**
   * Access token + (aynı ailede) yeni refresh token üretir ve refresh token'ı depoya yazar.
   * issueTokens (yeni aile) ve rotateInFamily (mevcut aile) tarafından paylaşılır.
   */
  private async mintTokenPair(
    user: User,
    familyId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      projectId: user.projectId,
    });
    const { token: refreshToken, jti, expiresAt } =
      this.tokenService.generateRefreshToken({ sub: user.id, fam: familyId });
    await this.refreshStore.create({
      jti,
      familyId,
      userId: user.id,
      expiresAt,
    });
    return { accessToken, refreshToken };
  }

  /** İptal/geçersiz refresh token için standart hata — mobil bu kodda login'e yönlendirir. */
  private invalidToken(): AuthenticationError {
    return new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
  }

  /** Parola alanını ayıklar. */
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phoneNumber: user.phoneNumber,
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
