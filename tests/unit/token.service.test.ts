import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import { JwtTokenService } from '@modules/auth/token.service';
import { AuthenticationError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { JwtPayload } from '@app-types/index';

const service = new JwtTokenService();

const samplePayload: JwtPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'dev@test.com',
  role: Role.DEVELOPER,
  projectId: '22222222-2222-2222-2222-222222222222',
};

/** Fırlatılan hatayı yakalayıp tip + errorCode doğrular. */
function expectAuthError(fn: () => unknown, code: ErrorCode): void {
  expect(fn).toThrow(AuthenticationError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).errorCode).toBe(code);
  }
}

describe('JwtTokenService', () => {
  describe('generateAccessToken', () => {
    it('geçerli bir JWT üretir (üç parçalı)', () => {
      const token = service.generateAccessToken(samplePayload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('verifyAccessToken', () => {
    it('doğru payload döner', () => {
      const token = service.generateAccessToken(samplePayload);
      const decoded = service.verifyAccessToken(token);

      expect(decoded.sub).toBe(samplePayload.sub);
      expect(decoded.email).toBe(samplePayload.email);
      expect(decoded.role).toBe(samplePayload.role);
      expect(decoded.projectId).toBe(samplePayload.projectId);
    });

    it('süresi dolmuş token → AuthenticationError (TOKEN_EXPIRED)', () => {
      const expired = jwt.sign(
        { email: samplePayload.email, role: samplePayload.role, projectId: samplePayload.projectId },
        env.JWT_ACCESS_SECRET,
        { subject: samplePayload.sub, expiresIn: -10 },
      );
      expectAuthError(() => service.verifyAccessToken(expired), ErrorCode.TOKEN_EXPIRED);
    });

    it('geçersiz imza → AuthenticationError (TOKEN_INVALID)', () => {
      const wrongSecret = jwt.sign(
        { email: samplePayload.email, role: samplePayload.role, projectId: samplePayload.projectId },
        'a_different_secret_at_least_32_characters_long',
        { subject: samplePayload.sub, expiresIn: '15m' },
      );
      expectAuthError(() => service.verifyAccessToken(wrongSecret), ErrorCode.TOKEN_INVALID);
    });

    it('bozuk/biçimsiz token → AuthenticationError (TOKEN_INVALID)', () => {
      expectAuthError(() => service.verifyAccessToken('not.a.jwt'), ErrorCode.TOKEN_INVALID);
    });
  });

  describe('verifyRefreshToken', () => {
    it('refresh token sub döner', () => {
      const token = service.generateRefreshToken({ sub: samplePayload.sub });
      expect(service.verifyRefreshToken(token).sub).toBe(samplePayload.sub);
    });

    it('access secret ile imzalanmış token refresh olarak geçersiz', () => {
      const access = service.generateAccessToken(samplePayload);
      expectAuthError(() => service.verifyRefreshToken(access), ErrorCode.TOKEN_INVALID);
    });
  });
});
