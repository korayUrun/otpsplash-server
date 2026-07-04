import type { Group, GroupMember, User } from '@prisma/client';
import type { Result } from '@app-types/Result';

// ───────────────────────── DTO'lar ─────────────────────────

/**
 * `POST /api/groups` iş katmanı girişi.
 * `projectId` body'den değil kimliği doğrulanmış admin'den (`req.user`) gelir —
 * grup daima admin'in projesine bağlanır (proje izolasyonu).
 */
export interface CreateGroupDTO {
  name: string;
  projectId: string;
}

/** Repository'ye grup oluşturmak için verilen alanlar (id/createdAt DB üretir). */
export interface CreateGroupData {
  name: string;
  projectId: string;
}

/** `POST /api/groups/:id/members` iş katmanı girişi. */
export interface AddMemberDTO {
  groupId: string;
  userId: string;
  /** İşlemi yapan admin'in projesi — grup ve üye bu projeye ait olmalı. */
  projectId: string;
}

/** `DELETE /api/groups/:id/members/:uid` iş katmanı girişi. */
export interface RemoveMemberDTO {
  groupId: string;
  userId: string;
  projectId: string;
}

/** `DELETE /api/groups/:id` iş katmanı girişi. */
export interface DeleteGroupDTO {
  groupId: string;
  /** İşlemi yapan admin'in projesi — grup bu projeye ait olmalı (izolasyon). */
  projectId: string;
}

/** Grup üyesinin salt-okunur görünümü (parola sızdırılmaz). */
export interface GroupMemberView {
  userId: string;
  email: string;
  /** Görünen ad; opsiyonel. Mobil `name ?? email` fallback yapar. */
  name: string | null;
}

/** `GET /api/groups` çıktısındaki grup görünümü (üyeleriyle, salt-okunur). */
export interface GroupView {
  id: string;
  name: string;
  members: GroupMemberView[];
  createdAt: Date;
}

/** Üyelik değişikliği (ekle/çıkar) başarı çıktısı. */
export interface GroupMutationResult {
  message: string;
}

/** Repository'den dönen, üyeleri (+ user) include edilmiş grup. */
export type GroupWithMembers = Group & {
  members: (GroupMember & { user: User })[];
};

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * Grup kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IGroupRepository {
  /** Yeni grup oluşturur. */
  create(data: CreateGroupData): Promise<Group>;
  /** Grubu id ile getirir (proje/varlık kontrolü için); yoksa `null`. */
  findById(id: string): Promise<Group | null>;
  /** Projeye ait grupları üyeleriyle birlikte döner (en yeni önce). */
  findByProject(projectId: string): Promise<GroupWithMembers[]>;
  /** Kullanıcıyı id ile getirir (rol/proje doğrulaması için); yoksa `null`. */
  findUserById(userId: string): Promise<User | null>;
  /** Belirli bir üyeliği döner (zaten üye mi kontrolü); yoksa `null`. */
  findMember(groupId: string, userId: string): Promise<GroupMember | null>;
  /** Gruba üye ekler. */
  addMember(groupId: string, userId: string): Promise<GroupMember>;
  /** Gruptan üyeyi çıkarır. */
  removeMember(groupId: string, userId: string): Promise<void>;
  /**
   * Grubu siler. DB seviyesinde FK cascade ile üyelikler (`group_members`) ve bu grubu
   * hedefleyen yönlendirme kuralları (`routing_rules`) da silinir — dangling kural kalmaz.
   */
  delete(groupId: string): Promise<void>;
}

/**
 * Grup iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IGroupService {
  /** Grup oluşturur (yalnızca ADMIN). */
  create(dto: CreateGroupDTO): Promise<Result<Group>>;
  /**
   * Gruba DEVELOPER ekler. DEVELOPER olmayan → ValidationError, zaten üye → ConflictError,
   * grup/kullanıcı yok → NotFoundError.
   */
  addMember(dto: AddMemberDTO): Promise<Result<GroupMutationResult>>;
  /** Gruptan üye çıkarır; üye değilse → NotFoundError. */
  removeMember(dto: RemoveMemberDTO): Promise<Result<GroupMutationResult>>;
  /**
   * Grubu siler (yalnızca ADMIN, kendi projesindeki grup). Üyelikler ve bu grubu
   * hedefleyen yönlendirme kuralları FK cascade ile birlikte temizlenir.
   * Grup yok/başka projede → NotFoundError.
   */
  delete(dto: DeleteGroupDTO): Promise<Result<GroupMutationResult>>;
  /** Projedeki grupları salt-okunur listeler (admin + receiver görebilir). */
  listForProject(projectId: string): Promise<Result<GroupView[]>>;
}
