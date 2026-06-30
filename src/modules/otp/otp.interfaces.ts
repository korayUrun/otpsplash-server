import type { OTPLog, Source } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/otp` iş katmanı girişi.
 * `smsText` veya `code`'dan en az biri dolu olmalı; `projectId`/`deviceId` body'den
 * değil doğrulanmış cihazdan (`req.device`) gelir — proje izolasyonu + kaynak izleme.
 */
export interface ProcessOtpDTO {
  smsText?: string;
  code?: string;
  source: Source;
  projectId: string;
  /** OTP'yi gönderen cihaz (Device Secret ile doğrulandı) — kaynak izleme/analiz. */
  deviceId: string;
}

/** `POST /api/otp` başarı çıktısı. */
export interface ProcessOtpResult {
  message: string;
  /** O an proje odasında bulunan (OTP'yi anlık alan) bağlı developer sayısı. */
  deliveredTo: number;
}

/** Geçmiş sorgusu girişi (sayfalama + proje kapsamı). */
export interface GetHistoryDTO extends PaginationOptions {
  projectId: string;
}

/** Geçmiş kaydının client'a dönülen, şifresi çözülmüş görünümü. */
export interface OtpHistoryItem {
  id: string;
  code: string;
  source: Source;
  createdAt: Date;
  expiresAt: Date;
}

/** Repository'ye kaydetmek için gereken alanlar (id/createdAt DB tarafından üretilir). */
export interface CreateOtpLogData {
  encryptedCode: string;
  source: Source;
  projectId: string;
  /** Kaydı oluşturan cihaz; ilişki SetNull olduğundan opsiyonel tutulur. */
  deviceId?: string;
  expiresAt: Date;
}

/** Socket üzerinden developer ekranına anlık yayınlanan OTP yükü (düz kod). */
export interface OtpNotification {
  id: string;
  code: string;
  source: Source;
  createdAt: Date;
}

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * SMS metninden OTP kodu çıkarma. Saf CPU işi — SYNC (CLAUDE.md async/sync kuralı).
 */
export interface IOtpParser {
  /**
   * SMS metninden OTP kodunu çıkarır. Birden fazla aday varsa sonuncuyu döner.
   * @returns Geçerli kod ya da bulunamazsa `null`.
   */
  extract(smsText: string): string | null;
  /** Verilen string'in tam olarak geçerli bir OTP kodu olup olmadığını döner. */
  validate(code: string): boolean;
}

/**
 * AES-256-GCM şifreleme. Native crypto sync API — SYNC.
 */
export interface IOtpEncryptor {
  /** Düz kodu `base64(iv):base64(authTag):base64(ciphertext)` formatına şifreler. */
  encrypt(plain: string): string;
  /** Şifreli payload'ı çözer; bozuk veri/yanlış tag → OtpEncryptionError. */
  decrypt(payload: string): string;
}

/**
 * OTP kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IOtpRepository {
  /** Yeni OTP kaydı oluşturur. */
  save(data: CreateOtpLogData): Promise<OTPLog>;
  /** Projeye ait, süresi dolmamış kayıtları sayfalı döner (createdAt desc). */
  findByProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OTPLog>>;
  /** Süresi geçmiş tüm kayıtları siler; silinen kayıt sayısını döner. */
  deleteExpired(): Promise<number>;
}

/**
 * Gerçek zamanlı bildirim port'u (adapter: Socket.IO). Emit fire-and-forget — SYNC.
 */
export interface IOtpNotifier {
  /**
   * OTP'yi projenin odasına yayınlar.
   * @returns O an odada bulunan alıcı sayısı (best-effort).
   */
  notify(projectId: string, payload: OtpNotification): number;
}

/**
 * OTP iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IOtpService {
  processAndDeliver(dto: ProcessOtpDTO): Promise<Result<ProcessOtpResult>>;
  getHistory(dto: GetHistoryDTO): Promise<Result<PaginatedResult<OtpHistoryItem>>>;
}
