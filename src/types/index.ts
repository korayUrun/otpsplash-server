import type { Platform, Role } from '@prisma/client';

/**
 * Access token içinde taşınan ve `req.user` olarak kullanılan kimlik bilgisi.
 * `sub` = kullanıcı id'si (JWT standart claim).
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  projectId: string;
}

/**
 * Device Secret doğrulandıktan sonra `req.device` olarak taşınan cihaz kimliği.
 * JWT'den bağımsızdır — yalnızca `POST /api/otp` akışında doldurulur.
 */
export interface DevicePayload {
  id: string;
  userId: string;
  projectId: string;
  platform: Platform;
}

/**
 * Refresh token minimal bilgi taşır — rol/projectId yenilemede DB'den tazelenir.
 */
export interface RefreshPayload {
  sub: string;
}

/** Sayfalama girişi (repository katmanına geçer). */
export interface PaginationOptions {
  page: number;
  limit: number;
}

/** Sayfalanmış sonuç meta verisi (API yanıtındaki `pagination` alanı). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Repository/service katmanından dönen sayfalanmış veri kümesi. */
export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}
