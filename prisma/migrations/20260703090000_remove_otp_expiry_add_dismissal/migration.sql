-- OTP kodları süresiz oldu: expiresAt sütunu ve index'i düşürülür (otomatik silme de kalktı).
DROP INDEX IF EXISTS "otp_logs_expiresAt_idx";
ALTER TABLE "otp_logs" DROP COLUMN IF EXISTS "expiresAt";

-- Developer'ın kendi feed'inden OTP kaldırması için per-developer yumuşak gizleme tablosu.
CREATE TABLE "otp_dismissals" (
    "id" UUID NOT NULL,
    "otpId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "otp_dismissals_otpId_userId_key" ON "otp_dismissals"("otpId", "userId");
CREATE INDEX "otp_dismissals_userId_idx" ON "otp_dismissals"("userId");

ALTER TABLE "otp_dismissals"
    ADD CONSTRAINT "otp_dismissals_otpId_fkey" FOREIGN KEY ("otpId") REFERENCES "otp_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "otp_dismissals"
    ADD CONSTRAINT "otp_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
