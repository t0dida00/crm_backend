-- New owner accounts waiting for review (central database only). No row means
-- approved, so every existing account stays usable.
CREATE TABLE IF NOT EXISTS "account_approvals" (
  "user_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_approvals_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "fk_account_approval_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
