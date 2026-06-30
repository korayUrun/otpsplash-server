import type { Device, Platform } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { DevicePayload } from '@app-types/index';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/devices/register` iş katmanı girişi.
 * `userId`/`projectId` body'den değil kimliği doğrulanmış kullanıcıdan
 * (`req.user`) gelir — cihaz daima onu kaydeden RECEIVER'a ve projesine bağlanır.
 */
export interface RegisterDeviceDto {
  platform: Platform;
  userId: string;
  projectId: string;
  /** Receiver beyanı (opsiyonel) — "İş Telefonum" gibi. SMS'ten türetilmez. */
  deviceName?: string;
  /** Receiver beyanı (opsiyonel) telefon numarası. SMS'ten türetilmez. */
  phoneNumber?: string;
}

/**
 * `POST /api/devices/register` başarı çıktısı.
 * `deviceSecret` düz metin olarak YALNIZCA burada döner; DB'de sadece hash saklanır
 * ve başka hiçbir endpointte bir daha gösterilmez.
 */
export interface DeviceResult {
  deviceId: string;
  deviceSecret: string;
}

/** Repository'ye cihaz oluşturmak için verilen alanlar (id/createdAt DB üretir). */
export interface CreateDeviceData {
  secretHash: string;
  platform: Platform;
  userId: string;
  projectId: string;
  deviceName?: string;
  phoneNumber?: string;
}

/**
 * `GET /api/devices` çıktısındaki güvenli cihaz görünümü.
 * `secretHash` asla dışarı sızdırılmaz (yalnızca DB'de kalır); `deviceName`/`phoneNumber` dahildir.
 */
export interface SafeDevice {
  id: string;
  platform: Platform;
  deviceName: string | null;
  phoneNumber: string | null;
  isRevoked: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

/** Cihaz revoke (silme) işleminin başarı çıktısı. */
export interface DeviceMutationResult {
  message: string;
}

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * Device Secret üretim ve hash servisi.
 * Üretim saf crypto (SYNC); hash/verify argon2id ile CPU-yoğun (ASYNC).
 */
export interface ISecretService {
  /** 256-bit rastgele secret üretir (hex string) — SYNC. */
  generate(): string;
  /** Secret'ı argon2id ile hashler — ASYNC. */
  hash(secret: string): Promise<string>;
  /**
   * Secret ile hash'i karşılaştırır — ASYNC.
   * Eşleşmezse `false` döner (exception fırlatmaz); birçok cihaz gezildiği için
   * eşleşmeme beklenen bir durumdur, hata değil.
   */
  verify(secret: string, hash: string): Promise<boolean>;
}

/**
 * Cihaz kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IDeviceRepository {
  /** Yeni cihaz oluşturur. */
  create(data: CreateDeviceData): Promise<Device>;
  /** Cihazı id ile getirir (revoke sahiplik kontrolü için); yoksa `null`. */
  findById(id: string): Promise<Device | null>;
  /** Bir kullanıcının tüm cihazlarını döner (en yeni önce). */
  findByUser(userId: string): Promise<Device[]>;
  /**
   * Doğrulama için tüm cihazları döner — revoke edilmişler dahil.
   * Secret hash karşılaştırması cihazı tanımladıktan SONRA revoke durumuna bakılır
   * (DEVICE_REVOKED ile DEVICE_SECRET_INVALID'i ayırt edebilmek için).
   */
  findAllForVerification(): Promise<Device[]>;
  /** Cihazı iptal eder (`isRevoked: true`). */
  revoke(id: string): Promise<Device>;
  /** Son kullanım zamanını günceller (auth sonrası fire-and-forget). */
  updateLastUsed(id: string): Promise<void>;
}

/**
 * Cihaz iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IDeviceService {
  /** Cihaz kaydeder ve düz secret'ı (yalnızca bu çağrıda) döner. */
  register(dto: RegisterDeviceDto): Promise<Result<DeviceResult>>;
  /**
   * Düz secret'tan cihaz kimliğini doğrular.
   * Eşleşme yok → DEVICE_SECRET_INVALID; eşleşen cihaz revoke ise → DEVICE_REVOKED.
   */
  verify(plainSecret: string): Promise<Result<DevicePayload>>;
  /** Cihazı iptal eder; yalnızca sahibi yapabilir (aksi halde AuthorizationError). */
  revoke(deviceId: string, requestingUserId: string): Promise<Result<DeviceMutationResult>>;
  /** Kullanıcının kendi cihazlarını güvenli görünümle listeler. */
  list(userId: string): Promise<Result<SafeDevice[]>>;
  /** Son kullanım zamanını günceller (auth middleware fire-and-forget çağırır). */
  touch(deviceId: string): Promise<void>;
}
