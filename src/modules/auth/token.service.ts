import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '@config/env';
import { AuthenticationError } from '@errors/errors';
import { ErrorCode } from '@errors/ErrorCode';
import type { JwtPayload, RefreshPayload } from '@app-types/index';
import type { ITokenService, RefreshTokenIssue } from './auth.interfaces';

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

  generateRefreshToken(input: { sub: string; fam: string }): RefreshTokenIssue {
    // jti (token kimliği) burada üretilir — sunucu bu değeri `refresh_tokens.id` olarak saklar,
    // böylece yenilemede token'ı bulup rotate/reuse kararı verir. `fam` aile claim'i.
    const jti = randomUUID();
    const token = jwt.sign({ fam: input.fam }, env.JWT_REFRESH_SECRET, {
      subject: input.sub,
      jwtid: jti,
      expiresIn: REFRESH_EXPIRES,
    });
    // exp'i imzalı token'dan oku — TTL parse mantığını burada tekrarlamadan expiresAt türet.
    const decoded = jwt.decode(token);
    const exp =
      typeof decoded === 'object' && decoded !== null && typeof decoded.exp === 'number'
        ? decoded.exp
        : 0;
    return { token, jti, expiresAt: new Date(exp * 1000) };
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

    // `jti` standart claim'dir; jsonwebtoken bunu `decoded.jti`'ye koyar. `fam` özel claim.
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.jti !== 'string' ||
      typeof decoded.fam !== 'string'
    ) {
      throw new AuthenticationError('Geçersiz token', ErrorCode.TOKEN_INVALID);
    }

    return { sub: decoded.sub, jti: decoded.jti, fam: decoded.fam };
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
