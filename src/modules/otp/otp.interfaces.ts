import type { OTPLog, Prisma, Source } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { PaginatedResult, PaginationOptions } from '@app-types/index';
import type {
  TargetUser,
  VisibleReceiver,
} from '@modules/routing/routing.interfaces';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/otp` iş katmanı girişi.
 * `code` cihazda parse edilmiş 6 haneli koddur (format Zod'da doğrulanır, service tekrar etmez).
 * `senderRaw` developer'a gösterilecek gönderici etiketidir (ham gönderici kimliği; SMS gövdesi
 * DEĞİL). `projectId`/`deviceId`/`receiverId` body'den değil doğrulanmış cihazdan (`req.device`)
 * gelir — proje izolasyonu + kaynak izleme + sahiplik.
 */
export interface ProcessOtpDTO {
  code: string;
  source: Source;
  /** Ham gönderici kimliği — developer'a gösterilecek etiket (zorunlu). */
  senderRaw: string;
  /** Opsiyonel serbest metin bağlam etiketi — gelmezse `null`. */
  context: string | null;
  projectId: string;
  /** OTP'yi gönderen cihaz (Device Secret ile doğrulandı) — kaynak izleme/analiz. */
  deviceId: string;
  /** Sahiplik kaynağı — doğrulanmış cihazın sahibi (`req.device.userId`), deviceId'den bağımsız. */
  receiverId: string;
}

/** `POST /api/otp` başarı çıktısı. */
export interface ProcessOtpResult {
  message: string;
  /** Routing kuralına göre OTP'nin iletildiği hedef developer sayısı. */
  deliveredTo: number;
}

/**
 * Developer geçmiş sorgusu girişi. `projectId` izolasyon güvencesidir; asıl süzme
 * `developerId`'ye aktif kuralla yönlendirilen receiver'lara göre yapılır
 * (canlı emit'le aynı routing çözümü — kural yoksa boş feed).
 */
export interface GetHistoryDTO extends PaginationOptions {
  projectId: string;
  developerId: string;
}

/** Receiver geçmiş sorgusu — kendi kayıtları (receiverId ile süzülür). */
export interface GetReceiverHistoryDTO extends PaginationOptions {
  receiverId: string;
  /** Proje izolasyonu güvencesi (savunma amaçlı; sorgu receiverId ile zaten dar). */
  projectId: string;
}

/** Admin özet sorgusu — projedeki TÜM receiver'lardan gelen tüm OTP'ler. */
export interface GetAllOtpDTO extends PaginationOptions {
  projectId: string;
}

/** OTP'yi üreten receiver'ın kimlik bilgisi (developer'a "kimden geldi" gösterimi). */
export interface OtpReceiverInfo {
  /** Görünen ad; opsiyonel. Mobil `name ?? email` fallback yapar. */
  name: string | null;
  email: string;
  /** Receiver'ın hesap iletişim numarası; opsiyonel. */
  phoneNumber: string | null;
}

/**
 * OTP'yi gönderen cihazın bilgisi. Cihaz silinmişse (deviceId null'a düştüyse) `null` —
 * sahiplik korunur ama cihaz adı kaybolur (CLAUDE.md kademeli bozulma kararı).
 */
export interface OtpDeviceInfo {
  /** Receiver'ın beyan ettiği cihaz adı (device.deviceName); yoksa null. */
  name: string | null;
}

/**
 * Geçmiş kaydının client'a dönülen, şifresi çözülmüş görünümü (developer + admin özeti).
 * OTP süresiz olduğundan `expiresAt` yoktur; `createdAt` "ne zaman geldi" bilgisidir.
 */
export interface OtpHistoryItem {
  id: string;
  code: string;
  source: Source;
  createdAt: Date;
  /** Ham gönderici kimliği — developer'a gösterilecek etiket; eski kayıtlarda null. */
  senderRaw: string | null;
  /** Opsiyonel serbest metin bağlam etiketi; gelmediyse/eski kayıtlarda null. */
  context: string | null;
  receiver: OtpReceiverInfo;
  device: OtpDeviceInfo | null;
}

/** Receiver'a dönen zengin geçmiş kaydı (paylaşım durumuyla). */
export interface ReceiverOtpHistoryItem {
  id: string;
  code: string;
  source: Source;
  createdAt: Date;
  sharingActive: boolean;
  /** Ham gönderici kimliği; eski kayıtlarda null. */
  senderRaw: string | null;
  /** Opsiyonel serbest metin bağlam etiketi; gelmediyse/eski kayıtlarda null. */
  context: string | null;
  receiver: OtpReceiverInfo;
  device: OtpDeviceInfo | null;
}

/** receiver + device ilişkileri include edilmiş OTPLog (save/history dönüşü). */
export type OtpLogWithRelations = Prisma.OTPLogGetPayload<{
  include: { receiver: true; device: true };
}>;

/** `PATCH /api/otp/:id/sharing` çıktısı. */
export interface ToggleSharingResult {
  sharingActive: boolean;
}

/** `GET /api/otp/:id/sharing` çıktısı — bu OTP şu an kimlerle paylaşılıyor (salt-okunur). */
export interface SharingTargetsResult {
  targets: TargetUser[];
}

/** `POST /api/otp/dismiss` çıktısı — bu istekte yeni kaldırılan OTP sayısı. */
export interface DismissOtpsResult {
  dismissed: number;
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
  /** Ham gönderici kimliği — developer'a gösterilecek etiket olarak kalıcılaştırılır. */
  senderRaw?: string;
  /** Opsiyonel serbest metin bağlam etiketi — gelmezse null olarak kalıcılaştırılır. */
  context?: string | null;
}

/** Socket üzerinden developer + sahibi receiver ekranına anlık yayınlanan OTP yükü (düz kod). */
export interface OtpNotification {
  id: string;
  code: string;
  source: Source;
  /** OTP'nin geldiği an — client "ne zaman/saat kaçta" bilgisini bundan gösterir (süre yok). */
  createdAt: Date;
  /** Yeni OTP her zaman paylaşımda (true) — receiver kartının toggle durumunu doğru göstermek için. */
  sharingActive: boolean;
  /** Ham gönderici kimliği — developer'a gösterilecek etiket (POST'ta hep dolu). */
  senderRaw: string;
  /** Opsiyonel serbest metin bağlam etiketi — gelmezse null. */
  context: string | null;
  receiver: OtpReceiverInfo;
  device: OtpDeviceInfo | null;
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
  /** Yeni OTP kaydı oluşturur; receiver + device ilişkileriyle döner (emit payload'ı için). */
  save(data: CreateOtpLogData): Promise<OtpLogWithRelations>;
  /** OTP'yi id ile getirir (sahiplik kontrolü için); yoksa `null`. */
  findById(id: string): Promise<OTPLog | null>;
  /**
   * Bir developer'ın görmeye yetkili olduğu kayıtları sayfalı döner (createdAt desc).
   * Paylaşımı AÇIK (`sharingActive:true`) + bu developer'ın KENDİ feed'inden kaldırMADIĞI
   * (dismissal yok) + yalnızca verilen receiver'lara ait VE o receiver'ın `linkedAt`
   * anından SONRA oluşmuş kayıtlar gelir — sonradan bağlanan developer geçmiş kodları
   * göremez. OTP süresiz olduğundan expiry filtresi YOKTUR. `receivers` boşsa
   * çağrılmamalıdır (service kısa devre yapar). receiver + device include edilir.
   */
  findForDeveloper(
    projectId: string,
    developerId: string,
    receivers: VisibleReceiver[],
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>>;
  /**
   * Projedeki TÜM OTP'leri sayfalı döner (createdAt desc) — admin özet ekranı.
   * Filtre YOKTUR: tüm receiver'lardan, sharing/dismissal durumundan bağımsız hepsi gelir.
   */
  findAllForProject(
    projectId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>>;
  /**
   * Bir receiver'ın KENDİ kayıtlarını sayfalı döner (createdAt desc).
   * findForDeveloper'ın AKSİNE: sharingActive=false kayıtlar da GELİR
   * (receiver kendi kodlarını görüp paylaşımı yönetebilmeli). receiver + device include edilir.
   */
  findByReceiver(
    receiverId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<OtpLogWithRelations>>;
  /** Paylaşım durumunu günceller (sahiplik service'te receiverId ile doğrulanır). */
  updateSharingActive(otpId: string, isActive: boolean): Promise<OTPLog>;
  /**
   * Verilen OTP'leri bir developer'ın feed'inden kaldırır (per-developer yumuşak gizleme).
   * Yalnızca projede gerçekten var olan id'ler işlenir; zaten kaldırılmışlar atlanır.
   * @returns Bu çağrıda YENİ kaldırılan (dismissal eklenen) OTP sayısı.
   */
  dismissForDeveloper(
    projectId: string,
    developerId: string,
    otpIds: string[],
  ): Promise<number>;
}

/**
 * Gerçek zamanlı bildirim port'u (adapter: Socket.IO). Emit fire-and-forget — SYNC.
 */
export interface IOtpNotifier {
  /**
   * OTP'yi hedef developer'ların bireysel `user:` odalarına yayınlar (hedefli dağıtım).
   * @returns Emit edilen hedef developer sayısı ("deliveredTo").
   */
  notify(targetUserIds: string[], payload: OtpNotification): number;
  /**
   * OTP'yi sahibi receiver'ın KENDİ `user:` odasına yayınlar — receiver kendi cihazının
   * ürettiği kodu geçmişinde anında (refresh'siz) görür. `notify`'dan bağımsızdır ve
   * `deliveredTo`'yu ETKİLEMEZ; routing'den de bağımsız olarak her OTP için çağrılır.
   */
  notifyReceiver(receiverId: string, payload: OtpNotification): void;
  /**
   * OTP'yi projenin admin odasına (`project:{id}`) yayınlar — admin Özet ekranı yeni
   * kodu refresh'siz görür. `deliveredTo`'yu ETKİLEMEZ; routing'den bağımsız her OTP
   * için çağrılır (admin özeti filtresizdir). `otp:revoked` admin'e YAYINLANMAZ.
   */
  notifyAdmins(projectId: string, payload: OtpNotification): void;
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
  /** Admin özet: projedeki tüm receiver'lardan gelen tüm OTP'ler (filtresiz). */
  getAllForProject(
    dto: GetAllOtpDTO,
  ): Promise<Result<PaginatedResult<OtpHistoryItem>>>;
  /** Receiver'ın kendi OTP geçmişi (paylaşım durumu + cihaz adıyla). */
  getReceiverHistory(
    dto: GetReceiverHistoryDTO,
  ): Promise<Result<PaginatedResult<ReceiverOtpHistoryItem>>>;
  /**
   * Developer verilen OTP'leri KENDİ feed'inden kaldırır (yumuşak gizleme, per-developer).
   * Kalıcı silme değildir — receiver/admin görmeye devam eder.
   */
  dismissForDeveloper(
    developerId: string,
    projectId: string,
    otpIds: string[],
  ): Promise<Result<DismissOtpsResult>>;
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
