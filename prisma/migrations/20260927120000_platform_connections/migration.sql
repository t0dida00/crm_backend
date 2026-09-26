-- A business's own database and Pusher credentials (central database only).
-- Secrets are encrypted by the API before they are stored.
CREATE TABLE IF NOT EXISTS "platform_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform_id" UUID NOT NULL,
  "database_url_enc" TEXT,
  "database_label" VARCHAR(255),
  "database_verified_at" TIMESTAMPTZ(6),
  "schema_version" INTEGER,
  "pusher_app_id" VARCHAR(50),
  "pusher_key" VARCHAR(100),
  "pusher_cluster" VARCHAR(30),
  "pusher_secret_enc" TEXT,
  "pusher_verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_connection_platform" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "platform_connections_platform_id_key" ON "platform_connections"("platform_id");
