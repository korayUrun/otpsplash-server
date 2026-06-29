import type { Role } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { JwtPayload, RefreshPayload } from '@app-types/index';

// ───────────────────────── DTO'lar ─────────────────────────

/** Kayıt isteği gövdesi. */
export interface RegisterDTO {
  email: string;
  password: string;
  role: Role;
  projectId: string;
}

/** Giriş isteği gövdesi. */
export interface LoginDTO {
  email: string;
  password: string;
}

/** Token yenileme isteği gövdesi. */
export interface RefreshDTO {
  refreshToken: string;
}

/** Parolasız, client'a güvenle dönülebilen kullanıcı görünümü. */
export interface SafeUser {
  id: string;
  email: string;
  role: Role;
  projectId: string;
  createdAt: Date;
}

/** register/login başarı çıktısı. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

/** refresh başarı çıktısı. */
export interface RefreshResult {
  accessToken: string;
}

/** logout çıktısı. */
export interface LogoutResult {
  message: string;
}

// ───────────────────────── Servis arayüzleri ─────────────────────────

/**
 * Parola hashleme servisi (argon2id). CPU-yoğun olduğu için tamamen async.
 */
export interface IPasswordService {
  /** Düz parolayı argon2id ile hashler. */
  hash(plain: string): Promise<string>;
  /** Hash ile düz parolayı karşılaştırır. Bozuk hash → AuthenticationError. */
  verify(hash: string, plain: string): Promise<boolean>;
}

/**
 * JWT üretim/doğrulama servisi. Hızlı olduğu için sync (CLAUDE.md kuralı).
 */
export interface ITokenService {
  generateAccessToken(payload: JwtPayload): string;
  generateRefreshToken(payload: RefreshPayload): string;
  /** Süresi dolmuş → TOKEN_EXPIRED, geçersiz → TOKEN_INVALID (AuthenticationError). */
  verifyAccessToken(token: string): JwtPayload;
  verifyRefreshToken(token: string): RefreshPayload;
}

/**
 * Kimlik doğrulama iş mantığı. Beklenen hatalar Result.fail ile döner.
 */
export interface IAuthService {
  register(dto: RegisterDTO): Promise<Result<AuthTokens>>;
  login(dto: LoginDTO): Promise<Result<AuthTokens>>;
  refresh(dto: RefreshDTO): Promise<Result<RefreshResult>>;
  logout(userId: string): Promise<Result<LogoutResult>>;
}
