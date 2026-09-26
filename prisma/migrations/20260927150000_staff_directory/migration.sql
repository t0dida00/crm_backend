-- Central database only: which business's own database holds a staff account.
CREATE TABLE IF NOT EXISTS "staff_directory" (
  "email" VARCHAR(255) NOT NULL,
  "user_id" UUID NOT NULL,
  "platform_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_directory_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "fk_staff_directory_platform" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "staff_directory_user_id_key" ON "staff_directory"("user_id");
CREATE INDEX IF NOT EXISTS "idx_staff_directory_platform" ON "staff_directory"("platform_id");
