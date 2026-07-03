/**
 * Gönderici (senderRaw) eşleştirme kalıpları — STATİK KONFİG (v1).
 *
 * iOS Shortcut / Android otomasyonu `GET /api/otp/sender-patterns` ile bu listeyi çeker,
 * her `pattern`'i CİHAZDA SMS gövdesine karşı dener; eşleşen olursa `senderRaw = name` yapıp
 * `POST /api/otp`'ye gönderir. SMS gövdesi backend'e ASLA gelmez (bkz. CLAUDE.md "Parse yeri").
 *
 * `pattern` = iOS NSRegularExpression / ICU regex'idir (asıl motor cihazdadır). Aşağıdaki
 * startup doğrulaması bir JS `RegExp` smoke-check'idir — kaba yazım hatalarını yakalar ama
 * ICU-özgü sözdizimini birebir doğrulamaz.
 *
 * Yazım kuralları (v2 DB'ye geçince de geçerli):
 *  - `^` ile ANKARALA ("mesaj şununla başlıyorsa") — orta eşleşme yanlış servise yazar.
 *  - Pattern'ler BİRBİRİNİ DIŞLASIN (bir SMS tek servise uysun). Çakışırsa `order` küçük olan
 *    önce döner; cihaz döngüsünde tipik olarak "son eşleşen kazanır" olduğundan sıra önemlidir.
 *  - JSON/JS string içinde ters bölüyü escape'le (`\\b`, `\\d`).
 *
 * v2 (istenirse): bu liste `SenderPattern` DB tablosu + admin CRUD ile değiştirilir; tüketici
 * sözleşmesi (`{ name, pattern }` dizisi) ve provider arayüzü aynı kalır (bkz. sender-pattern.provider.ts).
 */

/** Ham konfig satırı — v2 DB modeli (`SenderPattern`) ile alan-uyumlu tutulur. */
export interface SenderPatternConfig {
  /** senderRaw etiketi — developer'a "kimden geldi" olarak gösterilen servis adı. */
  name: string;
  /** iOS ICU regex; cihazda SMS gövdesine denenir. `^` ile ankaralı olmalı. */
  pattern: string;
  /** `false` ise listede dönülmez (v2 `isActive` ile hizalı). */
  isActive: boolean;
  /** Dönüş/değerlendirme sırası (küçük önce). Eşitlikte tanım sırası korunur. */
  order: number;
}

/**
 * Statik pattern listesi. Yeni servis eklemek = buraya satır eklemek (OCP: tüketen kod değişmez).
 * Gerçek olmayan örnek regex (`^(...)`) EKLENMEZ — yanlış eşleşme cihazda yanlış etiket yazar;
 * yeni servisin kalıbı elde olunca eklenir.
 */
export const SENDER_PATTERNS: readonly SenderPatternConfig[] = [
  {
    name: 'COINTRA',
    pattern:
      '^(Giriş için onay kodunuz|Hesap silme onay kodunuz|Görüntülü gör[uü]şme kodunuz|Telefon doğrulama kodunuz)',
    isActive: true,
    order: 0,
  },
];

/**
 * Startup fail-fast doğrulaması (env.ts ile aynı ruh): aktif her satır için `name` dolu ve
 * `pattern` derlenebilir bir regex olmalı. Hatalıysa süreç import anında düşer — bozuk kalıp
 * cihazlara servis edilmez.
 */
function validateSenderPatterns(patterns: readonly SenderPatternConfig[]): void {
  patterns.forEach((entry, index) => {
    if (entry.name.trim().length === 0) {
      throw new Error(
        `[senderPatterns] name boş olamaz (index ${index}).`,
      );
    }
    if (!entry.isActive) {
      return;
    }
    try {
      // Yalnızca derlenebilirlik smoke-check'i (asıl motor cihazdaki ICU'dur).
      new RegExp(entry.pattern);
    } catch (cause) {
      throw new Error(
        `[senderPatterns] "${entry.name}" için geçersiz regex: ${entry.pattern}`,
        { cause },
      );
    }
  });
}

validateSenderPatterns(SENDER_PATTERNS);
