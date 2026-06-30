import type { Project, Role, User } from '@prisma/client';
import type { Result } from '@app-types/Result';
import type { JwtPayload } from '@app-types/index';

// ───────────────────────── DTO'lar ─────────────────────────

/** `POST /api/projects` iş katmanı girişi. */
export interface CreateProjectDTO {
  name: string;
}

/** Repository'ye proje oluşturmak için verilen alanlar (id/apiKey DB tarafından üretilir). */
export interface CreateProjectData {
  name: string;
}

/** `POST /api/projects/:id/users` iş katmanı girişi. */
export interface AddUserDTO {
  projectId: string;
  userId: string;
}

/** `DELETE /api/projects/:id/users/:uid` iş katmanı girişi. */
export interface RemoveUserDTO {
  projectId: string;
  userId: string;
}

/**
 * Proje detayında dönülen, parolasız üye görünümü.
 * `projectId` atlanır — üye zaten ait olduğu projenin altında listelenir.
 */
export interface ProjectMember {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
}

/** `GET /api/projects/:id` çıktısı: proje + (parolasız) üyeleri. */
export interface ProjectDetail {
  id: string;
  name: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
  users: ProjectMember[];
}

/** Üyelik değişikliği (ekle/çıkar) başarı çıktısı. */
export interface ProjectMutationResult {
  message: string;
}

/** Repository'den dönen, üyeleri include edilmiş proje. */
export type ProjectWithUsers = Project & { users: User[] };

// ───────────────────────── Servis arayüzleri (port'lar) ─────────────────────────

/**
 * Proje kalıcılık katmanı. Tüm işlemler I/O — ASYNC.
 */
export interface IProjectRepository {
  /** Yeni proje oluşturur (apiKey DB default'u ile üretilir). */
  create(data: CreateProjectData): Promise<Project>;
  /** Projeyi üyeleriyle birlikte getirir; yoksa `null`. */
  findById(id: string): Promise<ProjectWithUsers | null>;
  /** Kullanıcıyı id ile getirir; yoksa `null`. */
  findUserById(userId: string): Promise<User | null>;
  /** Kullanıcının projesini günceller (başka projeye taşır). */
  assignUserToProject(userId: string, projectId: string): Promise<User>;
  /**
   * Kullanıcıyı projeden çıkarır. `User.projectId` zorunlu (nullable değil) olduğundan
   * tek projeli modelde "projeden çıkarma" = kullanıcı kaydını silmektir.
   */
  removeUser(userId: string): Promise<void>;
}

/**
 * Proje iş mantığı. Beklenen hatalar `Result.fail` ile döner.
 */
export interface IProjectService {
  create(dto: CreateProjectDTO): Promise<Result<Project>>;
  /** Yalnızca projenin üyesi erişebilir (proje izolasyonu). */
  getById(projectId: string, requester: JwtPayload): Promise<Result<ProjectDetail>>;
  addUser(dto: AddUserDTO): Promise<Result<ProjectMutationResult>>;
  removeUser(dto: RemoveUserDTO): Promise<Result<ProjectMutationResult>>;
}
