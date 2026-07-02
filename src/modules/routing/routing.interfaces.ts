import type {
  Group,
  GroupMember,
  RoutingRule,
  RoutingTarget,
  User,
} from '@prisma/client';
import type { Result } from '@app-types/Result';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/routing-rules` iş katmanı girişi.
 * `projectId` body'den değil kimliği doğrulanmış admin'den (`req.user`) gelir —
 * receiver/hedef bu projeye ait olmak zorundadır (proje izolasyonu).
 * Servis kavramı yoktur: kural yalnızca receiver → hedef ikilisidir.
 */
export interface CreateRoutingRuleDTO {
  receiverId: string;
  targetType: RoutingTarget;
  developerId?: string;
  groupId?: string;
  projectId: string;
}

/** Repository'ye kural oluşturmak için verilen alanlar (id/createdAt DB üretir). */
export interface CreateRoutingRuleData {
  receiverId: string;
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

/** Bir receiver'ın hedef developer'ı (salt-okunur paylaşım görünümü + emit). */
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

/** Admin/receiver listesi için: kural + receiver/grup join'li hali (developer ayrı çekilir). */
export type RoutingRuleWithRelations = RoutingRule & {
  receiver: User;
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
  /** Aynı (receiver, developer) kuralı var mı (servis katmanı conflict kontrolü). */
  findDeveloperRule(
    receiverId: string,
    developerId: string,
  ): Promise<RoutingRule | null>;
  /** Aynı (receiver, grup) kuralı var mı (servis katmanı conflict kontrolü). */
  findGroupRule(
    receiverId: string,
    groupId: string,
  ): Promise<RoutingRule | null>;
  /** Resolver için: receiver'ın AKTİF kurallarını hedefleriyle döner. */
  findActiveTargets(receiverId: string): Promise<RoutingRuleWithTargets[]>;
  /**
   * `findActiveTargets`'in TERSİ: bir developer'a (doğrudan `developerId` veya üye olduğu
   * bir grup üzerinden) yönlendirilen AKTİF kuralların benzersiz `receiverId` listesini döner.
   * Developer geçmişini süzmek için kullanılır (canlı emit ile aynı kapsam).
   */
  findReceiverIdsForDeveloper(developerId: string): Promise<string[]>;
  /** Kuralın aktiflik durumunu günceller. */
  toggle(id: string, isActive: boolean): Promise<RoutingRule>;
  /** Kuralı siler. */
  delete(id: string): Promise<void>;
  // ── Doğrulama / görünüm yardımcı sorguları ──
  findUserById(userId: string): Promise<User | null>;
  /** Verilen id'lerdeki kullanıcıları döner (developer e-postaları için toplu çekim). */
  findUsersByIds(ids: string[]): Promise<User[]>;
  findGroupById(groupId: string): Promise<Group | null>;
}

/**
 * Yönlendirme çözümleyici — bir receiver için hedef developer'ları belirler.
 * DB'den aktif kuralları çekmek ASYNC, ardından üyeleri flatten + dedupe etmek SYNC'tir.
 */
export interface IRoutingResolver {
  /**
   * Hedef developer'ların benzersiz id listesini döner (Socket.IO emit hedefi).
   * Receiver'ın hiç aktif kuralı yoksa boş liste döner — kimseye gitmez.
   */
  resolveTargets(receiverId: string): Promise<string[]>;
  /**
   * Hedef developer'ların salt-okunur görünümünü döner (OTP "kimlerle paylaşıyorum").
   */
  resolveTargetDetails(receiverId: string): Promise<TargetUser[]>;
  /**
   * `resolveTargets`'in TERSİ: bir developer'ın hangi receiver'ların kodlarını görmeye
   * yetkili olduğunu döner (doğrudan + grup üyeliği, yalnızca aktif kurallar).
   * Tekilleştirilmiş receiverId listesi; hiç kural yoksa boş liste (developer hiçbir kod görmez).
   */
  resolveVisibleReceiverIds(developerId: string): Promise<string[]>;
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
