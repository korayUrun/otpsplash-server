import { AppError } from '@errors/AppError';
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  OtpParseError,
  OtpEncryptionError,
  InternalError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';

/**
 * Hata hiyerarşisi birim testi.
 * Her sınıfın statusCode/errorCode/isOperational sözleşmesini ve varsayılan
 * mesaj dalını doğrular (default parametreler kapsanır).
 */

describe('AppError alt sınıfları — sözleşme', () => {
  it.each([
    [new ValidationError(), 400, ErrorCode.VALIDATION_ERROR, true],
    [new AuthenticationError(), 401, ErrorCode.AUTHENTICATION_FAILED, true],
    [new AuthorizationError(), 403, ErrorCode.FORBIDDEN, true],
    [new NotFoundError(), 404, ErrorCode.NOT_FOUND, true],
    [new ConflictError(), 409, ErrorCode.CONFLICT, true],
    [new OtpParseError(), 422, ErrorCode.OTP_NOT_FOUND, true],
    [new OtpEncryptionError(), 500, ErrorCode.OTP_ENCRYPTION_FAILED, false],
    [new InternalError(), 500, ErrorCode.INTERNAL_ERROR, false],
  ] as [AppError, number, ErrorCode, boolean][])(
    '%s → doğru statusCode/errorCode/isOperational ve varsayılan mesaj',
    (error, statusCode, errorCode, isOperational) => {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(statusCode);
      expect(error.errorCode).toBe(errorCode);
      expect(error.isOperational).toBe(isOperational);
      // Varsayılan mesaj boş olmamalı (default parametre dalı).
      expect(error.message.length).toBeGreaterThan(0);
      // İsim sınıf adına eşit (stack trace okunabilirliği).
      expect(error.name).toBe(error.constructor.name);
    },
  );

  it('errorCode override edilebilen sınıflar override değeri kullanır', () => {
    const expired = new AuthenticationError('x', ErrorCode.TOKEN_EXPIRED);
    const userMissing = new NotFoundError('x', ErrorCode.USER_NOT_FOUND);
    expect(expired.errorCode).toBe(ErrorCode.TOKEN_EXPIRED);
    expect(userMissing.errorCode).toBe(ErrorCode.USER_NOT_FOUND);
  });
});

describe('AppError varsayılan isOperational', () => {
  /** Yalnızca testte: ikinci argümanı vermeyen alt sınıf → default (true) dalını kapsar. */
  class DefaultOpError extends AppError {
    readonly statusCode = 418;
    readonly errorCode = ErrorCode.INTERNAL_ERROR;
    constructor() {
      super('teapot');
    }
  }

  it('isOperational varsayılan olarak true', () => {
    expect(new DefaultOpError().isOperational).toBe(true);
  });
});
