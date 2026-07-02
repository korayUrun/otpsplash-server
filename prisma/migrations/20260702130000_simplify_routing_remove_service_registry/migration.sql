-- Routing sadeleştirme: servis kavramı kaldırıldı. Kural artık receiver → hedef ikilisidir.
-- ServiceRegistry tablosu, RoutingRule.serviceId ve OTPLog.serviceId sütunları düşürülür.

-- 1) service_id'ye bağlı partial unique index'ler (önceki migration'da elle eklenmişti).
DROP INDEX IF EXISTS "routing_rule_developer_unique";
DROP INDEX IF EXISTS "routing_rule_group_unique";

-- 2) service_registry'ye giden FK'ler.
ALTER TABLE "routing_rules" DROP CONSTRAINT IF EXISTS "routing_rules_serviceId_fkey";
ALTER TABLE "otp_logs" DROP CONSTRAINT IF EXISTS "otp_logs_serviceId_fkey";

-- 3) serviceId index'leri.
DROP INDEX IF EXISTS "routing_rules_serviceId_idx";
DROP INDEX IF EXISTS "otp_logs_serviceId_idx";

-- 4) serviceId sütunları.
ALTER TABLE "routing_rules" DROP COLUMN IF EXISTS "serviceId";
ALTER TABLE "otp_logs" DROP COLUMN IF EXISTS "serviceId";

-- 5) service_registry tablosu (project FK'si tabloyla birlikte düşer).
DROP TABLE IF EXISTS "service_registry";

-- 6) Servis kaldırıldığında yalnızca servis bakımından farklılaşan kurallar aynılaşır;
--    yeni unique index'ten önce yinelenenleri temizle (en eskisini/ctid'i tut).
DELETE FROM "routing_rules" a
  USING "routing_rules" b
  WHERE a."targetType" = 'DEVELOPER'
    AND b."targetType" = 'DEVELOPER'
    AND a."receiverId" = b."receiverId"
    AND a."developerId" = b."developerId"
    AND a.ctid > b.ctid;

DELETE FROM "routing_rules" a
  USING "routing_rules" b
  WHERE a."targetType" = 'GROUP'
    AND b."targetType" = 'GROUP'
    AND a."receiverId" = b."receiverId"
    AND a."groupId" = b."groupId"
    AND a.ctid > b.ctid;

-- 7) Partial unique index'leri serviceId olmadan yeniden oluştur.
--    Aynı (receiver, developer) veya (receiver, grup) kuralı iki kez eklenemez.
CREATE UNIQUE INDEX "routing_rule_developer_unique"
  ON "routing_rules" ("receiverId", "developerId")
  WHERE "targetType" = 'DEVELOPER';

CREATE UNIQUE INDEX "routing_rule_group_unique"
  ON "routing_rules" ("receiverId", "groupId")
  WHERE "targetType" = 'GROUP';
