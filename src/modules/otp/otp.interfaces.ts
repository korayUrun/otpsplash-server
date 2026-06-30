import type { OTPLog, Source } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type { TargetUser } from '@modules/routing/routing.interfaces';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/otp` iş katmanı girişi.
 * `smsText` veya `code`'dan en az biri dolu olmalı; `projectId`/`deviceId`/`receiverId`
 * body'den değil doğrulanmış cihazdan (`req.device`) gelir — proje izolasyonu + kaynak izleme.
 *
 * `serviceId` FAZ 7'de geçici olarak body'den (opsiyonel) alınır; FAZ 8'de bu alan kalkar
 * ve `senderRaw`/`serviceHint` sinyallerinden backend'de çözümlenir (bkz. CLAUDE.md FAZ 8).
 */
export interface ProcessOtpDTO {
  smsText?: string;
  code?: string;
  source: Source;
  projectId: string;
  /** OTP'yi gönderen cihaz (Device Secret ile doğrulandı) — kaynak izleme/analiz. */
  deviceId: string;
  /** Sahiplik kaynağı — doğrulanmış cihazın sahibi (`req.device.userId`), deviceId'den bağımsız. */
  receiverId: string;
  /** Çözümlenen servis (FAZ 7 interim: body'den); yoksa kimseye gitmez. */
  serviceId?: string;
}

/** `POST /api/otp` başarı çıktısı. */
export interface ProcessOtpResult {
  message: string;
  /** Routing kuralına göre OTP'nin iletildiği hedef developer sayısı. */
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

/** `PATCH /api/otp/:id/sharing` çıktısı. */
export interface ToggleSharingResult {
  sharingActive: boolean;
}

/** `GET /api/otp/:id/sharing` çıktısı — bu OTP şu an kimlerle paylaşılıyor (salt-okunur). */
export interface SharingTargetsResult {
  targets: TargetUser[];
}

/** Repository'ye kaydetmek için gereken alanlar (id/createdAt DB tarafından üretilir). */
export interface CreateOtpLogData {
  encryptedCode: string;
  source: Source;
  projectId: string;
  /** Kaydı oluşturan cihaz; ilişki SetNull olduğundan opsiyonel tutulur. */
  deviceId?: string;
  /** Sahiplik kaynağı — deviceId null'a düşse bile kalıcı. */
  receiverId: string;
  /** Çözümlenen servis; çözülemezse null. */
  serviceId?: string;
  expiresAt: Date;
}

/** Socket üzerinden developer ekranına anlık yayınlanan OTP yükü (düz kod). */
export interface OtpNotification {
  id: string;
  code: string;
  source: Source;
  createdAt: Date;
}

/** `otp:revoked` event yükü — developer UI'ının ilgili kartı kaldırması için sinyal. */
export interface OtpRevokedNotification {
  otpId: string;
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
  /** OTP'yi id ile getirir (sahiplik/servis kontrolü için); yoksa `null`. */
  findById(id: string): Promise<OTPLog | null>;
  /**
   * Projeye ait, süresi dolmamış ve paylaşımı AÇIK kayıtları sayfalı döner (createdAt desc).
   * `sharingActive: false` olanlar history'de görünmez (FAZ 7).
   */
  findByProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OTPLog>>;
  /** Paylaşım durumunu günceller (sahiplik service'te receiverId ile doğrulanır). */
  updateSharingActive(otpId: string, isActive: boolean): Promise<OTPLog>;
  /** Süresi geçmiş tüm kayıtları siler; silinen kayıt sayısını döner. */
  deleteExpired(): Promise<number>;
}

/**
 * Gerçek zamanlı bildirim port'u (adapter: Socket.IO). Emit fire-and-forget — SYNC.
 */
export interface IOtpNotifier {
  /**
   * OTP'yi hedef developer'ların bireysel `user:` odalarına yayınlar (FAZ 7 hedefli dağıtım).
   * @returns Emit edilen hedef developer sayısı ("deliveredTo").
   */
  notify(targetUserIds: string[], payload: OtpNotification): number;
  /**
   * Paylaşımı durdurulan OTP için `otp:revoked` event'ini hedef developer'lara yayınlar.
   * `notify` ile aynı (user-bazlı) hedeflemeyi kullanır — çift emit önlenir.
   */
  notifyRevoked(otpId: string, targetUserIds: string[]): void;
}

/**
 * OTP iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IOtpService {
  processAndDeliver(dto: ProcessOtpDTO): Promise<Result<ProcessOtpResult>>;
  getHistory(dto: GetHistoryDTO): Promise<Result<PaginatedResult<OtpHistoryItem>>>;
  /**
   * OTP paylaşımını aç/kapat. Sahiplik `OTPLog.receiverId` üzerinden doğrulanır
   * (deviceId null olsa bile çalışır). Kapatıldığında hedef developer'lara `otp:revoked` gider.
   */
  toggleSharing(
    otpId: string,
    receiverId: string,
    isActive: boolean,
  ): Promise<Result<ToggleSharingResult>>;
  /** Bu OTP'nin şu an kimlerle paylaşıldığını salt-okunur döner (sahibi görebilir). */
  getSharingTargets(
    otpId: string,
    receiverId: string,
  ): Promise<Result<SharingTargetsResult>>;
}
