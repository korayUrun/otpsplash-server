-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phoneNumber" VARCHAR(32);

-- Partial unique index: aynı anda en fazla BİR varsayılan proje olabilir (self-register hedefi).
-- Prisma schema.prisma üzerinden ifade edilemediği için migration'a elle eklendi.
CREATE UNIQUE INDEX "projects_isDefault_key" ON "projects" ("isDefault") WHERE "isDefault" = true;
