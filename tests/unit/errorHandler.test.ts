import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from '@middleware/errorHandler';
import { logger } from '@infrastructure/logger';
import {
  ValidationError,
  InternalError,
  AuthenticationError,
} from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';

/**
 * Global errorHandler birim testi.
 * Üç dal: operasyonel AppError (warn), operasyonel-olmayan AppError (error),
 * beklenmeyen hata (500 INTERNAL_ERROR, mesaj/stack sızdırmaz).
 */

const REQUEST_ID = 'req-123';

interface ResMock {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
}

function buildRes(): ResMock {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

const req = { id: REQUEST_ID } as unknown as Request;
const next = jest.fn() as unknown as NextFunction;

describe('errorHandler', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('operasyonel AppError → kendi statusCode/errorCode ile döner, warn loglar', () => {
    const { res, status, json } = buildRes();
    const err = new ValidationError('Geçersiz alan');

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Geçersiz alan' },
      requestId: REQUEST_ID,
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('errorCode override edilen AppError korunur (TOKEN_EXPIRED)', () => {
    const { res, status, json } = buildRes();
    const err = new AuthenticationError('Süre doldu', ErrorCode.TOKEN_EXPIRED);

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: ErrorCode.TOKEN_EXPIRED, message: 'Süre doldu' },
      requestId: REQUEST_ID,
    });
  });

  it('operasyonel-olmayan AppError → error seviyesinde loglanır', () => {
    const { res, status } = buildRes();
    const err = new InternalError();

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('beklenmeyen (AppError olmayan) hata → 500 INTERNAL_ERROR, mesaj sızmaz', () => {
    const { res, status, json } = buildRes();
    const err = new Error('Veritabanı bağlantısı koptu: secret-host');

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Beklenmeyen bir hata oluştu',
      },
      requestId: REQUEST_ID,
    });
    // Orijinal hata mesajı client zarfına sızmamalı.
    const payload = json.mock.calls[0]?.[0] as { error: { message: string } };
    expect(payload.error.message).not.toContain('secret-host');
    expect(logger.error).toHaveBeenCalled();
  });
});
