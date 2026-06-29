import { CONSTANTS } from '@config/constants';
import type { IOtpParser } from './otp.interfaces';

/**
 * Tam olarak `CODE_LENGTH` haneli bir string'i doğrulayan anchored regex.
 * `CODE_REGEX`'in `g` flag'li (stateful) olmasının yan etkilerinden kaçınmak için
 * validate'te ayrı, global olmayan bir kalıp kullanılır.
 */
const EXACT_CODE_REGEX = new RegExp(`^\\d{${CONSTANTS.OTP.CODE_LENGTH}}$`);

/**
 * SMS metninden OTP kodu çıkaran parser.
 * Tamamen SYNC (CPU işi, I/O yok — CLAUDE.md async/sync kuralı).
 */
export class OtpParser implements IOtpParser {
  /**
   * SMS metnindeki tüm geçerli OTP adaylarını bulur ve sonuncusunu döner.
   * Birçok SMS önce referans/tutar sonra kodu içerdiğinden sonuncu daha güvenilirdir.
   *
   * @param smsText Ham SMS metni
   * @returns Geçerli OTP kodu ya da bulunamazsa `null`
   */
  extract(smsText: string): string | null {
    // String.match + global regex tüm eşleşmeleri döner ve lastIndex'i sıfırlar (güvenli).
    const matches = smsText.match(CONSTANTS.OTP.CODE_REGEX);
    if (!matches || matches.length === 0) {
      return null;
    }

    const candidate = matches[matches.length - 1];
    if (candidate === undefined || !this.validate(candidate)) {
      return null;
    }
    return candidate;
  }

  /**
   * String'in tam olarak `CODE_LENGTH` haneli bir sayı olup olmadığını döner.
   */
  validate(code: string): boolean {
    return EXACT_CODE_REGEX.test(code);
  }
}
