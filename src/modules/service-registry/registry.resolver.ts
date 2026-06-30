import type { ServiceRegistry } from '@prisma/client';
import { env } from '@config/env';
import { logger } from '@infrastructure/logger';
import type {
  IServiceRegistryRepository,
  IServiceResolver,
} from './registry.interfaces';

/** Proje başına önbelleğe alınmış aktif kurallar + geçerlilik sonu (epoch ms). */
interface CacheEntry {
  rules: ServiceRegistry[];
  expiresAt: number;
}

/**
 * Servis çözümleyici.
 * Aktif kurallar proje bazlı, kısa TTL'li in-memory cache'ten okunur (admin yeni kural
 * eklediğinde en geç bu süre içinde devreye girer — anlık tutarlılık bu ölçekte gerekmez).
 * Eşleştirme tamamen SYNC regex'tir; `senderPattern` `keywordPattern`'dan önceliklidir.
 *
 * TTL=0 → cache devre dışı (her resolve DB'den taze okur) — test ortamı bu modu kullanır.
 * Cache TTL geçtiğinde kurallar DB'den yeniden çekilir.
 */
export class ServiceRegistryResolver implements IServiceResolver {
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * @param ttlMs Cache ömrü (ms) — varsayılan env'den. Test deterministikliği için inject edilebilir.
   * @param now   Saat fonksiyonu — varsayılan `Date.now`. Test'te TTL geçişini taklit etmek için inject edilir.
   */
  constructor(
    private readonly repository: IServiceRegistryRepository,
    private readonly ttlMs: number = env.SERVICE_REGISTRY_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(
    projectId: string,
    senderRaw: string,
    serviceHint?: string,
  ): Promise<string | null> {
    const rules = await this.getRules(projectId);

    // 1) Birincil sinyal: senderPattern (tüm kurallarda önce bunu dene — önceliklidir).
    for (const rule of rules) {
      if (rule.senderPattern && this.matches(rule.senderPattern, senderRaw)) {
        return rule.id;
      }
    }

    // 2) Yedek sinyal: serviceHint varsa keywordPattern ile dene.
    if (serviceHint !== undefined && serviceHint.length > 0) {
      for (const rule of rules) {
        if (rule.keywordPattern && this.matches(rule.keywordPattern, serviceHint)) {
          return rule.id;
        }
      }
    }

    return null;
  }

  /** Cache geçerliyse oradan, değilse DB'den (AWAIT) çekip cache'e yazar. */
  private async getRules(projectId: string): Promise<ServiceRegistry[]> {
    const cached = this.cache.get(projectId);
    if (cached && this.now() < cached.expiresAt) {
      return cached.rules;
    }
    const rules = await this.repository.findActiveRules(projectId);
    this.cache.set(projectId, {
      rules,
      expiresAt: this.now() + this.ttlMs,
    });
    return rules;
  }

  /**
   * Pattern'i değere uygular (SYNC). Pattern'ler kayıt sırasında ReDoS+derlenebilirlik
   * kontrolünden geçer; yine de derleme hatası OTP pipeline'ını ASLA kıramaz → false döner.
   */
  private matches(pattern: string, value: string): boolean {
    try {
      return new RegExp(pattern).test(value);
    } catch {
      logger.warn({ pattern }, 'servis pattern derlenemedi — eşleşme atlandı');
      return false;
    }
  }
}
