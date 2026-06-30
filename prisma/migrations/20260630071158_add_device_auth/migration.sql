-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('ANDROID', 'IOS');

-- AlterTable
ALTER TABLE "otp_logs" ADD COLUMN     "deviceId" UUID;

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "secretHash" VARCHAR(512) NOT NULL,
    "platform" "Platform" NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE INDEX "devices_projectId_idx" ON "devices"("projectId");

-- CreateIndex
CREATE INDEX "otp_logs_deviceId_idx" ON "otp_logs"("deviceId");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_logs" ADD CONSTRAINT "otp_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
