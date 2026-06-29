import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto';
import { CONSTANTS } from '@config/constants';
import { env } from '@config/env';
import { OtpEncryptionError } from '@errors/errors';
import type { IOtpEncryptor } from './otp.interfaces';

/** AES-256 anahtarı 32 byte olmalı. */
const KEY_LENGTH = 32;
/** payload = base64(iv):base64(authTag):base64(ciphertext) → tam 3 bileşen. */
const PAYLOAD_PARTS = 3;

/**
 * AES-256-GCM tabanlı OTP şifreleyici (CLAUDE.md güvenlik kuralı 3).
 * encrypt/decrypt native crypto sync API kullanır — SYNC.
 *
 * Format: `base64(iv):base64(authTag):base64(ciphertext)`.
 * Her encrypt için yeni rastgele 16-byte IV üretilir → aynı kod farklı ciphertext.
 */
export class AesGcmOtpEncryptor implements IOtpEncryptor {
  private readonly key: Buffer;
  private readonly algorithm: CipherGCMTypes = CONSTANTS.OTP.ALGORITHM;

  /**
   * @param keyHex 64 hex karakter (32 byte) anahtar. Varsayılan: env.OTP_ENCRYPTION_KEY.
   */
  constructor(keyHex: string = env.OTP_ENCRYPTION_KEY) {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== KEY_LENGTH) {
      throw new OtpEncryptionError('OTP şifreleme anahtarı 32 byte olmalı');
    }
    this.key = key;
  }

  /**
   * Düz metni AES-256-GCM ile şifreler.
   * @returns `base64(iv):base64(authTag):base64(ciphertext)`
   */
  encrypt(plain: string): string {
    const iv = randomBytes(CONSTANTS.OTP.IV_LENGTH);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(CONSTANTS.OTP.SEPARATOR);
  }

  /**
   * Şifreli payload'ı çözer. Her bileşen ayrıştırılır ve boyutu doğrulanır;
   * GCM auth tag doğrulaması `final()`'da yapılır. Herhangi bir adım başarısızsa
   * `OtpEncryptionError` fırlatılır (bozuk veri veya kurcalama).
   */
  decrypt(payload: string): string {
    const parts = payload.split(CONSTANTS.OTP.SEPARATOR);
    if (parts.length !== PAYLOAD_PARTS) {
      throw new OtpEncryptionError('Şifreli OTP formatı geçersiz');
    }

    const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    if (iv.length !== CONSTANTS.OTP.IV_LENGTH) {
      throw new OtpEncryptionError('IV boyutu geçersiz');
    }
    if (authTag.length !== CONSTANTS.OTP.AUTH_TAG_LENGTH) {
      throw new OtpEncryptionError('Auth tag boyutu geçersiz');
    }

    try {
      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      const plain = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plain.toString('utf8');
    } catch {
      // final() auth tag uyuşmazlığında fırlatır → kurcalanmış/bozuk veri.
      throw new OtpEncryptionError();
    }
  }
}
