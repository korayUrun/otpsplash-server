import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Diğer her şeyden önce uygun .env dosyasını yükle.
// NODE_ENV testte 'test' (jest), aksi halde .env kullanılır.
// Production'da dosya yoksa sessizce geçilir; değerler gerçek ortamdan gelir.
// dotenv mevcut process.env değerlerini override etmez — CI/Docker env'i öncelikli kalır.
loadDotenv({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
});

/**
 * Ortam değişkenleri şeması.
 * Fail-fast: eksik/geçersiz değişkende süreç başlangıçta `process.exit(1)` ile durur.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET en az 32 karakter olmalı'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET en az 32 karakter olmalı'),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('30d'),

    OTP_ENCRYPTION_KEY: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'OTP_ENCRYPTION_KEY 64 hex karakter (32 byte) olmalı',
      ),

    DEVICE_SECRET_BYTES: z.coerce.number().int().positive().default(32),

    // ServiceRegistry kurallarının in-memory cache ömrü (ms). Admin yeni kural eklediğinde
    // en geç bu süre içinde devreye girer; 0 → cache devre dışı (her resolve DB'den okur).
    SERVICE_REGISTRY_CACHE_TTL_MS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60_000),

    // cors() middleware ve Socket.IO origin'i. Yerel ağ/mobil testte '*' (wildcard),
    // production'da gerçek origin ile değiştirilir.
    CORS_ORIGIN: z.string().default('*'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET ve JWT_REFRESH_SECRET FARKLI olmalı',
    path: ['JWT_REFRESH_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

/**
 * process.env'i doğrular. Hata varsa açıklayıcı mesaj basıp süreci sonlandırır.
 * Yalnızca startup'ta çağrılır (sync — env okuma kuralı).
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Logger henüz hazır olmayabilir; startup hatası doğrudan stderr'e yazılır.
    process.stderr.write(
      `\n[env] Ortam değişkeni doğrulaması başarısız:\n${issues}\n\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = (): boolean => env.NODE_ENV === 'production';
export const isTest = (): boolean => env.NODE_ENV === 'test';
