import type { ServiceRegistry } from '@prisma/client';
import { ServiceRegistryResolver } from '@modules/service-registry/registry.resolver';
import type { IServiceRegistryRepository } from '@modules/service-registry/registry.interfaces';

/**
 * ServiceRegistryResolver birim testi — repository mock'lanır (DIP).
 * Eşleştirme önceliği (senderPattern > keywordPattern), null sonucu ve cache TTL davranışı
 * izole doğrulanır. TTL ve saat (`now`) deterministiklik için inject edilir.
 */

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function service(overrides: Partial<ServiceRegistry>): ServiceRegistry {
  return {
    id: 'svc',
    name: 'Servis',
    isActive: true,
    senderPattern: null,
    keywordPattern: null,
    iconUrl: null,
    projectId: PROJECT_ID,
    lastSeenSender: null,
    unmatchedCount: 0,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildRepo(): jest.Mocked<IServiceRegistryRepository> {
  return {
    findActiveRules: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    activate: jest.fn(),
    upsertUnmatched: jest.fn(),
    findUnmatched: jest.fn(),
    findAll: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<IServiceRegistryRepository>;
}

describe('ServiceRegistryResolver.resolve', () => {
  it('senderPattern eşleşmesi → doğru serviceId', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      service({ id: 'binance', senderPattern: '^BINANCE$' }),
    ]);

    const result = await new ServiceRegistryResolver(repo, 0).resolve(
      PROJECT_ID,
      'BINANCE',
    );

    expect(result).toBe('binance');
  });

  it('senderPattern eşleşmiyor ama keywordPattern eşleşiyor → doğru serviceId', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      service({ id: 'garanti', senderPattern: '^GARANTI$', keywordPattern: 'garanti' }),
    ]);

    const result = await new ServiceRegistryResolver(repo, 0).resolve(
      PROJECT_ID,
      '+905551112233', // senderPattern eşleşmez
      'garanti kodunuz', // keywordPattern eşleşir
    );

    expect(result).toBe('garanti');
  });

  it('hiçbiri eşleşmiyor → null', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      service({ id: 'binance', senderPattern: '^BINANCE$' }),
    ]);

    const result = await new ServiceRegistryResolver(repo, 0).resolve(
      PROJECT_ID,
      'UNKNOWN',
      'hint',
    );

    expect(result).toBeNull();
  });

  it('senderPattern ve keywordPattern ikisi de eşleşebiliyorsa senderPattern kazanır', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      // keywordPattern eşleşen kural önce gelse bile senderPattern eşleşmesi önceliklidir.
      service({ id: 'by-keyword', keywordPattern: 'kod' }),
      service({ id: 'by-sender', senderPattern: '^BINANCE$' }),
    ]);

    const result = await new ServiceRegistryResolver(repo, 0).resolve(
      PROJECT_ID,
      'BINANCE',
      'kod',
    );

    expect(result).toBe('by-sender');
  });

  it('cache süresi dolmadan ikinci çağrı → DB\'ye tekrar gitmez', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      service({ id: 'binance', senderPattern: '^BINANCE$' }),
    ]);
    let clock = 1000;
    const resolver = new ServiceRegistryResolver(repo, 60_000, () => clock);

    await resolver.resolve(PROJECT_ID, 'BINANCE');
    clock = 30_000; // TTL içinde
    await resolver.resolve(PROJECT_ID, 'BINANCE');

    expect(repo.findActiveRules).toHaveBeenCalledTimes(1);
  });

  it('cache süresi dolduktan sonra → DB\'ye tekrar gider', async () => {
    const repo = buildRepo();
    repo.findActiveRules.mockResolvedValue([
      service({ id: 'binance', senderPattern: '^BINANCE$' }),
    ]);
    let clock = 1000;
    const resolver = new ServiceRegistryResolver(repo, 60_000, () => clock);

    await resolver.resolve(PROJECT_ID, 'BINANCE');
    clock = 1000 + 60_001; // TTL geçti
    await resolver.resolve(PROJECT_ID, 'BINANCE');

    expect(repo.findActiveRules).toHaveBeenCalledTimes(2);
  });
});
