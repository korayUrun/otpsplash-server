import type { RefreshTokenStatus, Role } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { JwtPayload, RefreshPayload } from '@app-types/index';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * Kayıt isteği gövdesi.
 * `projectId` YOKTUR — backend kullanıcıyı varsayılan projeye (`Project.isDefault`) bağlar.
 * `role` yalnızca RECEIVER/DEVELOPER olabilir (ADMIN Zod'da ve service'te reddedilir).
 */
export interface RegisterDTO {
  email: string;
  /** Görünen ad — zorunlu. */
  name: string;
  /** Hesap iletişim numarası; opsiyonel, verilmezse `null` kaydedilir. */
  phoneNumber?: string;
  password: string;
  role: Role;
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

/**
 * Çıkış isteği. `userId` access token'dan (`req.user.sub`) gelir — kimliği kanıtlar.
 * `refreshToken` opsiyoneldir: verilirse SADECE o oturumun ailesi iptal edilir (oturum-bazlı
 * çıkış); verilmezse sunucuda iptal edilecek belirli bir oturum kimliği yoktur (istemci yine de
 * kendi token'larını atar). Mobil, gerçek sunucu-taraflı iptal için refreshToken göndermelidir.
 */
export interface LogoutDTO {
  userId: string;
  refreshToken?: string;
}

/** Parolasız, client'a güvenle dönülebilen kullanıcı görünümü. */
export interface SafeUser {
  id: string;
  email: string;
  /** Görünen ad; opsiyonel. Mobil `name ?? email` fallback yapar. */
  name: string | null;
  /** Hesap iletişim numarası; beyan edilmemişse null. */
  phoneNumber: string | null;
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

/**
 * refresh başarı çıktısı. Rotasyon gereği access token'la BİRLİKTE yeni bir refresh token döner
 * (eski geçersiz kılınır) — mobil sözleşmesi bu alanı bekler.
 */
export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/** logout çıktısı. */
export interface LogoutResult {
  message: string;
}

/**
 * Üretilen refresh token + kalıcılaştırma için gereken kimlik/son kullanım bilgisi.
 * `jti` sunucuda `refresh_tokens.id` olarak saklanır; `expiresAt` JWT `exp` ile hizalıdır.
 */
export interface RefreshTokenIssue {
  token: string;
  jti: string;
  expiresAt: Date;
}

/** Sunucudaki refresh token kaydının servise dönen görünümü. */
export interface RefreshTokenRecord {
  id: string;
  familyId: string;
  userId: string;
  status: RefreshTokenStatus;
  rotatedAt: Date | null;
  expiresAt: Date;
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
  /**
   * Verilen aile (`fam`) için yeni bir refresh token üretir. `jti` içeride türetilir (kimlik
   * token'a gömülür) ve `expiresAt` ile birlikte döner — çağıran bunları kalıcılaştırır.
   */
  generateRefreshToken(input: { sub: string; fam: string }): RefreshTokenIssue;
  /** Süresi dolmuş → TOKEN_EXPIRED, geçersiz → TOKEN_INVALID (AuthenticationError). */
  verifyAccessToken(token: string): JwtPayload;
  /** `jti`/`fam` claim'leri eksikse TOKEN_INVALID; süresi dolmuşsa TOKEN_EXPIRED. */
  verifyRefreshToken(token: string): RefreshPayload;
}

/**
 * Refresh token oturum ailelerinin kalıcı deposu (rotasyon + reuse tespiti).
 * Access token'lar stateless kaldığından yalnızca refresh token'lar burada izlenir.
 */
export interface IRefreshTokenStore {
  /** Yeni bir ACTIVE kayıt yazar (login/register yeni aile, ya da rotasyonun yeni halkası). */
  create(record: {
    jti: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  /** jti ile kaydı getirir; yoksa null. */
  findByJti(jti: string): Promise<RefreshTokenRecord | null>;
  /**
   * Kaydı ACTIVE→ROTATED'a atomik geçirir (koşullu update). `true` dönerse bu çağrı token'ı
   * "tüketmiştir" (rotasyon sahibi); `false` ise başka bir istek önce rotate etmiş demektir
   * (yarış) — çağıran grace/reuse dalına düşer.
   */
  markRotated(jti: string, rotatedAt: Date): Promise<boolean>;
  /** Bir oturum ailesinin tüm kayıtlarını REVOKED yapar (reuse tespiti / oturum-bazlı logout). */
  revokeFamily(familyId: string): Promise<void>;
  /**
   * Bir kullanıcının TÜM ailelerini REVOKED yapar. Şifre değişimi / global çıkış içindir —
   * ilgili endpoint eklendiğinde çağrılır (bkz. CLAUDE.md refresh rotasyon kararı).
   */
  revokeAllForUser(userId: string): Promise<void>;
  /** Süresi geçmiş kayıtları siler (login'de fırsatçı temizlik — cron yok). */
  deleteExpired(userId: string): Promise<void>;
}

/**
 * Kimlik doğrulama iş mantığı. Beklenen hatalar Result.fail ile döner.
 */
export interface IAuthService {
  register(dto: RegisterDTO): Promise<Result<AuthTokens>>;
  login(dto: LoginDTO): Promise<Result<AuthTokens>>;
  refresh(dto: RefreshDTO): Promise<Result<RefreshResult>>;
  logout(dto: LogoutDTO): Promise<Result<LogoutResult>>;
}
