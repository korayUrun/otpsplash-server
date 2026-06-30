import { randomBytes } from 'node:crypto';
import { AesGcmOtpEncryptor } from '@modules/otp/otp.encryptor';
import { OtpEncryptionError } from '@errors/errors';
import { CONSTANTS } from '@config/constants';

// Testler env anahtarından bağımsız olsun diye sabit bir test anahtarı kullanılır.
const TEST_KEY = randomBytes(32).toString('hex');
const encryptor = new AesGcmOtpEncryptor(TEST_KEY);

describe('AesGcmOtpEncryptor', () => {
  describe('roundtrip', () => {
    it('encrypt → decrypt orijinal kodu döner', () => {
      const plain = '847291';
      const encrypted = encryptor.encrypt(plain);
      expect(encryptor.decrypt(encrypted)).toBe(plain);
    });

    it('payload base64(iv):base64(authTag):base64(ciphertext) formatındadır', () => {
      const encrypted = encryptor.encrypt('123456');
      const parts = encrypted.split(CONSTANTS.OTP.SEPARATOR);
      expect(parts).toHaveLength(3);

      const [ivB64, authTagB64] = parts as [string, string, string];
      expect(Buffer.from(ivB64, 'base64')).toHaveLength(CONSTANTS.OTP.IV_LENGTH);
      expect(Buffer.from(authTagB64, 'base64')).toHaveLength(
        CONSTANTS.OTP.AUTH_TAG_LENGTH,
      );
    });

    it('düz metin asla ciphertext içinde görünmez', () => {
      const plain = '847291';
      const encrypted = encryptor.encrypt(plain);
      expect(encrypted).not.toContain(plain);
    });
  });

  describe('IV randomness', () => {
    it('aynı kod her seferinde farklı ciphertext üretir', () => {
      const a = encryptor.encrypt('123456');
      const b = encryptor.encrypt('123456');
      expect(a).not.toBe(b);
      // Ama ikisi de aynı koda çözülür.
      expect(encryptor.decrypt(a)).toBe('123456');
      expect(encryptor.decrypt(b)).toBe('123456');
    });
  });

  describe('decrypt hata yolları', () => {
    it('bozuk ciphertext → OtpEncryptionError', () => {
      const encrypted = encryptor.encrypt('123456');
      const parts = encrypted.split(CONSTANTS.OTP.SEPARATOR);
      const [iv, authTag] = parts as [string, string, string];
      const tampered = [iv, authTag, Buffer.from('bozuk').toString('base64')].join(
        CONSTANTS.OTP.SEPARATOR,
      );
      expect(() => encryptor.decrypt(tampered)).toThrow(OtpEncryptionError);
    });

    it('yanlış authTag → OtpEncryptionError', () => {
      const encrypted = encryptor.encrypt('123456');
      const parts = encrypted.split(CONSTANTS.OTP.SEPARATOR);
      const [iv, , ciphertext] = parts as [string, string, string];
      const wrongTag = randomBytes(CONSTANTS.OTP.AUTH_TAG_LENGTH).toString('base64');
      const tampered = [iv, wrongTag, ciphertext].join(CONSTANTS.OTP.SEPARATOR);
      expect(() => encryptor.decrypt(tampered)).toThrow(OtpEncryptionError);
    });

    it('biçimsiz payload (eksik bileşen) → OtpEncryptionError', () => {
      expect(() => encryptor.decrypt('sadece-bir-parca')).toThrow(
        OtpEncryptionError,
      );
    });

    it('IV boyutu 16 byte değilse → OtpEncryptionError', () => {
      const encrypted = encryptor.encrypt('123456');
      const [, authTag, ciphertext] = encrypted.split(
        CONSTANTS.OTP.SEPARATOR,
      ) as [string, string, string];
      // 3 bileşen var ama IV boyutu geçersiz (8 byte).
      const badIv = randomBytes(8).toString('base64');
      const payload = [badIv, authTag, ciphertext].join(CONSTANTS.OTP.SEPARATOR);
      expect(() => encryptor.decrypt(payload)).toThrow(OtpEncryptionError);
    });

    it('authTag boyutu 16 byte değilse → OtpEncryptionError', () => {
      const encrypted = encryptor.encrypt('123456');
      const [iv, , ciphertext] = encrypted.split(CONSTANTS.OTP.SEPARATOR) as [
        string,
        string,
        string,
      ];
      // IV doğru boyutta ama authTag geçersiz (8 byte).
      const badTag = randomBytes(8).toString('base64');
      const payload = [iv, badTag, ciphertext].join(CONSTANTS.OTP.SEPARATOR);
      expect(() => encryptor.decrypt(payload)).toThrow(OtpEncryptionError);
    });

    it('yanlış anahtarla şifrelenen veri çözülemez → OtpEncryptionError', () => {
      const other = new AesGcmOtpEncryptor(randomBytes(32).toString('hex'));
      const encrypted = other.encrypt('123456');
      expect(() => encryptor.decrypt(encrypted)).toThrow(OtpEncryptionError);
    });
  });

  describe('anahtar doğrulama', () => {
    it('32 byte olmayan anahtar → OtpEncryptionError', () => {
      expect(() => new AesGcmOtpEncryptor('abcd')).toThrow(OtpEncryptionError);
    });
  });
});
