import { RoutingTarget } from '@prisma/client';
import type {
  IRoutingRepository,
  IRoutingResolver,
  RoutingRuleWithTargets,
  TargetUser,
} from './routing.interfaces';

/**
 * Yönlendirme çözümleyici.
 * Bir receiver için aktif kuralları çekip (ASYNC, DB) hedef developer'ları bellekte
 * flatten + dedupe eder (SYNC). Bir developer hem doğrudan hem grup üzerinden hedeflenmiş
 * olabilir; `Set` ile id bazında tekilleştirilir.
 *
 * Receiver'ın hiç aktif kuralı yoksa boş liste döner — bu, "kural yoksa kimseye gitmez"
 * davranışıyla tutarlıdır.
 */
export class RoutingResolver implements IRoutingResolver {
  constructor(private readonly repository: IRoutingRepository) {}

  async resolveTargets(receiverId: string): Promise<string[]> {
    const rules = await this.repository.findActiveTargets(receiverId);
    return this.flattenIds(rules);
  }

  async resolveTargetDetails(receiverId: string): Promise<TargetUser[]> {
    const ids = await this.resolveTargets(receiverId);
    if (ids.length === 0) {
      return [];
    }
    // developerId düz kolon olduğundan e-postalar toplu çekilir (salt-okunur görünüm).
    const users = await this.repository.findUsersByIds(ids);
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
    }));
  }

  async resolveVisibleReceiverIds(developerId: string): Promise<string[]> {
    // Repository DB seviyesinde `distinct` uygular — tekilleştirme gerekmez.
    return this.repository.findReceiverIdsForDeveloper(developerId);
  }

  /** Aktif kuralları benzersiz hedef developer id listesine indirger (SYNC). */
  private flattenIds(rules: RoutingRuleWithTargets[]): string[] {
    const ids = new Set<string>();

    for (const rule of rules) {
      if (rule.targetType === RoutingTarget.DEVELOPER) {
        if (rule.developerId) {
          ids.add(rule.developerId);
        }
        continue;
      }
      // GROUP: grubun tüm üyelerini ekle.
      if (rule.group) {
        for (const member of rule.group.members) {
          ids.add(member.userId);
        }
      }
    }

    return [...ids];
  }
}
