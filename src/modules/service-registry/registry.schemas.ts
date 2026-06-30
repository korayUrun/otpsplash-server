import { z } from 'zod';
import { CONSTANTS } from '@config/constants';

/**
 * Tehlikeli iç içe quantifier (catastrophic backtracking) sezgisi.
 * Bir grubun İÇİNDE quantifier (`+ * {n,}`) varken grubun KENDİSİ de quantifier'lanmışsa
 * reddedilir: `(a+)+`, `(a*)*`, `(a+)*`, `(a{2,})+` ... Klasik ReDoS kalıplarını yakalar
 * (CLAUDE.md "senderPattern — ReDoS Koruması"). Exhaustive değildir; uzunluk sınırı (≤200)
 * ile birlikte backtracking yüzeyini pratik olarak daraltır.
 */
const NESTED_QUANTIFIER = /\([^)]*[+*}][^)]*\)[*+{]/;

/** Pattern güvenli mi: iç içe quantifier yok + geçerli (derlenebilir) bir regex. */
function isSafePattern(pattern: string): boolean {
  if (NESTED_QUANTIFIER.test(pattern)) {
    return false;
  }
  try {
    // Geçersiz regex DB'ye girmemeli — resolve sırasında pipeline'ı kırmasın.
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tek bir eşleştirme deseni şeması: uzunluk ≤200 (ReDoS) + güvenlik refine'ı.
 * Hem `senderPattern` hem `keywordPattern` bunu kullanır.
 */
const patternSchema = z
  .string()
  .min(1)
  .max(CONSTANTS.REGISTRY.PATTERN_MAX_LENGTH)
  .refine(isSafePattern, {
    message:
      'Pattern güvenli değil (geçersiz regex veya iç içe quantifier — ReDoS riski)',
  });

/**
 * `POST /api/service-registry` gövdesi (manuel kural) ve `PATCH /api/service-registry/:id`
 * gövdesi (kova satırını aktive et) — aynı şekil. `projectId` body'de YOKTUR (admin'den alınır).
 * En az bir pattern zorunlu — pattern'siz bir kural hiçbir SMS'i eşleştiremez.
 */
export const serviceRuleSchema = z
  .object({
    name: z.string().min(1).max(CONSTANTS.REGISTRY.NAME_MAX_LENGTH),
    senderPattern: patternSchema.optional(),
    keywordPattern: patternSchema.optional(),
    iconUrl: z.string().url().max(500).optional(),
  })
  .refine(
    (data) =>
      data.senderPattern !== undefined || data.keywordPattern !== undefined,
    {
      message:
        'senderPattern veya keywordPattern alanlarından en az biri zorunlu',
      path: ['senderPattern'],
    },
  );

/** `:id` (servis kaydı) path parametresi. */
export const serviceIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type ServiceRuleBody = z.infer<typeof serviceRuleSchema>;
export type ServiceIdParams = z.infer<typeof serviceIdParamsSchema>;
