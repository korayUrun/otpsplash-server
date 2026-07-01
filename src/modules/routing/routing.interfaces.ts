import type {
  Group,
  GroupMember,
  RoutingRule,
  RoutingTarget,
  ServiceRegistry,
  User,
} from '@prisma/client';
import type { Result } from '@app-types/Result';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/routing-rules` iş katmanı girişi.
 * `projectId` body'den değil kimliği doğrulanmış admin'den (`req.user`) gelir —
 * receiver/servis/hedef bu projeye ait olmak zorundadır (proje izolasyonu).
 */
export interface CreateRoutingRuleDTO {
  receiverId: string;
  serviceId: string;
  targetType: RoutingTarget;
  developerId?: string;
  groupId?: string;
  projectId: string;
}

/** Repository'ye kural oluşturmak için verilen alanlar (id/createdAt DB üretir). */
export interface CreateRoutingRuleData {
  receiverId: string;
  serviceId: string;
  targetType: RoutingTarget;
  developerId: string | null;
  groupId: string | null;
}

/** `PATCH /api/routing-rules/:id` iş katmanı girişi. */
export interface ToggleRuleDTO {
  id: string;
  isActive: boolean;
  projectId: string;
}

/** `DELETE /api/routing-rules/:id` iş katmanı girişi. */
export interface DeleteRuleDTO {
  id: string;
  projectId: string;
}

/** Admin kural listesindeki görünüm. */
export interface RoutingRuleView {
  id: string;
  receiverId: string;
  receiverEmail: string;
  serviceId: string;
  serviceName: string | null;
  targetType: RoutingTarget;
  developerId: string | null;
  developerEmail: string | null;
  groupId: string | null;
  groupName: string | null;
  isActive: boolean;
  createdAt: Date;
}

/** Kural değişikliği (toggle/delete) başarı çıktısı. */
export interface RoutingMutationResult {
  message: string;
}

/** Bir OTP'nin/servisin hedef developer'ı (salt-okunur paylaşım görünümü + emit). */
export interface TargetUser {
  id: string;
  email: string;
  /** Görünen ad; opsiyonel. Mobil `name ?? email` fallback yapar. */
  name: string | null;
}

/**
 * Resolver için: aktif kural + grup üyeleri join'li hali.
 * `developerId` düz bir kolondur (şemada Prisma ilişkisi yok), bu yüzden include edilmez —
 * id doğrudan kullanılır; e-posta gerektiğinde ayrıca `findUsersByIds` ile çekilir.
 */
export type RoutingRuleWithTargets = RoutingRule & {
  group: (Group & { members: (GroupMember & { user: User })[] }) | null;
};

/** Admin/receiver listesi için: kural + receiver/servis/grup join'li hali (developer ayrı çekilir). */
export type RoutingRuleWithRelations = RoutingRule & {
  receiver: User;
  service: ServiceRegistry;
  group: Group | null;
};

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * Yönlendirme kuralı kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IRoutingRepository {
  /** Yeni kural oluşturur. */
  create(data: CreateRoutingRuleData): Promise<RoutingRule>;
  /** Kuralı id ile getirir (proje/varlık kontrolü için); yoksa `null`. */
  findById(id: string): Promise<RoutingRule | null>;
  /** Projedeki tüm kuralları (receiver üzerinden) ilişkileriyle döner. */
  listByProject(projectId: string): Promise<RoutingRuleWithRelations[]>;
  /** Bir receiver'ın kurallarını ilişkileriyle döner (salt-okunur görünüm). */
  listByReceiver(receiverId: string): Promise<RoutingRuleWithRelations[]>;
  /** Aynı (receiver, servis, developer) kuralı var mı (servis katmanı conflict kontrolü). */
  findDeveloperRule(
    receiverId: string,
    serviceId: string,
    developerId: string,
  ): Promise<RoutingRule | null>;
  /** Aynı (receiver, servis, grup) kuralı var mı (servis katmanı conflict kontrolü). */
  findGroupRule(
    receiverId: string,
    serviceId: string,
    groupId: string,
  ): Promise<RoutingRule | null>;
  /** Resolver için: receiver+servis'in AKTİF kurallarını hedefleriyle döner. */
  findActiveTargets(
    receiverId: string,
    serviceId: string,
  ): Promise<RoutingRuleWithTargets[]>;
  /** Kuralın aktiflik durumunu günceller. */
  toggle(id: string, isActive: boolean): Promise<RoutingRule>;
  /** Kuralı siler. */
  delete(id: string): Promise<void>;
  // ── Doğrulama / görünüm yardımcı sorguları ──
  findUserById(userId: string): Promise<User | null>;
  /** Verilen id'lerdeki kullanıcıları döner (developer e-postaları için toplu çekim). */
  findUsersByIds(ids: string[]): Promise<User[]>;
  findServiceById(serviceId: string): Promise<ServiceRegistry | null>;
  findGroupById(groupId: string): Promise<Group | null>;
}

/**
 * Yönlendirme çözümleyici — bir receiver+servis için hedef developer'ları belirler.
 * DB'den aktif kuralları çekmek ASYNC, ardından üyeleri flatten + dedupe etmek SYNC'tir.
 */
export interface IRoutingResolver {
  /**
   * Hedef developer'ların benzersiz id listesini döner (Socket.IO emit hedefi).
   * Hiç aktif kural yoksa veya `serviceId` null ise boş liste döner — kimseye gitmez.
   */
  resolveTargets(receiverId: string, serviceId: string | null): Promise<string[]>;
  /**
   * Hedef developer'ların salt-okunur görünümünü döner (OTP "kimlerle paylaşıyorum").
   */
  resolveTargetDetails(
    receiverId: string,
    serviceId: string | null,
  ): Promise<TargetUser[]>;
}

/**
 * Yönlendirme kuralı iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IRoutingService {
  /** Kural oluşturur (yalnızca ADMIN). Çakışma → ConflictError (ROUTING_RULE_CONFLICT). */
  createRule(dto: CreateRoutingRuleDTO): Promise<Result<RoutingRule>>;
  /** Kuralı aktif/pasif yapar. */
  toggleRule(dto: ToggleRuleDTO): Promise<Result<RoutingRule>>;
  /** Kuralı siler. */
  deleteRule(dto: DeleteRuleDTO): Promise<Result<RoutingMutationResult>>;
  /** Projedeki kuralları listeler (admin). */
  listByProject(projectId: string): Promise<Result<RoutingRuleView[]>>;
  /** Bir receiver'ın kurallarını salt-okunur listeler. */
  listForReceiver(receiverId: string): Promise<Result<RoutingRuleView[]>>;
}
