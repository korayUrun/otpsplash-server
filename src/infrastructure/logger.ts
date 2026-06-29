import pino, { type Logger as PinoLogger } from 'pino';
import { env, isProduction } from '@config/env';

/**
 * Uygulama logger arayüzü. Service/middleware'ler concrete pino'ya değil
 * bu arayüze bağımlı olur (DIP).
 */
export interface ILogger {
  fatal(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  trace(obj: unknown, msg?: string): void;
  /** Alt bağlam (örn. requestId) ile türetilmiş logger. */
  child(bindings: Record<string, unknown>): ILogger;
}

/**
 * Hassas alanlar asla loglanmaz (CLAUDE.md güvenlik kuralı 6).
 */
const REDACT_PATHS = [
  'body.password',
  'body.code',
  'body.smsText',
  'headers.authorization',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

const baseLogger: PinoLogger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // Geliştirmede okunabilir çıktı, production'da JSON structured.
  transport: isProduction()
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
});

export const logger: ILogger = baseLogger;
