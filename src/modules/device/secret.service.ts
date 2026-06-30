import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import type { ISecretService } from './device.interfaces';

/**
 * Device Secret servisi.
 *
 * Üretim `crypto.randomBytes` ile SYNC'tir (256-bit, hex). Hash/verify ise
 * argon2id ile CPU-yoğun olduğu için ASYNC'tir — parola servisiyle aynı OWASP 2024
 * parametrelerini (CONSTANTS.ARGON2) kullanır.
 *
 * @remarks Parola servisinden farklı olarak `verify` yanlış secret'ta exception
 * fırlatmaz, `false` döner: doğrulama sırasında birçok cihaz gezilir ve eşleşmeme
 * normal akışın parçasıdır, bir hata değildir.
 */
export class SecretService implements ISecretService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: CONSTANTS.ARGON2.MEMORY_COST,
    timeCost: CONSTANTS.ARGON2.TIME_COST,
    parallelism: CONSTANTS.ARGON2.PARALLELISM,
  };

  /**
   * 256-bit (DEVICE_SECRET_BYTES) rastgele secret üretir.
   * @returns Hex string (32 byte → 64 karakter).
   */
  generate(): string {
    return randomBytes(env.DEVICE_SECRET_BYTES).toString('hex');
  }

  /** Düz secret'ı argon2id ile hashler. */
  async hash(secret: string): Promise<string> {
    return argon2.hash(secret, this.options);
  }

  /**
   * Hash ile düz secret'ı karşılaştırır. Eşleşmezse veya hash bozuksa `false`.
   */
  async verify(secret: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      return false;
    }
  }
}

/** Middleware ve route'ların paylaştığı singleton (stateless — yeniden kullanılır). */
export const secretService: ISecretService = new SecretService();
