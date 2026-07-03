import {
  SENDER_PATTERNS,
  type SenderPatternConfig,
} from '@config/senderPatterns';

/**
 * `GET /api/otp/sender-patterns` yanıtındaki tek satır — cihaza sunulan PUBLIC gösterim.
 * Yalnızca `name` + `pattern` sızar; `isActive`/`order` iç detaydır, dışarı verilmez.
 */
export interface PublicSenderPattern {
  name: string;
  pattern: string;
}

/**
 * Gönderici kalıplarını sağlayan port (DIP). v1'de statik konfig, v2'de DB (SenderPattern +
 * admin CRUD) implementasyonu bu arayüzü karşılar — controller/route hiç değişmez (OCP).
 * Saf bellek işi (I/O yok) → SYNC (CLAUDE.md async/sync kuralı).
 */
export interface ISenderPatternProvider {
  /** Aktif kalıpları `order`'a göre sıralı, public gösterimle (name+pattern) döner. */
  list(): PublicSenderPattern[];
}

/**
 * Statik konfig tabanlı provider (v1). Aktif satırları süzer, `order` artan sıralar
 * (eşit `order`'da tanım sırası korunur — Array.sort stabil), public alanlara indirger.
 */
export class StaticSenderPatternProvider implements ISenderPatternProvider {
  constructor(
    private readonly patterns: readonly SenderPatternConfig[] = SENDER_PATTERNS,
  ) {}

  list(): PublicSenderPattern[] {
    return this.patterns
      .filter((entry) => entry.isActive)
      .sort((a, b) => a.order - b.order)
      .map(({ name, pattern }) => ({ name, pattern }));
  }
}
