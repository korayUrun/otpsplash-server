import { AppError } from './AppError';
import { ErrorCode } from './ErrorCode';

/**
 * 400 — İstek gövdesi/parametreleri şema doğrulamasını geçemedi.
 */
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly errorCode = ErrorCode.VALIDATION_ERROR;

  constructor(message = 'Geçersiz istek') {
    super(message, true);
  }
}

/**
 * 401 — Kimlik doğrulama başarısız.
 * `errorCode` override edilebilir: TOKEN_EXPIRED, TOKEN_INVALID.
 * Bilgi sızdırmamak için login'de yanlış şifre ve olmayan e-posta aynı mesajı kullanır.
 */
export class AuthenticationError extends AppError {
  readonly statusCode = 401;
  readonly errorCode: ErrorCode;

  constructor(
    message = 'Kimlik doğrulama başarısız',
    errorCode: ErrorCode = ErrorCode.AUTHENTICATION_FAILED,
  ) {
    super(message, true);
    this.errorCode = errorCode;
  }
}

/**
 * 403 — Kimlik doğrulandı ama yetki yok (rol/üyelik).
 */
export class AuthorizationError extends AppError {
  readonly statusCode = 403;
  readonly errorCode = ErrorCode.FORBIDDEN;

  constructor(message = 'Bu işlem için yetkiniz yok') {
    super(message, true);
  }
}

/**
 * 404 — Kaynak bulunamadı.
 * `errorCode` override edilebilir: USER_NOT_FOUND, PROJECT_NOT_FOUND, OTP_NOT_FOUND.
 */
export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly errorCode: ErrorCode;

  constructor(
    message = 'Kaynak bulunamadı',
    errorCode: ErrorCode = ErrorCode.NOT_FOUND,
  ) {
    super(message, true);
    this.errorCode = errorCode;
  }
}

/**
 * 409 — Kaynak çakışması (örn. e-posta zaten kayıtlı).
 */
export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly errorCode = ErrorCode.CONFLICT;

  constructor(message = 'Kaynak zaten mevcut') {
    super(message, true);
  }
}

/**
 * 422 — SMS metninde geçerli bir OTP kodu bulunamadı.
 */
export class OtpParseError extends AppError {
  readonly statusCode = 422;
  readonly errorCode = ErrorCode.OTP_NOT_FOUND;

  constructor(message = 'SMS metninde geçerli bir OTP bulunamadı') {
    super(message, true);
  }
}

/**
 * 500 — Şifreleme/şifre çözme başarısız (bozuk veri veya yanlış anahtar).
 * Beklenmeyen bir durum → `isOperational = false`.
 */
export class OtpEncryptionError extends AppError {
  readonly statusCode = 500;
  readonly errorCode = ErrorCode.OTP_ENCRYPTION_FAILED;

  constructor(message = 'OTP şifreleme işlemi başarısız') {
    super(message, false);
  }
}

/**
 * 401 — Cihaz kimliği (Device Secret) doğrulanamadı.
 * `POST /api/otp` için kullanılır; JWT'den bağımsız cihaz auth katmanıdır.
 * `errorCode` override edilebilir: geçersiz/eksik secret → DEVICE_SECRET_INVALID,
 * revoke edilmiş cihaz → DEVICE_REVOKED.
 */
export class DeviceAuthError extends AppError {
  readonly statusCode = 401;
  readonly errorCode: ErrorCode;

  constructor(
    message = 'Cihaz kimliği doğrulanamadı',
    errorCode: ErrorCode = ErrorCode.DEVICE_SECRET_INVALID,
  ) {
    super(message, true);
    this.errorCode = errorCode;
  }
}

/**
 * 500 — Beklenmeyen sunucu hatası (bug). Mesaj client'a sızdırılmaz.
 */
export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly errorCode = ErrorCode.INTERNAL_ERROR;

  constructor(message = 'Beklenmeyen bir hata oluştu') {
    super(message, false);
  }
}
