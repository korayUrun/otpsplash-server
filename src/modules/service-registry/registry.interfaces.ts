import type { ServiceRegistry } from '@prisma/client';
import type { Result } from '@app-types/Result';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/service-registry` iş katmanı girişi (admin manuel kural ekler).
 * `projectId` body'den değil kimliği doğrulanmış admin'den (`req.user`) gelir — proje izolasyonu.
 * En az bir pattern (senderPattern/keywordPattern) Zod katmanında zorunlu kılınır.
 */
export interface CreateServiceRuleDTO {
  projectId: string;
  name: string;
  senderPattern?: string;
  keywordPattern?: string;
  iconUrl?: string;
}

/**
 * `PATCH /api/service-registry/:id` girişi — kova (inaktif) satırını isim+kural vererek aktive eder.
 * `projectId` ile satırın projeye ait olduğu doğrulanır (sızdırma yok).
 */
export interface ActivateServiceRuleDTO extends CreateServiceRuleDTO {
  id: string;
}

/** Servis silme (DELETE) başarı çıktısı. */
export interface ServiceMutationResult {
  message: string;
}

/**
 * Resolver eşleşme sonucu — çözülen servisin kimliği ve gösterim adı.
 * `name` şemada nullable'dır ama aktif kuralların adı her zaman doludur (adlandırılınca aktive edilir);
 * çağıran, cihaz ekranındaki canlı kartı anında etiketlemek için `name`'i kullanır.
 */
export interface ResolvedService {
  id: string;
  name: string | null;
}

// ───────────────────────── Repository veri şekilleri ─────────────────────────

/** Manuel aktif kural oluşturmak için repository'ye verilen alanlar. */
export interface CreateServiceRuleData {
  projectId: string;
  name: string;
  isActive: boolean;
  senderPattern: string | null;
  keywordPattern: string | null;
  iconUrl: string | null;
}

/** Kova satırını aktive ederken güncellenen alanlar (isActive: true repository'de set edilir). */
export interface ActivateServiceData {
  name: string;
  senderPattern: string | null;
  keywordPattern: string | null;
  iconUrl: string | null;
}

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * Servis kayıt defteri kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IServiceRegistryRepository {
  /** Resolver girdisi: yalnızca aktif (isActive: true) kurallar. */
  findActiveRules(projectId: string): Promise<ServiceRegistry[]>;
  /** Kaydı id ile getirir (aktive/silme öncesi proje sahipliği kontrolü); yoksa `null`. */
  findById(id: string): Promise<ServiceRegistry | null>;
  /** Doğrudan aktif kural oluşturur (manuel ekleme). */
  create(data: CreateServiceRuleData): Promise<ServiceRegistry>;
  /** Var olan kaydı aktive eder (isActive: true + isim/kural). */
  activate(id: string, data: ActivateServiceData): Promise<ServiceRegistry>;
  /**
   * Eşleşmeyen senderRaw'ı kova satırına işler (upsert):
   * aynı `lastSeenSender`'a sahip inaktif satır varsa `unmatchedCount`+1 ve `lastSeenAt`,
   * yoksa `isActive: false, name: null` yeni satır.
   */
  upsertUnmatched(projectId: string, senderRaw: string): Promise<ServiceRegistry>;
  /** Yalnızca inaktif (kova) satırları listeler. */
  findUnmatched(projectId: string): Promise<ServiceRegistry[]>;
  /** Projedeki tüm kayıtları (aktif + kova) listeler. */
  findAll(projectId: string): Promise<ServiceRegistry[]>;
  /** Kaydı siler. */
  delete(id: string): Promise<void>;
}

/**
 * Servis çözümleyici — cihazdan gelen sinyalleri (senderRaw/serviceHint) bir serviceId'ye çevirir.
 * Aktif kurallar kısa TTL'li in-memory cache'ten okunur (ASYNC giriş), eşleştirme regex ile SYNC.
 */
export interface IServiceResolver {
  /**
   * @returns Eşleşen servisin kimliği+adı; hiçbiri eşleşmezse `null` (çağıran kova'ya kaydeder).
   * `senderPattern` eşleşmesi `keywordPattern`'dan önceliklidir.
   */
  resolve(
    projectId: string,
    senderRaw: string,
    serviceHint?: string,
  ): Promise<ResolvedService | null>;
}

/**
 * Eşleşmeyen sinyali kova'ya yazma portu (ISP — otp.service yalnızca bunu görür).
 * OTP işleme yolunda fire-and-forget çağrılır; OTP'nin kendisini yavaşlatmamalı.
 */
export interface IUnmatchedRecorder {
  recordUnmatched(projectId: string, senderRaw: string): Promise<void>;
}

/**
 * Servis kayıt defteri iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IServiceRegistryService extends IUnmatchedRecorder {
  /** Doğrudan aktif kural oluşturur (yalnızca ADMIN). */
  createRule(dto: CreateServiceRuleDTO): Promise<Result<ServiceRegistry>>;
  /** Kova satırını isim+kural vererek aktive eder (yalnızca ADMIN). */
  activateFromUnmatched(dto: ActivateServiceRuleDTO): Promise<Result<ServiceRegistry>>;
  /** Kaydı siler (yalnızca ADMIN). */
  deleteRule(id: string, projectId: string): Promise<Result<ServiceMutationResult>>;
  /** Projedeki tüm kayıtları (aktif + kova) listeler. */
  listAll(projectId: string): Promise<Result<ServiceRegistry[]>>;
  /** Yalnızca kova (inaktif) satırlarını listeler. */
  listUnmatched(projectId: string): Promise<Result<ServiceRegistry[]>>;
}
