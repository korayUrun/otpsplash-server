import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '@config/env';
import { AuthenticationError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { JwtPayload, RefreshPayload } from '@app-types/index';
import type { ITokenService } from './auth.interfaces';

/** Env'den gelen süre stringleri ('15m', '30d') jsonwebtoken'ın beklediği tipe daraltılır. */
const ACCESS_EXPIRES = env.JWT_ACCESS_EXPIRES as SignOptions['expiresIn'];
const REFRESH_EXPIRES = env.JWT_REFRESH_EXPIRES as SignOptions['expiresIn'];

/**
 * jsonwebtoken tabanlı token servisi.
 * sign/verify sync'tir (CLAUDE.md: JWT hızlı, iç araç için yeterli).
 * Access ve refresh FARKLI secret'larla imzalanır (güvenlik kuralı 1).
 */
export class JwtTokenService implements ITokenService {
  generateAccessToken(payload: JwtPayload): string {
    return jwt.sign(
      { email: payload.email, role: payload.role, projectId: payload.projectId },
      env.JWT_ACCESS_SECRET,
      { subject: payload.sub, expiresIn: ACCESS_EXPIRES },
    );
  }

  generateRefreshToken(payload: RefreshPayload): string {
    return jwt.sign({}, env.JWT_REFRESH_SECRET, {
      subject: payload.sub,
      expiresIn: REFRESH_EXPIRES,
    });
  }

  verifyAccessToken(token: string): JwtPayload {
    const decoded = this.verify(token, env.JWT_ACCESS_SECRET);

    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.role !== 'string' ||
      typeof decoded.projectId !== 'string'
    ) {
      throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
    }

    return {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role as Role,
      projectId: decoded.projectId,
    };
  }

  verifyRefreshToken(token: string): RefreshPayload {
    const decoded = this.verify(token, env.JWT_REFRESH_SECRET);

    if (typeof decoded.sub !== 'string') {
      throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
    }

    return { sub: decoded.sub };
  }

  /**
   * Ortak doğrulama: jsonwebtoken hatalarını AuthenticationError'a çevirir.
   * Süresi dolmuş → TOKEN_EXPIRED, diğer her geçersizlik → TOKEN_INVALID.
   */
  private verify(token: string, secret: string): jwt.JwtPayload {
    try {
      const decoded = jwt.verify(token, secret);
      if (typeof decoded === 'string') {
        throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
      }
      return decoded;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError(
          'Token süresi doldu',
          ErrorCode.TOKEN_EXPIRED,
        );
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
      }
      throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
    }
  }
}

/** Middleware ve diğer modüllerin paylaştığı singleton. */
export const tokenService: ITokenService = new JwtTokenService();
