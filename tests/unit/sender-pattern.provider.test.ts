import type { SenderPatternConfig } from '@config/senderPatterns';
import { StaticSenderPatternProvider } from '@modules/otp/sender-pattern.provider';

describe('StaticSenderPatternProvider', () => {
  const build = (patterns: SenderPatternConfig[]): StaticSenderPatternProvider =>
    new StaticSenderPatternProvider(patterns);

  it('yalnızca name+pattern döner — isActive/order sızmaz', () => {
    const provider = build([
      { name: 'A', pattern: '^A', isActive: true, order: 0 },
    ]);

    expect(provider.list()).toEqual([{ name: 'A', pattern: '^A' }]);
  });

  it('isActive=false satırları hariç tutar', () => {
    const provider = build([
      { name: 'Active', pattern: '^X', isActive: true, order: 0 },
      { name: 'Disabled', pattern: '^Y', isActive: false, order: 1 },
    ]);

    expect(provider.list().map((p) => p.name)).toEqual(['Active']);
  });

  it('order artan sıralar; eşit order tanım sırasını korur (stabil)', () => {
    const provider = build([
      { name: 'Second', pattern: '^2', isActive: true, order: 10 },
      { name: 'First', pattern: '^1', isActive: true, order: 5 },
      { name: 'TieA', pattern: '^a', isActive: true, order: 10 },
    ]);

    expect(provider.list().map((p) => p.name)).toEqual([
      'First',
      'Second',
      'TieA',
    ]);
  });

  it('kaynak diziyi mutasyona uğratmaz', () => {
    const source: SenderPatternConfig[] = [
      { name: 'B', pattern: '^b', isActive: true, order: 2 },
      { name: 'A', pattern: '^a', isActive: true, order: 1 },
    ];
    build(source).list();

    expect(source.map((p) => p.name)).toEqual(['B', 'A']);
  });

  it('varsayılan konfigi kullanır (arg verilmezse) ve COINTRA içerir', () => {
    const names = new StaticSenderPatternProvider().list().map((p) => p.name);
    expect(names).toContain('COINTRA');
  });
});
