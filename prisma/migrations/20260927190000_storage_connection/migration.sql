-- A business's own image storage (Vercel Blob or S3-compatible), connected
-- together with its database and Pusher app. The config is encrypted by the API.
ALTER TABLE "platform_connections" ADD COLUMN IF NOT EXISTS "storage_provider" VARCHAR(20);
ALTER TABLE "platform_connections" ADD COLUMN IF NOT EXISTS "storage_label" VARCHAR(255);
ALTER TABLE "platform_connections" ADD COLUMN IF NOT EXISTS "storage_config_enc" TEXT;
ALTER TABLE "platform_connections" ADD COLUMN IF NOT EXISTS "storage_verified_at" TIMESTAMPTZ(6);
