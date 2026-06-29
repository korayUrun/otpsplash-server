import argon2 from 'argon2';
import { CONSTANTS } from '@config/constants';
import { AuthenticationError } from '@errors/errors';
import type { IPasswordService } from './auth.interfaces';

/**
 * argon2id tabanlı parola servisi (OWASP 2024 parametreleri).
 * Hash/verify CPU-yoğundur ve event loop'u bloklamamak için async'tir
 * (sync API'leri CLAUDE.md tarafından yasaklı).
 */
export class Argon2PasswordService implements IPasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: CONSTANTS.ARGON2.MEMORY_COST,
    timeCost: CONSTANTS.ARGON2.TIME_COST,
    parallelism: CONSTANTS.ARGON2.PARALLELISM,
  };

  /**
   * Düz parolayı argon2id ile hashler.
   * @returns Encode edilmiş hash (`$argon2id$...`).
   */
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /**
   * Hash ile düz parolayı karşılaştırır.
   * Yanlış parola → `false` döner. Bozuk/biçimsiz hash argon2 exception'ı
   * fırlatır; bu yakalanıp `AuthenticationError`'a çevrilir (bilgi sızdırma yok).
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      throw new AuthenticationError();
    }
  }
}
