/**
 * Uygulama genelinde kullanılan sabitler.
 * CLAUDE.md kuralı: magic string/number yok — her şey burada veya enum'da.
 */
export const CONSTANTS = {
  OTP: {
    /** OTP kodu uzunluğu (haneli). */
    CODE_LENGTH: 6,
    /** SMS metninden OTP yakalayan regex (tam 6 haneli sayı grubu). */
    CODE_REGEX: /\b\d{6}\b/g,
    /** AES IV uzunluğu (byte). */
    IV_LENGTH: 16,
    /** AES-GCM authentication tag uzunluğu (byte). */
    AUTH_TAG_LENGTH: 16,
    /** Şifreleme algoritması. */
    ALGORITHM: 'aes-256-gcm',
    /** Şifreli kayıt bileşen ayıracı: base64(iv):base64(authTag):base64(ciphertext). */
    SEPARATOR: ':',
  },
  ARGON2: {
    /** OWASP 2024 önerisi — argon2id. */
    MEMORY_COST: 65536,
    TIME_COST: 3,
    PARALLELISM: 4,
  },
  SOCKET: {
    /**
     * Kullanıcı bazlı oda adı üretici (FAZ 7 hedefli dağıtım).
     * Hedefli OTP/revoked event'leri SADECE bu odalara gider — çift emit önlenir.
     */
    userRoom: (userId: string): string => `user:${userId}`,
    /**
     * Proje bazlı oda adı üretici. FAZ 7 sonrası OTP/revoked için KULLANILMAZ;
     * ileride proje-geneli duyurular gibi farklı bir amaç için saklı tutulur.
     */
    projectRoom: (projectId: string): string => `project:${projectId}`,
    /** Yeni OTP iletildiğinde hedef developer'lara yayınlanan event adı. */
    EVENT_OTP: 'otp:received',
    /** Paylaşımı durdurulan OTP için developer ekranına gönderilen event adı. */
    EVENT_OTP_REVOKED: 'otp:revoked',
  },
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
  },
  RATE_LIMIT: {
    OTP_MAX: 60,
    LOGIN_MAX: 10,
    REGISTER_MAX: 5,
    DEVICE_REGISTER_MAX: 5,
    WINDOW_MS: 60_000,
  },
  DEVICE: {
    /**
     * Cihaz kimliği (Device Secret) başlığı. Express header'ları küçük harfe
     * indirir, bu yüzden değer lowercase tutulur (`req.headers[...]` ile eşleşsin).
     */
    SECRET_HEADER: 'x-device-secret',
  },
  TIME: {
    /** Bir günün milisaniye karşılığı (OTP TTL hesabı). */
    DAY_MS: 24 * 60 * 60 * 1000,
  },
} as const;
