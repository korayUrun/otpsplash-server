import { serviceRuleSchema } from '@modules/service-registry/registry.schemas';

/**
 * ServiceRegistry şema (Zod) birim testi — ReDoS koruması.
 * `senderPattern`/`keywordPattern`: uzunluk ≤200 + tehlikeli iç içe quantifier reddi
 * (CLAUDE.md "senderPattern — ReDoS Koruması"). Format doğrulaması TEK YERDE (Zod) tutulur.
 */
describe('serviceRuleSchema — ReDoS koruması', () => {
  it('200 karakter sınırını aşan senderPattern → reddedilir', () => {
    const result = serviceRuleSchema.safeParse({
      name: 'Uzun',
      senderPattern: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('iç içe quantifier (a+)+ → reddedilir (catastrophic backtracking)', () => {
    const result = serviceRuleSchema.safeParse({
      name: 'Tehlikeli',
      senderPattern: '(a+)+',
    });
    expect(result.success).toBe(false);
  });

  it('iç içe quantifier keywordPattern\'da da reddedilir', () => {
    const result = serviceRuleSchema.safeParse({
      name: 'Tehlikeli',
      keywordPattern: '(ab*)*',
    });
    expect(result.success).toBe(false);
  });

  it('geçersiz (derlenemeyen) regex → reddedilir', () => {
    const result = serviceRuleSchema.safeParse({
      name: 'Bozuk',
      senderPattern: '([a-z',
    });
    expect(result.success).toBe(false);
  });

  it('normal güvenli pattern (^BINANCE.*$) → geçer', () => {
    const result = serviceRuleSchema.safeParse({
      name: 'Binance',
      senderPattern: '^BINANCE.*$',
    });
    expect(result.success).toBe(true);
  });

  it('hiç pattern yok → reddedilir (en az biri zorunlu)', () => {
    const result = serviceRuleSchema.safeParse({ name: 'Patternsiz' });
    expect(result.success).toBe(false);
  });
});
