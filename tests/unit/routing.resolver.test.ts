import {
  RoutingTarget,
  type Group,
  type GroupMember,
  type RoutingRule,
  type User,
} from '@prisma/client';
import { RoutingResolver } from '@modules/routing/routing.resolver';
import type {
  IRoutingRepository,
  RoutingRuleWithTargets,
} from '@modules/routing/routing.interfaces';

/**
 * RoutingResolver birim testi — repository mock'lanır (DIP).
 * Flatten + dedupe izole doğrulanır. AKTİF filtresi ve receiver bazlı süzme DB seviyesindedir
 * (findActiveTargets / findReceiverIdsForDeveloper sözleşmesi) ve routing integration testinde doğrulanır.
 */

const RECEIVER_ID = '11111111-1111-1111-1111-111111111111';
const RECEIVER_B = '22222222-2222-2222-2222-222222222222';
const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GROUP_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function developerRule(developerId: string): RoutingRuleWithTargets {
  const rule: RoutingRule = {
    id: `rule_${developerId}`,
    receiverId: RECEIVER_ID,
    targetType: RoutingTarget.DEVELOPER,
    developerId,
    groupId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return { ...rule, group: null };
}

function groupRule(memberIds: string[]): RoutingRuleWithTargets {
  const rule: RoutingRule = {
    id: 'rule_group',
    receiverId: RECEIVER_ID,
    targetType: RoutingTarget.GROUP,
    developerId: null,
    groupId: GROUP_ID,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const group: Group = {
    id: GROUP_ID,
    name: 'Grup',
    projectId: 'proj',
    createdAt: new Date(),
  };
  const members = memberIds.map((userId): GroupMember & { user: User } => ({
    id: `gm_${userId}`,
    groupId: GROUP_ID,
    userId,
    createdAt: new Date(),
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: null,
      phoneNumber: null,
      password: 'x',
      role: 'DEVELOPER',
      projectId: 'proj',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }));
  return { ...rule, group: { ...group, members } };
}

function buildRepo(): jest.Mocked<IRoutingRepository> {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    listByProject: jest.fn(),
    listByReceiver: jest.fn(),
    findDeveloperRule: jest.fn(),
    findGroupRule: jest.fn(),
    findActiveTargets: jest.fn(),
    findReceiverIdsForDeveloper: jest.fn(),
    toggle: jest.fn(),
    delete: jest.fn(),
    findUserById: jest.fn(),
    findUsersByIds: jest.fn(),
    findGroupById: jest.fn(),
  } as unknown as jest.Mocked<IRoutingRepository>;
}

describe('RoutingResolver.resolveTargets', () => {
  it('sadece DEVELOPER hedefli kural → tek User.id döner', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([developerRule(DEV_A)]);

    const result = await new RoutingResolver(repo).resolveTargets(RECEIVER_ID);

    expect(repo.findActiveTargets).toHaveBeenCalledWith(RECEIVER_ID);
    expect(result).toEqual([DEV_A]);
  });

  it('sadece GROUP hedefli kural → grubun tüm üyeleri döner', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([groupRule([DEV_A, DEV_B])]);

    const result = await new RoutingResolver(repo).resolveTargets(RECEIVER_ID);

    expect(result.sort()).toEqual([DEV_A, DEV_B].sort());
  });

  it('hem DEVELOPER hem GROUP aynı developer\'ı kapsıyor → dedupe edilmiş tek sonuç', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([
      developerRule(DEV_A),
      groupRule([DEV_A, DEV_B]),
    ]);

    const result = await new RoutingResolver(repo).resolveTargets(RECEIVER_ID);

    expect(result.sort()).toEqual([DEV_A, DEV_B].sort());
    expect(result).toHaveLength(2);
  });

  it('hiç kural yok → boş liste', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([]);

    const result = await new RoutingResolver(repo).resolveTargets(RECEIVER_ID);

    expect(result).toEqual([]);
  });
});

describe('RoutingResolver.resolveTargetDetails', () => {
  it('hedef id\'leri için e-postaları toplu çekip TargetUser[] döner', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([developerRule(DEV_A)]);
    repo.findUsersByIds.mockResolvedValue([
      {
        id: DEV_A,
        email: 'a@test.com',
        name: 'Alice',
        phoneNumber: null,
        password: 'x',
        role: 'DEVELOPER',
        projectId: 'proj',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User,
    ]);

    const result = await new RoutingResolver(repo).resolveTargetDetails(RECEIVER_ID);

    expect(repo.findUsersByIds).toHaveBeenCalledWith([DEV_A]);
    expect(result).toEqual([{ id: DEV_A, email: 'a@test.com', name: 'Alice' }]);
  });

  it('hiç hedef yok → boş liste, kullanıcı sorgusu yapılmaz', async () => {
    const repo = buildRepo();
    repo.findActiveTargets.mockResolvedValue([]);

    const result = await new RoutingResolver(repo).resolveTargetDetails(RECEIVER_ID);

    expect(result).toEqual([]);
    expect(repo.findUsersByIds).not.toHaveBeenCalled();
  });
});

describe('RoutingResolver.resolveVisibleReceiverIds', () => {
  it('developer id\'siyle repository\'yi sorgular, receiver id listesini döner', async () => {
    const repo = buildRepo();
    repo.findReceiverIdsForDeveloper.mockResolvedValue([RECEIVER_ID, RECEIVER_B]);

    const result = await new RoutingResolver(repo).resolveVisibleReceiverIds(DEV_A);

    expect(repo.findReceiverIdsForDeveloper).toHaveBeenCalledWith(DEV_A);
    expect(result).toEqual([RECEIVER_ID, RECEIVER_B]);
  });

  it('hiç kural yok → boş liste (developer hiçbir kod görmez)', async () => {
    const repo = buildRepo();
    repo.findReceiverIdsForDeveloper.mockResolvedValue([]);

    const result = await new RoutingResolver(repo).resolveVisibleReceiverIds(DEV_A);

    expect(result).toEqual([]);
  });
});
