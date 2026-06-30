/*
  Warnings:

  - Added the required column `receiverId` to the `otp_logs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RoutingTarget" AS ENUM ('DEVELOPER', 'GROUP');

-- AlterTable
ALTER TABLE "otp_logs" ADD COLUMN     "receiverId" UUID NOT NULL,
ADD COLUMN     "serviceId" UUID,
ADD COLUMN     "sharingActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_registry" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "senderPattern" VARCHAR(255),
    "keywordPattern" VARCHAR(255),
    "iconUrl" VARCHAR(500),
    "projectId" UUID NOT NULL,
    "lastSeenSender" VARCHAR(255),
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" UUID NOT NULL,
    "receiverId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "targetType" "RoutingTarget" NOT NULL,
    "developerId" UUID,
    "groupId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "groups_projectId_idx" ON "groups"("projectId");

-- CreateIndex
CREATE INDEX "group_members_userId_idx" ON "group_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "service_registry_projectId_idx" ON "service_registry"("projectId");

-- CreateIndex
CREATE INDEX "service_registry_isActive_idx" ON "service_registry"("isActive");

-- CreateIndex
CREATE INDEX "routing_rules_receiverId_idx" ON "routing_rules"("receiverId");

-- CreateIndex
CREATE INDEX "routing_rules_serviceId_idx" ON "routing_rules"("serviceId");

-- Partial unique indexes (elle eklendi — Prisma schema.prisma'da ifade edilemez).
-- PostgreSQL düz UNIQUE'te NULL'ları "farklı" saydığından, hedef tipine göre ayrı iki
-- kısmi index kurulur: aynı (receiver, servis, developer) veya (receiver, servis, grup)
-- ikilisinin tekrar eklenmesi DB seviyesinde de engellenir (servis katmanı kontrolünün yanında).
CREATE UNIQUE INDEX "routing_rule_developer_unique"
  ON "routing_rules" ("receiverId", "serviceId", "developerId")
  WHERE "targetType" = 'DEVELOPER';

CREATE UNIQUE INDEX "routing_rule_group_unique"
  ON "routing_rules" ("receiverId", "serviceId", "groupId")
  WHERE "targetType" = 'GROUP';

-- CreateIndex
CREATE INDEX "otp_logs_receiverId_idx" ON "otp_logs"("receiverId");

-- CreateIndex
CREATE INDEX "otp_logs_serviceId_idx" ON "otp_logs"("serviceId");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_registry" ADD CONSTRAINT "service_registry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service_registry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_logs" ADD CONSTRAINT "otp_logs_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_logs" ADD CONSTRAINT "otp_logs_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service_registry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
