import { OtpParser } from '@modules/otp/otp.parser';

const parser = new OtpParser();

describe('OtpParser.extract', () => {
  it('SMS metnindeki 6 haneli kodu çıkarır', () => {
    expect(parser.extract('Kodunuz: 847291')).toBe('847291');
  });

  it('kod metnin başında/ortasında olsa da bulur', () => {
    expect(parser.extract('123456 numaralı doğrulama kodu')).toBe('123456');
  });

  it('7 haneli sayı için null döner (tam 6 hane değil)', () => {
    expect(parser.extract('Referans no: 1234567')).toBeNull();
  });

  it('5 haneli sayı için null döner', () => {
    expect(parser.extract('Kod: 12345')).toBeNull();
  });

  it('hiç sayı yoksa null döner', () => {
    expect(parser.extract('Merhaba dünya')).toBeNull();
  });

  it('boş string için null döner', () => {
    expect(parser.extract('')).toBeNull();
  });

  it('birden fazla 6 haneli sayı varsa sonuncuyu döner', () => {
    expect(parser.extract('Tutar 100000 TL, kodunuz 654321')).toBe('654321');
  });

  it('uzun bir sayı bloğu içindeki 6 haneyi kod sanmaz', () => {
    // 123456789 → \b sınırları sağlanmadığı için eşleşmez.
    expect(parser.extract('Sipariş 123456789 hazır')).toBeNull();
  });
});

describe('OtpParser.validate', () => {
  it('tam 6 haneli sayı geçerlidir', () => {
    expect(parser.validate('000000')).toBe(true);
    expect(parser.validate('999999')).toBe(true);
  });

  it('6 haneden farklı uzunluk geçersizdir', () => {
    expect(parser.validate('12345')).toBe(false);
    expect(parser.validate('1234567')).toBe(false);
  });

  it('sayı olmayan karakter içeren string geçersizdir', () => {
    expect(parser.validate('12a456')).toBe(false);
    expect(parser.validate(' 123456')).toBe(false);
  });
});
